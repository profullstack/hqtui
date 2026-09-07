"""Reference demo acceptance tests. No terminal or privileged sources required."""
import contextlib
import io
import subprocess
import sys
import unittest
from unittest.mock import MagicMock, patch

from hqtui import App
from hqtui.testing import render_to_screen
from hqtui_demo.__main__ import arguments
from hqtui_demo.collect import Collector, command, rate
from hqtui_demo.model import LIMIT, SCREENS, THEMES, Simulation, State, blank_sample
from hqtui_demo.view import render


class DemoTests(unittest.TestCase):
    def state(self,screen="dashboard"):
        sim=Simulation(); return State(sim.sample,sim.source,screen=screen)

    def snapshot(self,state,width=120,height=40):
        return render_to_screen(width,height,THEMES[state.theme_index],lambda ui:render(ui,state))

    def test_all_screens_and_themes(self):
        state=self.state()
        for screen in SCREENS:
            for i,theme in enumerate(THEMES):
                with self.subTest(screen=screen,theme=theme):
                    state.screen=screen; state.theme_index=i
                    frame=self.snapshot(state)
                    self.assertTrue(frame.contains("hqtui"))
                    title=dict(zip(SCREENS,("CPU Overview","Protocols","Active Sessions","Connections","Filesystems","Buttons & Inputs","Braille (2×4","Theme ","Last Events","Full-screen churn")))[screen]
                    self.assertTrue(frame.contains(title))
                    self.assertEqual(len(frame.text().splitlines()),40)

    def test_small_and_large_screens(self):
        for screen in SCREENS:
            for width,height in ((1,1),(20,5),(40,12),(80,24),(160,50)):
                with self.subTest(screen=screen,size=(width,height)):
                    frame=self.snapshot(self.state(screen),width,height)
                    self.assertEqual(frame.buffer.width,width)
                    self.assertEqual(frame.buffer.height,height)

    def test_determinism_and_seed(self):
        a=Simulation(12); b=Simulation(12); c=Simulation(13)
        self.assertEqual(a.sample,b.sample)
        self.assertNotEqual(a.sample["cpu"]["history"],c.sample["cpu"]["history"])

    def test_histories_bounded(self):
        sim=Simulation()
        for _ in range(500): sim.refresh()
        self.assertLessEqual(len(sim.sample["cpu"]["history"]),LIMIT)
        self.assertLessEqual(len(sim.sample["network"]["downHistory"]),LIMIT)

    def test_filter_sort_and_overlay_priority(self):
        state=self.state(); state.key("f3"); state.key("q","q")
        self.assertEqual(state.filter,"q"); self.assertTrue(state.filtering)
        state.key("escape"); self.assertEqual(state.filter,"")
        state.filter="node"
        self.assertTrue(all("node" in (p["name"]+p["command"]).lower() for p in state.processes()))
        state.key("f6"); self.assertEqual(state.sort,"mem")
        state.key("ctrl+k"); state.key("t","themes"); state.key("enter")
        self.assertEqual(state.screen,"themes")
        state.key("f1"); self.assertFalse(state.key("q","q")); self.assertFalse(state.help)
        self.assertTrue(state.key("q","q"))

    def test_input_is_not_a_shortcut(self):
        state=self.state("input"); state.key("e"); state.key("q","q"); state.key("1","1")
        self.assertEqual(state.input_value,"q1"); self.assertEqual(state.screen,"input")
        state.key("escape"); self.assertFalse(state.editing)
        state.key("space"); self.assertTrue(state.paused)

    def test_dropdown(self):
        state=self.state("components"); state.select_open=True
        state.key("down"); state.key("enter")
        self.assertEqual(state.theme_index,1); self.assertFalse(state.select_open)

    def test_panes_are_independent_and_click_uses_offset(self):
        state=self.state(); frame=self.snapshot(state,120,40)
        process=state.panes["dashboard.processes"]; logs=state.panes["dashboard.logs"]
        state.focused[state.screen]="dashboard.processes"; state.key("end")
        frame=self.snapshot(state,120,40)
        self.assertGreater(process.offset,0); self.assertEqual(logs.selected,0)
        regions=[r for r in frame.regions if r.on_scroll]
        proc_region=regions[0]; proc_region.on_click(0,1,"left")
        self.assertEqual(process.selected,process.offset)
        regions[1].on_scroll(-3); self.assertEqual(logs.offset,3);self.assertEqual(logs.selected,0)

    def test_controls_click(self):
        state=self.state("components"); frame=self.snapshot(state)
        position=frame.find("Primary");self.assertIsNotNone(position)
        x,y=position
        region=next(r for r in reversed(frame.regions) if r.on_click and r.rect.x<=x<r.rect.x+r.rect.width and r.rect.y<=y<r.rect.y+r.rect.height)
        region.on_click(0,0,"left"); self.assertTrue(state.modal)

    def test_http_pane_uses_final_viewport(self):
        state=self.state("traffic");state.sample["telemetry"]["http"]["topPaths"]=[{"path":f"/route-{i:03d}","count":i} for i in range(50)]
        pane=state.pane("traffic.paths",50);pane.selected=49
        frame=self.snapshot(state,200,60);position=frame.find("/route-049");self.assertIsNotNone(position)
        x,y=position
        region=next(r for r in reversed(frame.regions) if r.on_click and r.rect.x<=x<r.rect.x+r.rect.width and r.rect.y<=y<r.rect.y+r.rect.height)
        self.assertEqual(pane.offset,50-region.rect.height)
        region.on_click(0,0,"left");self.assertEqual(pane.selected,pane.offset)

    def test_invalid_options_before_terminal(self):
        for args in (("--fps","0"),("--interval","nan"),("--width","999999"),("--ticks","-1"),("--seed","-1"),("--sim","--real"),("--theme","wrong")):
            with self.subTest(args=args),contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit) as raised:
                arguments(args)
            self.assertEqual(raised.exception.code,2)

    def test_cli_headless_and_non_tty(self):
        result=subprocess.run([sys.executable,"-m","hqtui_demo","--snapshot","--screen","input"],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr); self.assertIn("Last Events",result.stdout)
        result=subprocess.run([sys.executable,"-m","hqtui_demo"],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,2); self.assertIn("--snapshot",result.stderr)

    def test_rates_reset_and_first_sample(self):
        self.assertEqual(rate(100,None,1),0)
        self.assertEqual(rate(100,50,2),25)
        self.assertEqual(rate(10,50,1),0)
        self.assertEqual(rate(100,50,0),0)

    def test_real_never_contains_simulation_rows(self):
        sample=blank_sample()
        self.assertEqual(sample["processes"],[])
        self.assertEqual(sample["telemetry"]["sessions"],[])
        with patch("hqtui_demo.collect.platform.system",return_value="Unknown"),patch("hqtui_demo.collect.command",return_value=None):
            collector=Collector(); collector.refresh()
        self.assertEqual(collector.sample["processes"],[])
        self.assertTrue(collector.unavailable)

    def test_command_deadline_and_output_bound(self):
        self.assertIsNone(command([sys.executable,"-c","import time; time.sleep(5)"],timeout=.05))
        self.assertIsNone(command([sys.executable,"-c","print('x'*2000000)"],timeout=2))
        self.assertEqual(command([sys.executable,"-c","print('ok')"]),"ok\n")

    def test_quit_restores_terminal(self):
        app=App(); app.terminal=MagicMock()
        app.render=lambda fn:None
        app.frame=lambda:app.quit()
        app.start()
        app.terminal.enter.assert_called_once()
        app.terminal.restore.assert_called_once()
        self.assertFalse(app.running)

    def test_partial_enter_failure_restores_terminal(self):
        app=App(); app.terminal=MagicMock(); app.terminal.enter.side_effect=OSError("enter failed")
        with self.assertRaises(OSError): app.start()
        app.terminal.restore.assert_called_once()


if __name__=="__main__": unittest.main()
