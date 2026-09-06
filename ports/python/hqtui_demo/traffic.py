"""Read-only Traffic/Sessions sources, matching the TypeScript demo routes.

Socket direction and application labels are port-based estimates, not packet inspection.
"""
import collections
import math
import re
from pathlib import Path

PORTS = dict(pair.split('=') for pair in (
    '20=FTP 21=FTP 22=SSH 23=Telnet 25=SMTP 53=DNS 67=DHCP 68=DHCP 80=HTTP '
    '110=POP3 111=RPC 123=NTP 143=IMAP 161=SNMP 389=LDAP 443=HTTPS 445=SMB '
    '465=SMTPS 514=Syslog 587=SMTP 631=IPP 636=LDAPS 993=IMAPS 995=POP3S '
    '1194=OpenVPN 1433=MSSQL 1521=Oracle 2049=NFS 2379=etcd 3000=HTTP-dev '
    '3306=MySQL 3389=RDP 4000=HTTP-dev 5000=HTTP-dev 5432=Postgres 5672=AMQP '
    '5900=VNC 6379=Redis 8000=HTTP-alt 8080=HTTP-alt 8443=HTTPS-alt 9000=HTTP-alt '
    '9090=Prometheus 9200=Elasticsearch 11211=Memcached 27017=MongoDB 41641=Tailscale 51820=WireGuard'
).split())
ACCESS_LOGS = ('var/log/nginx/access.log', 'var/log/apache2/access.log', 'var/log/httpd/access_log', 'var/log/caddy/access.log')
COMBINED = re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\d+|-)')


def sessions(raw):
    out = []
    for line in raw.splitlines()[:1000]:
        f = line.split()
        if len(f) < 4:
            continue
        origin = re.search(r'\(([^)]+)\)', line)
        out.append(dict(user=f[0], tty=f[1], loginAt=' '.join(f[2:4]), idle=f[4] if len(f)>4 else '.',
                        what=f[5] if len(f)>5 else '', **{'from': origin[1] if origin else 'local'}))
    return out


def logins(raw, status):
    out = []
    for line in raw.splitlines():
        f = line.split()
        if len(f)<4 or f[0] in ('wtmp', 'btmp', 'reboot'):
            continue
        out.append(dict(user=f[0], tty=f[1], **{'from': f[2] if '.' in f[2] or ':' in f[2] else 'local'},
                        when=' '.join(f[-7:-3]) or ' '.join(f[3:7]), status='still' if 'still logged in' in line else status))
        if len(out)==40:
            break
    return out


def ssh(raw):
    out = []
    for line in raw.splitlines():
        if 'sshd' not in line:
            continue
        stamp = re.search(r'(?<!\d)\d{2}:\d{2}:\d{2}', line)
        match = re.search(r'(Accepted|Failed) (\S+) for (invalid user )?(\S+) from (\S+)', line)
        if match:
            action = 'accepted' if match[1]=='Accepted' else 'invalid' if match[3] else 'failed'
            out.append(dict(time=stamp[0] if stamp else '', action=action, user=match[4], **{'from': match[5]}, method=match[2]))
        else:
            match = re.search(r'Disconnected from (?:authenticating )?user (\S+) (\S+)', line)
            if match:
                out.append(dict(time=stamp[0] if stamp else '', action='disconnect', user=match[1], **{'from': match[2]}, method='-'))
    return out[-40:]


def breakdown(connections, listeners):
    listening = {str(row['port']) for row in listeners}
    buckets, remotes = {}, {}
    inbound = outbound = 0
    for c in connections:
        if c.get('state') == 'LISTEN' or not (c.get('state') == 'ESTAB' or c.get('proto','').startswith('udp')):
            continue
        local_port, remote_port = c['local'].rpartition(':')[2], c['remote'].rpartition(':')[2]
        incoming = local_port in listening
        port = local_port if incoming else remote_port
        protocol = PORTS.get(port, 'ephemeral' if port.isdecimal() and int(port)>=32768 else 'port '+port)
        bucket = buckets.setdefault(protocol, dict(protocol=protocol, inbound=0, outbound=0, total=0))
        bucket['inbound' if incoming else 'outbound'] += 1
        bucket['total'] += 1
        inbound += incoming; outbound += not incoming
        host = c['remote'].rpartition(':')[0]
        if host and host not in ('*','0.0.0.0'):
            remote = remotes.setdefault(host, dict(host=host, connections=0, protocols=[]))
            remote['connections'] += 1
            if protocol not in remote['protocols']:
                remote['protocols'].append(protocol)
    rows = sorted(remotes.values(), key=lambda v:-v['connections'])[:12]
    return dict(protocols=sorted(buckets.values(), key=lambda v:-v['total']),
                remotes=[{**r,'protocols':', '.join(r['protocols'][:3])} for r in rows],
                inboundConnections=inbound, outboundConnections=outbound)


def tail(path, limit=256*1024):
    try:
        with Path(path).open('rb') as stream:
            import os
            info = os.fstat(stream.fileno())
            start = max(0, info.st_size-limit)
            stream.seek(start)
            raw = stream.read(limit)
        if start:
            raw = raw.partition(b'\n')[2]
        return raw.decode('utf-8','replace'), info
    except (OSError, ValueError):
        return None


def http_stats(raw, source):
    recent = []
    for line in raw.splitlines():
        match = COMBINED.match(line)
        if not match:
            continue
        client, stamp, method, path, status, size = match.groups()
        timestamp = re.search(r'(?<!\d)\d{2}:\d{2}:\d{2}',stamp)
        recent.append(dict(time=timestamp[0] if timestamp else '', method=method, path=path.split('?')[0][:60],
                           status=status, client=client, bytes=int(size) if size.isdecimal() else 0))
    def top(key, name, limit):
        return [{name:k,'count':v} for k,v in collections.Counter(key(r) for r in recent).most_common(limit)]
    return dict(source=source, requestsPerSecond=0, total=len(recent),
                statusClasses=top(lambda r:r['status'][0]+'xx','class',6),
                topPaths=top(lambda r:r['path'],'path',10), topClients=top(lambda r:r['client'],'client',8),
                methods=top(lambda r:r['method'],'method',6), upgrades=sum(r['status']=='101' for r in recent),
                recent=list(reversed(recent[-40:])), history=[])


class HttpCollector:
    def __init__(self):
        self.previous = None
        self.history = []

    def sample(self, root, now):
        for candidate in ACCESS_LOGS:
            path = Path(root) / candidate
            result = tail(path)
            if not result or not result[0]:
                continue
            raw, info = result
            stats = http_stats(raw, str(path))
            identity = (str(path), info.st_dev, info.st_ino)
            rate = 0
            if self.previous:
                old, size, at = self.previous
                if old == identity and info.st_size > size and now > at:
                    rate = (info.st_size-size) / max(1, len(raw.encode()) / max(1,len(raw.splitlines()))) / (now-at)
            self.previous = (identity,info.st_size,now)
            self.history = (self.history + [rate if math.isfinite(rate) else 0])[-240:]
            stats.update(requestsPerSecond=self.history[-1], history=self.history[:])
            return stats
        self.previous = None
        self.history = []
        return None
