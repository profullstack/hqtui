"""A stopped loop must still restore the terminal it entered."""
import unittest
from unittest.mock import MagicMock

from hqtui import App


class AppCleanupTests(unittest.TestCase):
    def test_quit_restores_terminal_once(self):
        app = App()
        app.terminal = MagicMock()
        app.frame = lambda: app.quit()
        app.start()
        app.stop()
        app.terminal.enter.assert_called_once()
        app.terminal.restore.assert_called_once()

    def test_partial_enter_failure_restores_terminal(self):
        app = App()
        app.terminal = MagicMock()
        app.terminal.enter.side_effect = RuntimeError("partial enter")
        with self.assertRaisesRegex(RuntimeError, "partial enter"):
            app.start()
        app.terminal.restore.assert_called_once()
