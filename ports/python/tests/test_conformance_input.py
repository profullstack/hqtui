"""Conformance for the input parser: the same byte chunks, in the same order,
must decode to the same events — including the awkward cases where a sequence or
a bracketed-paste end marker straddles two reads."""

from __future__ import annotations

import unittest

from hqtui.input import FocusEvent, InputParser, KeyEvent, MouseEvent, PasteEvent

from .support import fixture


def describe(event) -> str:
    if isinstance(event, KeyEvent):
        return (
            f"key name={event.name} key={event.key} ctrl={event.ctrl} "
            f"alt={event.alt} shift={event.shift} char={event.char!r} raw={event.raw!r}"
        )
    if isinstance(event, MouseEvent):
        return (
            f"mouse action={event.action.value} button={event.button.value} "
            f"x={event.x} y={event.y} scroll={event.scroll} "
            f"ctrl={event.ctrl} alt={event.alt} shift={event.shift}"
        )
    if isinstance(event, PasteEvent):
        return f"paste text={event.text!r}"
    return f"focus focused={event.focused}"


def describe_fixture(d: dict) -> str:
    kind = d["type"]
    if kind == "key":
        # JSON.stringify drops an undefined `char` entirely.
        char = d.get("char")
        return (
            f"key name={d['name']} key={d['key']} ctrl={d['ctrl']} "
            f"alt={d['alt']} shift={d['shift']} char={char!r} raw={d['raw']!r}"
        )
    if kind == "mouse":
        return (
            f"mouse action={d['action']} button={d['button']} "
            f"x={d['x']} y={d['y']} scroll={d['scroll']} "
            f"ctrl={d['ctrl']} alt={d['alt']} shift={d['shift']}"
        )
    if kind == "paste":
        return f"paste text={d['text']!r}"
    return f"focus focused={d['focused']}"


class TestInput(unittest.TestCase):
    def test_matches_reference(self):
        cases = fixture("input")
        self.assertTrue(cases, "no input fixtures loaded")

        for case in cases:
            name = case["name"]
            parser = InputParser()
            events: list = []
            for chunk in case["chunks"]:
                events.extend(parser.parse(chunk))
            if case.get("flush"):
                events.extend(parser.flush())

            got = [describe(e) for e in events]
            want = [describe_fixture(d) for d in case["events"]]
            self.assertEqual(got, want, f"{name}: events")
            self.assertEqual(parser.has_pending, case["pending"], f"{name}: pending")


if __name__ == "__main__":
    unittest.main()
