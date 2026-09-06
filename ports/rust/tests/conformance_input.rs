//! Conformance for the input parser: the same byte chunks, in the same order,
//! must decode to the same events — including the awkward cases where a
//! sequence or a bracketed-paste end marker straddles two reads.

mod common;

use common::{fixture, Json};

use hqtui::input::{InputEvent, InputParser};

fn describe(event: &InputEvent) -> String {
    match event {
        InputEvent::Key(k) => format!(
            "key name={} key={} ctrl={} alt={} shift={} char={:?} raw={:?}",
            k.name, k.key, k.ctrl, k.alt, k.shift, k.char, k.raw
        ),
        InputEvent::Mouse(m) => format!(
            "mouse action={} button={} x={} y={} scroll={} ctrl={} alt={} shift={}",
            m.action.as_str(),
            m.button.as_str(),
            m.x,
            m.y,
            m.scroll,
            m.ctrl,
            m.alt,
            m.shift
        ),
        InputEvent::Paste(p) => format!("paste text={:?}", p.text),
        InputEvent::Focus(f) => format!("focus focused={}", f.focused),
    }
}

fn describe_fixture(event: &Json) -> String {
    match event.get("type").str() {
        "key" => format!(
            "key name={} key={} ctrl={} alt={} shift={} char={:?} raw={:?}",
            event.get("name").str(),
            event.get("key").str(),
            event.get("ctrl").bool(),
            event.get("alt").bool(),
            event.get("shift").bool(),
            // `JSON.stringify` drops an undefined `char` entirely.
            event.opt("char").map(|c| c.str().to_string()),
            event.get("raw").str()
        ),
        "mouse" => format!(
            "mouse action={} button={} x={} y={} scroll={} ctrl={} alt={} shift={}",
            event.get("action").str(),
            event.get("button").str(),
            event.get("x").usize(),
            event.get("y").usize(),
            event.get("scroll").i64(),
            event.get("ctrl").bool(),
            event.get("alt").bool(),
            event.get("shift").bool()
        ),
        "paste" => format!("paste text={:?}", event.get("text").str()),
        "focus" => format!("focus focused={}", event.get("focused").bool()),
        other => panic!("unknown event type {other:?}"),
    }
}

#[test]
fn input_matches_reference() {
    let cases = fixture("input");
    assert!(!cases.arr().is_empty(), "no input fixtures loaded");

    for case in cases.arr() {
        let name = case.get("name").str();
        let mut parser = InputParser::new();
        let mut events: Vec<InputEvent> = Vec::new();
        for chunk in case.get("chunks").arr() {
            events.extend(parser.parse(chunk.str()));
        }
        if case.opt("flush").map(|f| f.bool()).unwrap_or(false) {
            events.extend(parser.flush());
        }

        let got: Vec<String> = events.iter().map(describe).collect();
        let want: Vec<String> = case.get("events").arr().iter().map(describe_fixture).collect();
        assert_eq!(got, want, "{name}: events");
        assert_eq!(parser.has_pending(), case.get("pending").bool(), "{name}: pending");
    }
}
