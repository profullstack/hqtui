"""The same cases as packages/hqtui/test/emoji.test.ts."""
import unittest

from hqtui import emoji, emoji_info, emoji_mode, emoji_names, emoji_search, emojify, set_emoji_mode
from hqtui.unicode import string_width


class EmojiTests(unittest.TestCase):
    def test_built_in_and_every_name_form(self):
        self.assertGreaterEqual(len(emoji_names()), 3900)
        for name in ("fire", "oe_fire", ":oe_fire:", ":fire:", "FIRE", "🔥"):
            self.assertEqual(emoji(name, "emoji"), "🔥", name)
        self.assertEqual(emoji("face with tears of joy", "emoji"), "😂")
        self.assertEqual(emoji("thumbsup", "emoji"), "👍")
        self.assertEqual(emoji("+1", "emoji"), "👍")
        self.assertEqual(emoji("heart", "emoji"), "❤️")
        self.assertEqual(emoji("❤", "emoji"), "❤️")
        self.assertEqual(emoji("no such emoji"), "")

    def test_tones_and_text(self):
        toned = emoji_info("thumbs_up_t3")
        self.assertEqual(toned.char, "👍🏽")
        self.assertEqual(toned.name, "thumbs up: medium skin tone")
        self.assertEqual(emoji_info("👩🏾‍💻").shortcode, "oe_woman_technologist_t4")
        self.assertEqual(emoji("slightly smiling face", "text"), ":)")
        self.assertEqual(emoji("heart", "text"), "<3")
        self.assertEqual(emoji("thumbs_up_t3", "text"), "+1")
        self.assertEqual(emoji("fire", "text"), "[fire]")

    def test_mode_order(self):
        self.assertEqual(emoji_mode({"HQTUI_EMOJI": "text", "LANG": "en_US.UTF-8"}), "text")
        self.assertEqual(emoji_mode({"LANG": "en_US.UTF-8", "TERM": "linux"}), "text")
        self.assertEqual(emoji_mode({"LANG": "en_US.UTF-8", "TERM": "xterm-256color"}), "emoji")
        set_emoji_mode("text")
        try:
            self.assertEqual(emoji_mode({"HQTUI_EMOJI": "emoji"}), "text")
        finally:
            set_emoji_mode(None)

    def test_emojify_and_search(self):
        self.assertEqual(emojify("ship :rocket: :+1: at 12:30:00 :nope:", "emoji"), "ship 🚀 👍 at 12:30:00 :nope:")
        self.assertEqual(emoji_search("fire")[0].char, "🔥")
        self.assertIn("🇯🇵", [e.char for e in emoji_search("japan")])
        self.assertIn("😂", [e.char for e in emoji_search("lol")])

    def test_two_columns(self):
        for name in ("fire", "thumbs_up_t3", "flag_japan", "keycap_hash", "heart", "woman_technologist_t4"):
            self.assertEqual(string_width(emoji(name, "emoji")), 2, name)


if __name__ == "__main__":
    unittest.main()
