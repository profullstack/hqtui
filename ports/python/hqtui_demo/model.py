"""Demo state and repeatable simulation. All counters and histories are local."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from importlib.resources import files

SCREENS = ("dashboard", "traffic", "sessions", "network", "services",
           "components", "graphics", "themes", "input", "stress")
THEMES = ("dark", "dracula", "nord", "tokyo-night", "gruvbox", "matrix",
          "monochrome", "high-contrast", "light")
LIMIT = 240


def push(history: list, value, limit: int = LIMIT) -> None:
    history.append(value)
    del history[:-limit]


def blank_sample() -> dict:
    """The schema is shared with the TypeScript reference, never its fake values."""
    def blank(value):
        if isinstance(value, dict):
            return {key: blank(item) for key, item in value.items()}
        if isinstance(value, list):
            return []
        if isinstance(value, bool):
            return False
        if isinstance(value, (int, float)):
            return 0
        return "" if isinstance(value, str) else None
    sample = blank(json.loads(files(__package__).joinpath("sample.json").read_text()))
    sample["cpu"]["load"] = [0, 0, 0]
    sample["telemetry"]["power"] = None
    sample["telemetry"]["http"] = None
    return sample


class Simulation:
    source = "simulated"
    unavailable: list[str] = []
    sensor_note = ""

    def __init__(self, seed: int = 1337):
        self.sample = json.loads(files(__package__).joinpath("sample.json").read_text())
        self.seed = seed & 0xFFFFFFFF
        self.tick = 0
        # The fixture is a source-data sample, not a rendered image. Rebuild all
        # animated histories natively so the seed affects the first frame too.
        for _ in range(120):
            self.refresh(0.1)

    def refresh(self, dt: float = 0.1) -> None:
        self.tick += 1
        s = self.sample
        t = self.tick * 0.1
        phase = (self.seed % 10000) / 100
        s["time"] = t
        cores = [max(.02, min(.98, .4 + .22 * math.sin(t / 3 + phase + i * .7))) for i in range(12)]
        c = s["cpu"]
        c.update(cores=cores, total=sum(cores) / len(cores), frequencyGhz=2.1 + cores[0])
        c["load"] = [c["total"] * n for n in (4, 3.5, 3)]
        push(c["history"], c["total"] * 100)
        m = s["memory"]
        m["used"] = m["total"] * (.42 + .05 * math.sin(t / 13 + phase))
        m["available"] = m["total"] - m["used"]
        m["free"] = max(0, m["available"] - m["cached"] - m["buffers"])
        push(m["history"], m["used"] / m["total"] * 100)
        net = s["network"]
        for direction, factor in (("down", 1), ("up", .35)):
            rate = (2 + math.sin(t / 2 + phase)) * 1024**2 * factor
            net[direction + "Rate"] = rate
            net[direction + "Total"] += rate * dt
            net[direction + "Peak"] = max(net[direction + "Peak"], rate)
            push(net[direction + "History"], rate)
        for i, disk in enumerate(s["disks"]):
            for direction, factor in (("read", 1), ("write", .4)):
                rate = (1 + math.sin(t / 4 + i + phase)) * 1024**2 * factor
                disk[direction + "Rate"] = rate
                push(disk[direction + "History"], rate)
        for i, proc in enumerate(s["processes"]):
            proc["cpu"] = max(0, 8 + 8 * math.sin(t / 3 + phase + i))
        for i, temp in enumerate(s["temperatures"]):
            temp["value"] = 42 + c["total"] * 25 + i
        s["system"]["uptime"] = 9254 + t
        telemetry = s["telemetry"]
        for i, interface in enumerate(telemetry["interfaces"]):
            interface["rxRate"] = net["downRate"] / (i + 1)
            interface["txRate"] = net["upRate"] / (i + 1)
            push(interface["rxHistory"], interface["rxRate"])
            push(interface["txHistory"], interface["txRate"])
        for key, value in (("netInHistory", net["downRate"] / 1400),
                           ("netOutHistory", net["upRate"] / 1400),
                           ("retransHistory", .1 + .1 * math.sin(t)),
                           ("connectionHistory", len(telemetry["connections"])),
                           ("sessionHistory", len(telemetry["sessions"]))):
            push(telemetry[key], value)
        if telemetry["http"]:
            telemetry["http"]["requestsPerSecond"] = 60 + 30 * math.sin(t + phase)
            push(telemetry["http"]["history"], telemetry["http"]["requestsPerSecond"])


@dataclass
class Pane:
    selected: int = 0
    offset: int = 0
    total: int = 0
    log: bool = False

    def move(self, delta: int) -> None:
        if self.log:
            self.offset=max(0,min(max(0,self.total-1),self.offset-delta));return
        self.selected = max(0, min(max(0, self.total - 1), self.selected + delta))


@dataclass
class State:
    sample: dict
    source: str
    unavailable: list[str] = field(default_factory=list)
    sensor_note: str = ""
    screen: str = "dashboard"
    theme_index: int = 0
    sort: str = "cpu"
    filter: str = ""
    filtering: bool = False
    help: bool = False
    palette: bool = False
    modal: bool = False
    palette_query: str = ""
    palette_index: int = 0
    paused: bool = False
    checkbox: bool = True
    toggle: bool = True
    select_open: bool = False
    select_index: int = 0
    input_value: str = ""
    editing: bool = False
    last_key: str = "—"
    last_mouse: str = "—"
    key_log: list[str] = field(default_factory=list)
    panes: dict[str, Pane] = field(default_factory=dict)
    focused: dict[str, str] = field(default_factory=dict)
    fps: float = 0
    render_ms: float = 0
    changed_cells: int = 0
    output_bytes: int = 0
    slider: float = .7
    clock: str = "12:00:00"

    def pane(self, name: str, total: int) -> Pane:
        pane = self.panes.setdefault(name, Pane())
        pane.total = total
        pane.move(0)
        pane.offset = max(0, min(pane.offset, max(0, total - 1)))
        self.focused.setdefault(self.screen, name)
        return pane

    def processes(self) -> list[dict]:
        rows = [p for p in self.sample["processes"] if self.filter.casefold() in (p["name"] + " " + p["command"]).casefold()]
        return sorted(rows, key=lambda p: p[self.sort], reverse=self.sort in ("cpu", "mem"))

    def commands(self) -> list[tuple[str, str]]:
        commands = [("Go to " + name.title(), name) for name in SCREENS]
        commands += [("Sort by CPU", "sort:cpu"), ("Sort by Memory", "sort:mem"), ("Pause updates", "pause")]
        return [item for item in commands if self.palette_query.casefold() in item[0].casefold()]

    def key(self, key: str, char: str = "") -> bool:
        """Return true only for an explicit quit action; overlays own their keys."""
        self.last_key = key
        push(self.key_log, key + ("  " + char if char else ""), 100)
        if key == "ctrl+c":
            return True
        if self.palette:
            matches = self.commands()
            if key == "escape": self.palette = False
            elif key == "up": self.palette_index = max(0, self.palette_index - 1)
            elif key == "down": self.palette_index = min(max(0, len(matches) - 1), self.palette_index + 1)
            elif key == "enter":
                if matches:
                    action = matches[min(self.palette_index, len(matches) - 1)][1]
                    if action == "pause": self.paused = not self.paused
                    elif action.startswith("sort:"): self.sort = action[5:]
                    else: self.screen = action
                self.palette = False
            elif key == "backspace": self.palette_query = self.palette_query[:-1]; self.palette_index = 0
            elif char: self.palette_query += char; self.palette_index = 0
            return False
        if self.help or self.modal:
            self.help = self.modal = False
            return False
        if self.filtering:
            if key == "escape": self.filtering = False; self.filter = ""
            elif key == "enter": self.filtering = False
            elif key == "backspace": self.filter = self.filter[:-1]
            elif char: self.filter += char
            return False
        if self.editing:
            if key == "escape": self.editing = False
            elif key == "backspace": self.input_value = self.input_value[:-1]
            elif char: self.input_value = (self.input_value + char)[:4096]
            return False
        if self.select_open:
            if key == "escape": self.select_open = False
            elif key == "up": self.select_index = (self.select_index - 1) % 4
            elif key == "down": self.select_index = (self.select_index + 1) % 4
            elif key == "enter": self.theme_index = self.select_index; self.select_open = False
            return False
        if key == "e" and self.screen in ("components", "input"):
            self.editing = True
            return False
        if key in ("q", "f10"): return True
        if key == "f1": self.help = True
        elif key == "f2" or (key == "right" and self.screen == "themes"): self.theme_index = (self.theme_index + 1) % len(THEMES)
        elif key == "left" and self.screen == "themes": self.theme_index = (self.theme_index - 1) % len(THEMES)
        elif key == "f3": self.filtering = True
        elif key == "f6": self.sort = ("cpu", "mem", "pid", "name")[(("cpu", "mem", "pid", "name").index(self.sort) + 1) % 4]
        elif key == "ctrl+k": self.palette = True; self.palette_query = ""; self.palette_index = 0
        elif key == "space": self.paused = not self.paused
        elif key == "enter": self.modal = True
        elif key == "tab": self.screen = SCREENS[(SCREENS.index(self.screen) + 1) % len(SCREENS)]
        elif key in "1234567890" and len(key) == 1: self.screen = SCREENS[(int(key) - 1) % 10]
        elif key in ("up", "down", "pageup", "pagedown", "home", "end"):
            pane = self.panes.get(self.focused.get(self.screen, ""))
            if pane: pane.move({"up": -1, "down": 1, "pageup": -10, "pagedown": 10, "home": -10**9, "end": 10**9}[key])
        return False
