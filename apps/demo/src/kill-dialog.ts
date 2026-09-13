import type { Container, KeyEvent } from "@profullstack/hqtui";
import type { DemoState } from "./state.ts";
import type { ProcessSample } from "./simulation.ts";
import { visibleProcesses } from "./screens/dashboard.ts";

export interface KillDialog {
  /** Capture the row once: live CPU sorting must not change the target. */
  target: Pick<ProcessSample, "pid" | "name" | "command" | "user">;
  force: boolean;
  result?: string;
}

export type SendSignal = (pid: number, signal: "SIGTERM" | "SIGKILL") => unknown;

/** Only a selected process can open a real process action. */
export function openKillDialog(state: DemoState): void {
  if (state.screen !== "dashboard" || state.focused.dashboard !== "dashboard.processes") return;
  const process = visibleProcesses(state)[state.panes["dashboard.processes"]?.selected ?? 0];
  if (!process) return;
  const { pid, name, command, user } = process;
  state.killDialog = { target: { pid, name, command, user }, force: false };
  state.showModal = true;
}

export function closeKillDialog(state: DemoState): void {
  state.showModal = false;
  state.killDialog = null;
}

/** A successful send requests termination; the process may still be cleaning up. */
export function confirmKillDialog(state: DemoState, send: SendSignal = process.kill): void {
  const dialog = state.killDialog;
  if (!state.showModal || !dialog || dialog.result) return;
  const { pid, command, user } = dialog.target;
  const signal = dialog.force ? "SIGKILL" : "SIGTERM";
  if (state.source.startsWith("simulated")) {
    dialog.result = `Simulation: would send ${signal} to process ${pid}. No real process was signalled.`;
    return;
  }
  // A zero/negative PID is a process group, never a selected process.
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    dialog.result = "Cannot signal an invalid process ID.";
    return;
  }
  const current = state.sample.processes.find((p) => p.pid === pid);
  if (!current || current.command !== command || current.user !== user) {
    dialog.result = `Process ${pid} has exited or changed since the dialog opened. Select it again.`;
    return;
  }
  try {
    send(pid, signal);
    dialog.result = `Sent ${signal} to process ${pid}.` + (dialog.force ? "" : " It may take time to finish cleaning up.");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    dialog.result = code === "ESRCH" ? `Process ${pid} has already exited.`
      : code === "EPERM" || code === "EACCES" ? `Permission denied: cannot send ${signal} to process ${pid}.`
      : `Could not send ${signal} to process ${pid}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function renderKillDialog(ui: Container, state: DemoState, send?: SendSignal): void {
  if (!state.showModal) return;
  const close = () => closeKillDialog(state);
  const dialog = state.killDialog;
  // The Components screen uses the same modal to demonstrate its buttons.
  if (!dialog) {
    ui.modal({
      title: "Confirm Action",
      message: "This is an example confirmation dialog.",
      buttons: [{ label: "Yes", variant: "success", onPress: close }, { label: "No", variant: "ghost", onPress: close }],
      onDismiss: close,
      onKey: (event) => { if (event.key === "y" || event.key === "n") close(); },
    });
    return;
  }
  if (dialog.result) {
    ui.modal({
      title: "Process Action",
      message: dialog.result,
      width: 64,
      buttons: [{ label: "Close", onPress: close }],
      onDismiss: close,
      onKey: (event) => { if (event.key === "n") close(); },
    });
    return;
  }
  const confirm = () => confirmKillDialog(state, send);
  const key = (event: KeyEvent) => {
    if (event.key === "n") close();
    else if (event.key === "y") confirm();
  };
  ui.modal({
    title: "Terminate Process",
    width: 64,
    height: 13,
    buttons: [
      { label: "Yes", variant: dialog.force ? "danger" : "success", onPress: confirm },
      { label: "No", variant: "ghost", onPress: close },
    ],
    onDismiss: close,
    onKey: key,
  }, (body) => {
    body.text(`Terminate process ${dialog.target.pid} (${dialog.target.name})?`, { size: 2 });
    body.label(dialog.force ? "SIGKILL (9): stop immediately, without cleanup." : "SIGTERM (15): request a graceful shutdown.", { size: 2 });
    body.checkbox({
      label: "Force kill (-9 / SIGKILL)",
      checked: dialog.force,
      onToggle: () => { if (!dialog.result) dialog.force = !dialog.force; },
    });
    body.spacer(1);
    body.label("Tab/arrows move · Space toggles · Enter selects");
  });
}
