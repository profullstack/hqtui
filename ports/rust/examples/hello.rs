//! The smallest real app: `cargo run --example hello`. Press q to quit.

use hqtui::prelude::*;

fn main() -> std::io::Result<()> {
    App::new()?.run(|f| {
        f.ui.panel(Panel::new().title("Hello"), |p| {
            p.text("Hello, terminal.");
            p.label("Press q to quit.");
        });
    })
}
