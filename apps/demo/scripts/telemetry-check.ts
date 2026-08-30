import { createCollector } from "../src/system/index.ts";
const c = await createCollector({ real: true });
for (let i = 0; i < 3; i++) { await c.refresh(1); await new Promise(r => setTimeout(r, 400)); }
const t = c.current().telemetry;
const s = c.current();
console.log("sessions:", t.sessions.length, t.sessions.slice(0,2).map(x=>`${x.user}@${x.tty} from ${x.from}`));
console.log("logins:", t.logins.length, "failed:", t.failedLogins.length);
console.log("connections:", t.connections.length, "listeners:", t.listeners.length, t.listeners.slice(0,3).map(l=>`${l.proto} ${l.port} ${l.process}`));
console.log("services:", t.services.length, t.services.slice(0,3).map(x=>`${x.name}:${x.active}`));
console.log("containers:", t.containers.length);
console.log("interfaces:", t.interfaces.map(i=>`${i.name} ${i.state} rx=${(i.rxRate/1e3).toFixed(1)}KB/s`));
console.log("filesystems:", t.filesystems.length, t.filesystems.slice(0,3).map(f=>`${f.mount} ${(f.used/1024**3).toFixed(0)}/${(f.size/1024**3).toFixed(0)}G inodes ${f.inodesUsed}/${f.inodesTotal}`));
console.log("kernel: ctx/s", t.kernel.contextSwitchRate.toFixed(0), "intr/s", t.kernel.interruptRate.toFixed(0), "forks/s", t.kernel.forkRate.toFixed(1), "fds", t.kernel.openFiles+"/"+t.kernel.maxFiles, "entropy", t.kernel.entropy);
console.log("states:", JSON.stringify(t.states));
console.log("temps:", s.temperatures.length, s.temperatures.slice(0,4).map(x=>`${x.label}=${x.value.toFixed(0)}C`));
console.log("journal:", t.journal.length, t.journal.slice(-2).map(j=>`${j.time} ${j.level} ${j.unit}: ${j.message.slice(0,50)}`));
console.log("gpus:", t.gpus.length, "power:", t.power ? `${t.power.battery}%` : "none");
console.log("unavailable:", c.unavailable);
