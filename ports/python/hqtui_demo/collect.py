"""Read-only native collectors. Missing data is explicit, never simulated.

Slow utilities run on one background worker owned by the CLI. Each invocation
has a deadline, output cap and fixed argv. Linux counters are sampled from procfs.
"""
from __future__ import annotations

import collections
import json
import os
import platform
import selectors
import shutil
import socket
import subprocess
import time
from pathlib import Path

from .model import blank_sample, push

MAX_OUTPUT=1024*1024


def read(path: Path, limit=MAX_OUTPUT) -> str:
    try:
        with path.open("rb") as stream: return stream.read(limit).decode("utf-8", "replace")
    except (OSError, ValueError): return ""


def command(args: list[str], timeout=0.7) -> str | None:
    if not shutil.which(args[0]): return None
    # A temporary output file bounds memory, but not disk. Instead drain a pipe
    # incrementally, stopping the read-only child if either bound is exceeded.
    try:
        with subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={**os.environ,"LC_ALL":"C"}) as proc:
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(proc.stdout,selectors.EVENT_READ)
                    chunks=[]; count=0; deadline=time.monotonic()+timeout
                    while True:
                        remaining=deadline-time.monotonic()
                        if remaining<=0: return None
                        if not selector.select(remaining): return None
                        chunk=os.read(proc.stdout.fileno(),min(65536,MAX_OUTPUT-count+1))
                        if not chunk: break
                        count+=len(chunk)
                        if count>MAX_OUTPUT: return None
                        chunks.append(chunk)
                    proc.wait(timeout=max(.01,deadline-time.monotonic()))
                    return b"".join(chunks).decode("utf-8","replace") if proc.returncode==0 else None
            finally:
                if proc.poll() is None: proc.kill(); proc.wait()
    except (OSError,ValueError,subprocess.SubprocessError): return None


def rate(current: float, previous: float | None, elapsed: float) -> float:
    return max(0,current-previous)/elapsed if previous is not None and elapsed>0 else 0


