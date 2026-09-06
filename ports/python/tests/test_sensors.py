import json
from pathlib import Path
import tempfile
import unittest
from hqtui_demo.sensors import collect, parse_gpus
from hqtui_demo.model import State, blank_sample
from hqtui_demo.view import render
from hqtui.testing import render_to_screen


class SensorTests(unittest.TestCase):
    def test_shared_sensor_sources_refresh_and_render(self):
        cases = json.loads((Path(__file__).parents[2] / 'conformance/fixtures/demo-sensors.json').read_text())
        for case in cases:
            with self.subTest(case=case['name']), tempfile.TemporaryDirectory(prefix='hqtui-sensors-') as directory:
                root = Path(directory)
                def write(files):
                    for name, value in files.items():
                        path = root / name
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text(value)
                write(case['files'])
                def sample(cpuinfo):
                    return collect(root / 'sys', cpuinfo, parse_gpus(case.get('gpus', '')), lambda: case.get('lm'))
                first = sample(case['cpuinfo'])
                self.assertEqual([t['value'] for t in first['temperatures']], case['temperatures'])
                self.assertEqual({s['label']: s['value'] for s in first['sensors']}, case['sensors'])
                data = blank_sample()
                data.update(temperatures=first['temperatures'], sensors=first['sensors'])
                state = State(data, 'real')
                frame = render_to_screen(220, 70, 'dark', lambda ui: render(ui, state))
                for label, value in case['sensors'].items():
                    self.assertTrue(frame.contains(label), label)
                    self.assertTrue(frame.contains(value), value)
                write(case.get('changes', {}))
                next_values = {s['label']: s['value'] for s in sample(case.get('nextCpuinfo', case['cpuinfo']))['sensors']}
                for label, value in case.get('nextSensors', {}).items():
                    self.assertEqual(next_values[label], value)
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(collect(Path(directory), '', (), lambda: 'invalid')['sensors'], [])
