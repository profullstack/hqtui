"""Exercise actual Ruby/PHP/Perl APIs and VMs against the shared TS corpus."""
import ctypes
import fcntl
import json
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

ROOT = Path(__file__).resolve().parents[3]
LIB = Path(os.environ['HQTUI_NATIVE_LIB']).resolve()
DEFAULT = {'ruby': ['ruby'], 'php': ['php', '-d', f'extension={LIB.parent / "hqtui_php.so"}'], 'perl': ['perl']}
COMMANDS = json.loads(os.environ.get('HQTUI_BINDING_COMMANDS', json.dumps(DEFAULT)))
EXT = {'ruby':'rb','php':'php','perl':'pl'}

def invoke(language, relative, args=(), **kwargs):
    return subprocess.run([*COMMANDS[language], str(ROOT/'ports'/language/relative), *args],
                          check=True, capture_output=True, text=True, timeout=120, **kwargs)

def terminal(language, custom=False, terminate=False):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH',60,200,0,0))
    before=termios.tcgetattr(slave)
    relative=f'examples/{"hello" if custom else "dashboard"}.{EXT[language]}'
    args=['--interactive'] if custom else ['--sim']
    proc=subprocess.Popen([*COMMANDS[language],str(ROOT/'ports'/language/relative),*args],
                          stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
    os.set_blocking(master,False)
    output=bytearray()
    def read():
        if select.select([master],[],[],.02)[0]:
            try: output.extend(os.read(master,65536))
            except (BlockingIOError,OSError): pass
    def frame(label):
        end=time.monotonic()+5
        while label not in output and time.monotonic()<end and proc.poll() is None: read()
        assert label in output,(language,label,bytes(output[-2000:]))
    try:
        frame(b'widget tree' if custom else b'CPU Overview')
        if not custom:
            for key,label in [(b'2',b'Protocols'),(b'3',b'Active Sessions'),(b'4',b'Connections'),
                              (b'5',b'Filesystems'),(b'6',b'Buttons & Inputs'),(b'7',b'Braille'),
                              (b'8',b'Theme'),(b'9',b'Last Events'),(b'0',b'Full-screen churn')]:
                output.clear();os.write(master,key);frame(label)
        fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,80,0,0))
        if terminate: os.kill(proc.pid,signal.SIGTERM)
        else: os.write(master,b'q')
        end=time.monotonic()+5
        while proc.poll() is None and time.monotonic()<end: read()
        proc.wait(timeout=.1)
        expected=0 if custom or not terminate else 143
        assert proc.returncode==expected,(language,proc.returncode,bytes(output[-2000:]))
        after=termios.tcgetattr(slave)
        if sys.platform=='darwin':
            before[3]&=~termios.PENDIN;after[3]&=~termios.PENDIN
        assert after==before,(language,'terminal not restored',before,after)
    finally:
        if proc.poll() is None: os.killpg(proc.pid,signal.SIGKILL);proc.wait()
        os.close(master);os.close(slave)

def main():
    cases=json.loads((ROOT/'ports/conformance/fixtures/demo-parity.json').read_text())
    # Custom API is exercised separately: all three languages submit this tree,
    # and their own builders are tested by core and interactive hello programs.
    tree={'type':'col','children':[
        {'type':'panel','title':'Shared API','children':[
            {'type':'text','text':'Unicode → 世界 🚀','color':'primary'},
            {'type':'row','size':5,'gap':1,'children':[
                {'type':'graph','values':[0,20,80,30,100],'max':100,'color':'success'},
                {'type':'gauge','value':.72,'label':'CPU'}]},
            {'type':'meter','value':.45,'label':'RAM','color':'warning'},
            {'type':'keys','rows':[['Mode','Native'],['Calls','Batched']]},
            {'type':'table','columns':['Process','Status'],'rows':[['worker','running'],['queue','ready']]},
            {'type':'log','size':2,'entries':[{'time':'12:00','message':'ready'}]}
        ]} ]}
    custom=[{'width':w,'height':h,'theme':theme,'tree':tree} for w,h in [(1,1),(40,12),(100,30)] for theme in ['dark','light']]
    all_cases=cases+custom
    payload=''.join(json.dumps(c)+'\n' for c in all_cases)
    baseline=None
    for language in COMMANDS:
        suffix=EXT[language]
        print(invoke(language,f'tests/core.{suffix}').stdout.strip(),flush=True)
        result=invoke(language,f'tests/render.{suffix}',input=payload)
        frames=[json.loads(line) for line in result.stdout.splitlines()]
        assert len(frames)==len(all_cases),(language,len(frames))
        for case,actual in zip(cases,frames): assert actual==case['hashes'],(language,case['screen'],case['width'],case['theme'])
        if baseline is None: baseline=frames[len(cases):]
        else: assert frames[len(cases):]==baseline,(language,'custom widget mismatch')
        for custom_terminal in [False,True]:
            for terminate in [False,True]: terminal(language,custom_terminal,terminate)
        for screen in (['dashboard','traffic','sessions','network','services'] if sys.platform.startswith('linux') else []):
            output=invoke(language,f'examples/dashboard.{suffix}',
                          ['--real','--snapshot','--screen',screen,'--width','200','--height','60']).stdout
            assert 'simulated' not in output and len(output.splitlines())==60,(language,screen)
        print(f'{language}: 120 exact reference frames, 6 custom frames, ten tabs, custom app, resize and q/signals passed',flush=True)
    if sys.platform.startswith('linux'):
        demos={language:[*command,str(ROOT/'ports'/language/'examples'/f'dashboard.{EXT[language]}')]
               for language,command in COMMANDS.items()}
        subprocess.run([sys.executable,str(ROOT/'apps/demo/scripts/check-native-data.py')],check=True,
                       env={**os.environ,'HQTUI_BINDING_DEMOS':json.dumps(demos),
                            'HQTUI_NATIVE_LANGUAGES':','.join(demos)},timeout=120)

if __name__=='__main__': main()
