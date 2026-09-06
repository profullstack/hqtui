"""The smallest real app: ``python examples/hello.py``. Press q to quit."""

from hqtui import App, Panel


def main() -> None:
    app = App()

    def view(f):
        def body(p):
            p.text("Hello, terminal.")
            p.label("Press q to quit.")

        f.ui.panel(Panel(title="Hello"), body)

    app.render(view)
    app.start()


if __name__ == "__main__":
    main()
