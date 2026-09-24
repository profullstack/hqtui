"""The same cases as packages/hqtui/test/icons.test.ts."""
import unittest

from hqtui import icon, icon_glyphs, icon_mode, icon_names, set_icon_mode
from hqtui.icons_data import OPENICON_GLYPHS


class IconTests(unittest.TestCase):
    def test_modes_and_aliases(self):
        self.assertEqual(icon("mail", "nerd"), "\U000f01f0")
        self.assertEqual(icon("mail", "unicode"), "✉")
        self.assertEqual(icon("mail", "ascii"), "@")
        self.assertEqual(icon("email", "ascii"), "@")
        self.assertEqual(icon("twitter", "ascii"), "x")
        self.assertEqual(icon("no-such-icon"), "")

    def test_nerd_falls_back_to_unicode(self):
        key, _, uni, _ = next(row for row in OPENICON_GLYPHS if row[1] == "")
        self.assertEqual(icon(key, "nerd"), uni)

    def test_mode_order(self):
        self.assertEqual(icon_mode({"OPENICON_GLYPHS": "ascii", "NERD_FONT": "1", "LANG": "en_US.UTF-8"}), "ascii")
        self.assertEqual(icon_mode({"HQTUI_ICONS": "nerd"}), "nerd")
        self.assertEqual(icon_mode({"NERD_FONT": "1"}), "nerd")
        self.assertEqual(icon_mode({"LANG": "en_US.UTF-8", "TERM": "xterm-256color"}), "unicode")
        self.assertEqual(icon_mode({"TERM": "dumb"}), "ascii")
        set_icon_mode("ascii")
        try:
            self.assertEqual(icon_mode({"NERD_FONT": "1"}), "ascii")
            self.assertEqual(icon("phone"), "tel")
        finally:
            set_icon_mode(None)

    def test_table(self):
        names = icon_names()
        self.assertGreaterEqual(len(names), 300)
        self.assertEqual(names, sorted(names))
        self.assertIsNotNone(icon_glyphs("github"))


if __name__ == "__main__":
    unittest.main()
