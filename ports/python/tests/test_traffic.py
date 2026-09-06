import json
from pathlib import Path
import tempfile
import unittest
from hqtui_demo import traffic
from hqtui_demo.model import blank_sample, State
from hqtui_demo.view import render
from hqtui.testing import render_to_screen


class TrafficTests(unittest.TestCase):
    def fixture(self):
        return json.loads((Path(__file__).parents[2] / 'conformance/fixtures/demo-traffic.json').read_text())

    def test_sources_and_both_tabs_render(self):
        f = self.fixture()
        data = blank_sample(); t = data['telemetry']
        t.update(traffic.breakdown(f['connections'], f['listeners']))
        self.assertEqual(t['inboundConnections'], 1)
        self.assertEqual(t['outboundConnections'], 2)
        self.assertEqual({r['protocol']:r['total'] for r in t['protocols']}, {'SSH':1,'HTTPS':1,'DNS':1})
        t['sessions'] = traffic.sessions(f['who'])
        self.assertEqual(t['sessions'][0]['from'], '203.0.113.4')
        self.assertEqual(t['sessions'][0]['idle'], '.')
        t['logins'] = traffic.logins(f['last'], 'ok')
        self.assertEqual(len(t['logins']), 1)
        self.assertEqual(t['logins'][0]['status'], 'still')
        t['failedLogins'] = traffic.logins(f['lastb'], 'failed')
        self.assertEqual(t['failedLogins'][0]['status'], 'failed')
        t['ssh'] = traffic.ssh(f['ssh'])
        self.assertEqual([e['action'] for e in t['ssh']], ['accepted','invalid','disconnect'])
        self.assertEqual(t['ssh'][0]['time'], '10:01:02')
        t['http'] = traffic.http_stats(f['http'], 'fixture')
        self.assertEqual(t['http']['total'], 3)
        self.assertEqual(t['http']['upgrades'], 1)
        self.assertEqual(t['http']['recent'][0]['path'], '/chat')
        self.assertEqual(t['http']['recent'][0]['time'], '10:01:02')
        self.assertNotIn('secret', json.dumps(t['http']))
        state = State(data, 'real')
        for screen, labels in [('traffic',['HTTPS','SSH','accepted','/chat']), ('sessions',['alice','eve','Failed Logins','still'])]:
            state.screen = screen
            frame = render_to_screen(240, 80, 'dark', lambda ui: render(ui,state))
            for label in labels:
                self.assertTrue(frame.contains(label), (screen,label))
        self.assertEqual(traffic.ssh(''), [])
        self.assertEqual(traffic.logins('', 'ok'), [])

    def test_http_tail_growth_rotation_and_disappearance(self):
        with tempfile.TemporaryDirectory(prefix='hqtui-http-') as directory:
            root = Path(directory); path = root / traffic.ACCESS_LOGS[0]
            path.parent.mkdir(parents=True); raw = self.fixture()['http']
            path.write_text(raw)
            collector = traffic.HttpCollector()
            self.assertEqual(collector.sample(root, 1)['requestsPerSecond'], 0)
            with path.open('a') as file: file.write(raw)
            self.assertGreater(collector.sample(root, 2)['requestsPerSecond'], 0)
            path.rename(path.with_suffix('.old')); path.write_text(raw * 3)
            self.assertEqual(collector.sample(root, 3)['requestsPerSecond'], 0)
            path.write_text(raw)
            self.assertEqual(collector.sample(root, 4)['requestsPerSecond'], 0)
            path.write_text('x' * 300000 + '\n' + raw)
            self.assertLessEqual(len(traffic.tail(path)[0].encode()), 256 * 1024)
            path.unlink()
            self.assertIsNone(collector.sample(root, 5))