class Collector:
    source="real"
    sensor_note=""
    def __init__(self, root=Path("/proc"), sysroot=Path("/sys"), clock=time.monotonic):
        self.root=Path(root); self.sysroot=Path(sysroot); self.clock=clock
        self.sample=blank_sample(); self.unavailable=[]
        self.slow_missing=[]
        self.previous={}; self.last=0.; self.last_slow=-1e9; self.cpu_previous={}; self.proc_previous={}
        self.sample["system"].update(os=platform.system(),kernel=platform.release(),hostname=socket.gethostname(),shell=os.environ.get("SHELL",""),terminal=os.environ.get("TERM",""))
        self.sample["cpu"]["model"]=platform.processor() or platform.machine()

    def delta(self,key,value,dt):
        result=rate(value,self.previous.get(key),dt); self.previous[key]=value
        return result

    def refresh(self, _dt=0):
        now=self.clock(); dt=now-self.last if self.last else 0.; self.last=now
        s=self.sample; s["time"]=now
        self.unavailable=[]
        if platform.system()!="Linux" or not self.root.exists():
            self.unavailable=["native live metrics require Linux on this port"]
            self.portable()
            return
        try: self.linux(dt)
        except (OSError,ValueError,IndexError,KeyError) as error: self.unavailable.append("procfs: "+type(error).__name__)
        if now-self.last_slow>=5:
            self.last_slow=now; self.slow()
        self.unavailable.extend(self.slow_missing)

    def portable(self):
        # Portable process inventory where POSIX ps exists. Unsupported metrics
        # remain unavailable; the demo never invokes another runtime or probes
        # the network to fill those fields.
        result=command(["ps","-axo","pid=,pcpu=,pmem=,rss=,user=,comm="])
        rows=[]
        for line in (result or "").splitlines()[:10000]:
            parts=line.split(None,5)
            try:
                pid,cpu,mem,rss,user,name=parts
                rows.append(dict(pid=int(pid),cpu=float(cpu),mem=float(mem),rss=int(rss)*1024,user=user,name=name,command=name,threads=0,state="?"))
            except (ValueError,TypeError): continue
        self.sample["processes"]=rows
        self.sample["system"]["processCount"]=len(rows)

    def linux(self,dt):
        s=self.sample; t=s["telemetry"]; cores=[]; stat=read(self.root/"stat")
        for line in stat.splitlines():
            fields=line.split(); key=fields[0]
            if key.startswith("cpu"):
                values=list(map(int,fields[1:9])); total=sum(values); idle=sum(values[3:5])
                prev=self.cpu_previous.get(key); self.cpu_previous[key]=(total,idle)
                usage=max(0,min(1,1-(idle-prev[1])/max(1,total-prev[0]))) if prev else 0
                if key=="cpu": s["cpu"]["total"]=usage
                else: cores.append(usage)
            elif key in ("ctxt","intr","processes"):
                dest={"ctxt":"contextSwitch","intr":"interrupt","processes":"fork"}[key]
                count=int(fields[1]); t["kernel"][dest+"Rate"]=self.delta(key,count,dt)
                t["kernel"][{"ctxt":"contextSwitches","intr":"interrupts","processes":"forks"}[key]]=count
            elif key in ("procs_running","procs_blocked"):
                t["kernel"]["procsRunning" if key.endswith("running") else "procsBlocked"]=int(fields[1])
        if not stat: self.unavailable.append("CPU counters")
        s["cpu"]["cores"]=cores
        cpuinfo=read(self.root/"cpuinfo")
        for line in cpuinfo.splitlines():
            if line.startswith("model name"): s["cpu"]["model"]=line.split(":",1)[1].strip()
            elif line.startswith("cpu MHz"): s["cpu"]["frequencyGhz"]=float(line.split(":",1)[1])/1000
        load=read(self.root/"loadavg").split()
        if len(load)>=3: s["cpu"]["load"]=list(map(float,load[:3]))
        push(s["cpu"]["history"],s["cpu"]["total"]*100)
        mem={}
        for line in read(self.root/"meminfo").splitlines():
            fields=line.split(); mem[fields[0].rstrip(":")]=int(fields[1])*1024
        m=s["memory"]
        for target,source in (("total","MemTotal"),("available","MemAvailable"),("free","MemFree"),("cached","Cached"),("buffers","Buffers"),("swapTotal","SwapTotal")):
            m[target]=mem.get(source,0)
        if not mem: self.unavailable.append("memory")
        m["used"]=max(0,m["total"]-m["available"]); m["swapUsed"]=max(0,m["swapTotal"]-mem.get("SwapFree",0))
        push(m["history"],m["used"]/max(1,m["total"])*100)
        self.processes(dt)
        uptime=read(self.root/"uptime").split()
        s["system"]["uptime"]=float(uptime[0]) if uptime else 0
        s["system"]["contextSwitches"]=t["kernel"]["contextSwitches"]
        self.network(dt); self.disks(dt); self.sensors()

    def processes(self,dt):
        s=self.sample; rows=[]; current={}; ticks=os.sysconf("SC_CLK_TCK"); pages=os.sysconf("SC_PAGE_SIZE")
        users={}
        for line in read(Path("/etc/passwd")).splitlines():
            p=line.split(":")
            if len(p)>2: users[p[2]]=p[0]
        for entry in self.root.iterdir():
            if not entry.name.isdecimal(): continue
            try:
                raw=read(entry/"stat",16384); end=raw.rfind(")"); start=raw.find("(")
                if start<0 or end<start: continue
                f=raw[end+2:].split(); pid=int(entry.name); name=raw[start+1:end]
                identity=(pid,int(f[19])); cpu=int(f[11])+int(f[12]); current[identity]=cpu
                usage=rate(cpu,self.proc_previous.get(identity),dt)/ticks*100
                rss=max(0,int(f[21]))*pages; uid=str(entry.stat().st_uid)
                cmd=read(entry/"cmdline",8192).replace("\0"," ").strip() or name
                rows.append(dict(pid=pid,name=name,cpu=usage,mem=rss/max(1,s["memory"]["total"])*100,rss=rss,threads=int(f[17]),state=f[0],user=users.get(uid,uid),command=cmd))
            except (OSError,ValueError,IndexError): continue
            if len(rows)>=10000: self.unavailable.append("process list truncated at 10000"); break
        self.proc_previous=current; s["processes"]=rows
        s["system"]["processCount"]=len(rows); s["system"]["threadCount"]=sum(p["threads"] for p in rows)
        states=collections.Counter(p["state"] for p in rows)
        s["telemetry"]["states"].update(total=len(rows),running=states["R"],sleeping=states["S"]+states["D"],stopped=states["T"],zombie=states["Z"])

    def network(self,dt):
        s=self.sample; n=s["network"]; old={i["name"]:i for i in s["telemetry"]["interfaces"]}; interfaces=[]
        for line in read(self.root/"net/dev").splitlines()[2:]:
            if ":" not in line: continue
            name,raw=line.split(":",1); name=name.strip(); v=list(map(int,raw.split()))
            if len(v)<16: continue
            i=old.get(name,dict(name=name,ip="",mac="",mtu=0,rxHistory=[],txHistory=[]))
            base=self.sysroot/"class/net"/name
            i.update(state=read(base/"operstate").strip(),mac=read(base/"address").strip(),mtu=int(read(base/"mtu") or 0),rxTotal=v[0],txTotal=v[8],errors=v[2]+v[10],drops=v[3]+v[11])
            i["rxRate"]=self.delta(name+".rx",v[0],dt); i["txRate"]=self.delta(name+".tx",v[8],dt)
            push(i["rxHistory"],i["rxRate"]); push(i["txHistory"],i["txRate"]); interfaces.append(i)
        s["telemetry"]["interfaces"]=interfaces
        # Aggregate non-loopback rates. Interface resets/hotplug are individually
        # baselined, never subtracted from a different interface's counters.
        active=[i for i in interfaces if i["name"]!="lo"]
        n["interface"]=" + ".join(i["name"] for i in active)
        for direction,prefix in (("down","rx"),("up","tx")):
            n[direction+"Rate"]=sum(i[prefix+"Rate"] for i in active)
            n[direction+"Total"]=sum(i[prefix+"Total"] for i in active)
            n[direction+"Peak"]=max(n[direction+"Peak"],n[direction+"Rate"])
            push(n[direction+"History"],n[direction+"Rate"])
        if not interfaces: self.unavailable.append("network interfaces")
        raw=read(self.root/"net/snmp").splitlines(); counters={}
        for headers,values in zip(raw[::2],raw[1::2]):
            h=headers.split(); v=values.split()
            for key,value in zip(h[1:],v[1:]): counters[h[0].rstrip(":")+key]=int(value)
        net=s["telemetry"]["net"]
        for key in list(net):
            source=key[:3].capitalize()+key[3:] if key.startswith(("tcp","udp")) else "Icmp"+key[4:]
            if source in counters: net[key]=counters[source]
        for key,source in (("inSegs","tcpInSegs"),("outSegs","tcpOutSegs"),("retrans","tcpRetransSegs"),("activeOpens","tcpActiveOpens"),("passiveOpens","tcpPassiveOpens"),("udpIn","udpInDatagrams"),("udpOut","udpOutDatagrams")):
            net["rates"][key]=self.delta(source,net[source],dt)
        net["retransRatio"]=net["rates"]["retrans"]/max(1,net["rates"]["outSegs"])
        for key,value in (("netInHistory",net["rates"]["inSegs"]),("netOutHistory",net["rates"]["outSegs"]),("retransHistory",net["retransRatio"]*100)):
            push(s["telemetry"][key],value)

    def disks(self,dt):
        old={d["device"]:d for d in self.sample["disks"]}; disks=[]
        for line in read(self.root/"diskstats").splitlines():
            f=line.split()
            if len(f)<14 or f[2].startswith(("loop","ram")): continue
            name=f[2]; d=old.get(name,dict(device=name,mount="",type="block",total=0,used=0,readHistory=[],writeHistory=[]))
            d["readRate"]=self.delta("disk.read."+name,int(f[5])*512,dt)
            d["writeRate"]=self.delta("disk.write."+name,int(f[9])*512,dt)
            push(d["readHistory"],d["readRate"]); push(d["writeHistory"],d["writeRate"]); disks.append(d)
        self.sample["disks"]=disks[:128]

    def sensors(self):
        temps=[]; sensors=[]
        for folder in (self.sysroot/"class/hwmon").glob("hwmon*"):
            name=read(folder/"name",256).strip()
            for entry in folder.glob("temp*_input"):
                try:
                    value=float(read(entry,256))/1000
                    label=read(entry.with_name(entry.name.replace("_input","_label")),256).strip() or entry.stem
                    if -50<=value<=200: temps.append(dict(label=f"{name} {label}",value=value,max=100))
                except ValueError: continue
            for entry in folder.glob("fan*_input"):
                value=read(entry,256).strip()
                if value: sensors.append(dict(label=name+" "+entry.stem,value=value+" RPM"))
        self.sample["temperatures"]=temps[:128]; self.sample["sensors"]=sensors[:128]
        self.sensor_note="" if temps else "Thermal sensors are not exposed by this host"

    def slow(self):
        t=self.sample["telemetry"]; missing=[]
        def run(label,args):
            result=command(args)
            if result is None: missing.append(label)
            return result or ""
        sessions=[]
        for line in run("sessions",["who"]).splitlines():
            f=line.split()
            if len(f)>=4: sessions.append(dict(user=f[0],tty=f[1],loginAt=" ".join(f[2:4]),idle="—",what="—",**{"from":" ".join(f[4:]).strip("()") or "local"}))
        t["sessions"]=sessions
        services=[]
        for line in run("services",["systemctl","list-units","--type=service","--all","--no-legend","--no-pager","--plain"]).splitlines()[:1000]:
            f=line.split(None,4)
            if len(f)>=5: services.append(dict(name=f[0],active=f[2],sub=f[3],description=f[4]))
        t["services"]=services
        connections=[]; listeners=[]
        for line in run("sockets",["ss","-H","-tuna","-p"]).splitlines()[:5000]:
            f=line.split(None,6)
            if len(f)<6: continue
            proto,state,_,_,local,remote=f[:6]; process=f[6] if len(f)>6 else "—"
            connections.append(dict(proto=proto,state=state,local=local,remote=remote,process=process))
            if state in ("LISTEN","UNCONN"):
                address,_,port=local.rpartition(":"); listeners.append(dict(proto=proto,address=address,port=port,process=process))
        t["connections"]=connections; t["listeners"]=listeners
        # Socket snapshots alone do not establish connection direction or the
        # application protocol. Do not invent HTTP/SSH attribution from ports.
        t["protocols"]=[]; t["remotes"]=[dict(host=host,connections=count,protocols="—") for host,count in collections.Counter(c["remote"] for c in connections).most_common(200)]
        missing.append("connection direction/application protocols")
        push(t["connectionHistory"],len(connections)); push(t["sessionHistory"],len(sessions))
        journal=[]
        for line in run("journal",["journalctl","-n","100","--no-pager","-o","json"]).splitlines():
            try:
                row=json.loads(line); stamp=int(row.get("__REALTIME_TIMESTAMP",0))/1e6
                journal.append(dict(time=time.strftime("%H:%M:%S",time.localtime(stamp)),level=str(row.get("PRIORITY","")),unit=row.get("_SYSTEMD_UNIT",""),message=str(row.get("MESSAGE",""))))
            except (ValueError,TypeError): continue
        t["journal"]=journal; self.sample["logs"]=[{**r,"meta":r["unit"]} for r in journal]
        filesystems=[]
        for line in run("filesystems",["df","-PT","-B1"]).splitlines()[1:129]:
            f=line.split()
            try:
                device,kind,total,used,_,_,mount=f
                filesystems.append(dict(device=device,type=kind,size=int(total),used=int(used),mount=mount,inodesUsed=0,inodesTotal=0))
                for d in self.sample["disks"]:
                    if device.rsplit("/",1)[-1]==d["device"]: d.update(mount=mount,total=int(total),used=int(used))
            except ValueError: continue
        t["filesystems"]=filesystems
        # Protected sources are absent, not populated from the simulation.
        missing.extend(["login history", "SSH authentication log", "HTTP access log", "GPU/power"])
        self.slow_missing=missing
