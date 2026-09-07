"""Isolated PTY tests: cold launch, switching tabs, overlays, resize and cleanup."""
import fcntl
import faulthandler
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time

executable = str(Path(sys.argv[1]).resolve())
faulthandler.enable()
faulthandler.dump_traceback_later(20, repeat=True)

def run(args, kill=False):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 60, 200, 0, 0))
    before = termios.tcgetattr(slave)
    # The direct executable needs PTY descriptors, not /dev/tty. Avoid Python
    # preexec_fn after fork: that can deadlock on macOS. The updater's separate
    # tests exercise acquiring a controlling terminal for curl-pipe launches.
    print(f'PTY launch: {args}, signal={kill}', flush=True)
    proc = subprocess.Popen([executable, *args], stdin=slave, stdout=slave, stderr=slave,
                            cwd='/tmp', start_new_session=True)
    os.set_blocking(master, False)
    output = bytearray()
    def wait_for(label, timeout=8):
        deadline = time.monotonic() + timeout
        while label not in output and time.monotonic() < deadline:
            if select.select([master], [], [], .05)[0]:
                try:
                    output.extend(os.read(master, 65536))
                except BlockingIOError:
                    pass
            assert proc.poll() is None, ('early exit', proc.returncode, bytes(output[-1000:]))
        assert label in output, ('missing frame', label, bytes(output[-1000:]))
    try:
        start = time.monotonic()
        wait_for(b'CPU Overview', 3)
        assert time.monotonic() - start < 3, 'first frame blocked by collector'
        for command, label in [(b'2', b'Protocols'), (b'3', b'Active Sessions'),
                               (b'4', b'Connections'), (b'5', b'Filesystems'),
                               (b'6', b'Buttons & Inputs'), (b'7', b'Braille'),
                               (b'8', b'Theme'), (b'9', b'Last Events'),
                               (b'0', b'Full-screen churn')]:
            output.clear()
            os.write(master, command)
            wait_for(label)
        os.write(master, b'?')
        output.clear()
        wait_for(b'Help')
        os.write(master, b'x')
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 80, 0, 0))
        os.write(master, b'1')
        output.clear()
        wait_for(b'CPU Overview')
        if kill:
            os.kill(proc.pid, signal.SIGTERM)
        else:
            os.write(master, b'q')
        proc.wait(timeout=3)
        assert proc.returncode == (143 if kill else 0), proc.returncode
        assert termios.tcgetattr(slave) == before, 'terminal state was not restored'
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        os.close(master)
        os.close(slave)

run(['--sim'])
run(['--sim'], kill=True)
if sys.platform.startswith('linux'):
    run(['--real'])
print('C++: all ten tabs, overlay, resize, q/SIGTERM and terminal restoration passed.')
faulthandler.cancel_dump_traceback_later()
