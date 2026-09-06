"""Smoke-test the exact dashboard commands published in the language docs.

Run from any directory: python3 apps/demo/scripts/check-native-commands.py
Uses installed mise toolchains. No network services are changed; collectors
are read-only. Checks real and simulated launches in a private pseudo-terminal.
"""
import fcntl
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import termios
import time

ROOT = Path(__file__).resolve().parents[3]
COMMANDS = [
    ("rust", "rust@1.97.1", ["cargo", "run", "--example", "dashboard"], ["--"]),
    ("go", "go@1.26.0", ["go", "run", "./examples/dashboard"], []),
    ("python", "python@3.12.13", ["python", "-m", "examples.dashboard"], []),
    ("zig", "zig@0.16.0", ["zig", "build", "run-dashboard"], ["--"]),
]


def terminal_check(command, directory):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 168, 0, 0))
    before = termios.tcgetattr(slave)

    def controlling_terminal():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

    proc = subprocess.Popen(
        command, cwd=directory, stdin=slave, stdout=slave, stderr=slave,
        env={**os.environ, "TERM": "xterm-256color"}, preexec_fn=controlling_terminal,
    )
    output = b""
    sent_quit = False
    deadline = time.monotonic() + 60
    try:
        while proc.poll() is None and time.monotonic() < deadline:
            if select.select([master], [], [], 0.05)[0]:
                output += os.read(master, 65536)
            if b"CPU Overview" in output and not sent_quit:
                # A full frame, not merely the alternate-screen escape, must
                # arrive before sending input (terminal setup can flush stdin).
                os.write(master, b"q")
                sent_quit = True
                deadline = time.monotonic() + 12
        if proc.poll() is None:
            raise AssertionError("dashboard did not exit after q")
        assert sent_quit, output[-2000:].decode(errors="replace")
        assert proc.returncode == 0, f"exit {proc.returncode}"
        assert before == termios.tcgetattr(slave), "terminal settings were not restored"
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
        os.close(master)
        os.close(slave)


def main():
    for language, toolchain, args, separator in COMMANDS:
        cwd = ROOT / "ports" / language
        command = ["mise", "exec", toolchain, "--", *args]
        # The old small examples do not support this screen or snapshot flag.
        result = subprocess.run(
            [*command, *separator, "--snapshot", "--screen", "stress"],
            cwd=cwd, capture_output=True, text=True, timeout=90,
        )
        assert result.returncode == 0, result.stderr
        assert "stress" in result.stdout.lower() or "Full-screen churn" in result.stdout
        for label, flags in [("simulated", [*separator, "--sim"]), ("real", [])]:
            terminal_check([*command, *flags], cwd)
            print(f"{language}: {label} dashboard launched; q exited; terminal restored", flush=True)
    print("All documented native dashboard commands passed.")


if __name__ == "__main__":
    main()
