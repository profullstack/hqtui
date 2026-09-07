"""Exercise every full native CLI's real collector -> sample -> rendered tabs.

Only this test process sees fixture utilities in a temporary PATH. No installed
commands, real logs, services or network endpoints are modified.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
COMMANDS = {
    'rust': ['mise', 'exec', 'rust@1.97.1', '--', 'cargo', 'run', '--example', 'dashboard', '--'],
    'go': ['mise', 'exec', 'go@1.26.0', '--', 'go', 'run', './examples/dashboard'],
    'python': ['mise', 'exec', 'python@3.12.13', '--', 'python', '-m', 'examples.dashboard'],
    'zig': ['mise', 'exec', 'zig@0.16.0', '--', 'zig', 'build', 'run-dashboard', '--'],
}
if os.environ.get('HQTUI_CPP_DEMO'):
    COMMANDS['cpp'] = [os.environ['HQTUI_CPP_DEMO']]
if os.environ.get('HQTUI_BINDING_DEMOS'):
    COMMANDS.update(json.loads(os.environ['HQTUI_BINDING_DEMOS']))
SHARED = {'cpp', 'ruby', 'php', 'perl'}
if os.environ.get('HQTUI_NATIVE_LANGUAGES'):
    selected = os.environ['HQTUI_NATIVE_LANGUAGES'].split(',')
    COMMANDS = {language: COMMANDS[language] for language in selected}


def main():
    fixture = json.loads((ROOT / 'ports/conformance/fixtures/demo-traffic.json').read_text())
    utility = '''#!/usr/bin/env python3
import json, os, sys
fixture=json.loads(os.environ['HQTUI_TEST_TRAFFIC'])
name=os.path.basename(sys.argv[0])
if name=='who': print(fixture['who'])
elif name=='last': print(fixture['last'])
elif name=='lastb': print(fixture['lastb'])
elif name=='ss':
    for c in fixture['connections']:
        print(c['proto'],c['state'],'0 0',c['local'],c['remote'])
elif name=='journalctl':
    if '-u' in sys.argv: print(fixture['ssh'])
elif name=='nvidia-smi': print('Test GPU, 25, 100, 1000, 55, 30')
elif name=='tail': print(fixture['http'])
elif name=='docker': print(json.dumps({'Names':'cpp-fixture-container','Image':'test:local','Status':'Up 1 hour'}))
'''
    with tempfile.TemporaryDirectory(prefix='hqtui-native-data-') as directory:
        utilities = ['who', 'last', 'lastb', 'ss', 'journalctl', 'nvidia-smi']
        if SHARED.intersection(COMMANDS):
            utilities += ['tail', 'docker']
        for name in utilities:
            path = Path(directory) / name
            path.write_text(utility)
            path.chmod(0o700)
        env = {**os.environ, 'PATH': directory + os.pathsep + os.environ['PATH'],
               'HQTUI_TEST_TRAFFIC': json.dumps(fixture)}
        for language, command in COMMANDS.items():
            cases = [('dashboard', ['Sensors', 'Test GPU', '25%']),
                     ('traffic', ['HTTPS', 'DNS', 'SSH', 'accepted', 'alice']),
                     ('sessions', ['alice', 'eve', 'still', 'failed'])]
            if language in SHARED:
                cases[1][1].extend(['/health', '/missing', '/chat'])
                cases.append(('services', ['cpp-fixture-container', 'test:local']))
                cases.append(('network', ['127.0.0.1']))
            for screen, expected in cases:
                result = subprocess.run([*command, '--real', '--snapshot', '--screen', screen,
                                         '--width', '240', '--height', '80'], cwd=ROOT / 'ports' / language,
                                        env=env, capture_output=True, text=True, timeout=120)
                assert result.returncode == 0, (language, result.stderr)
                for label in expected:
                    assert label.lower() in result.stdout.lower(), (language, screen, f'missing {label}')
                assert 'simulated' not in result.stdout.lower(), (language, screen)
                if language in SHARED:
                    assert 'token=secret' not in result.stdout, 'HTTP query secret leaked'
                print(f'{language} {screen}: fixture utilities reached the real collector and rendered rows', flush=True)


if __name__ == '__main__':
    main()
