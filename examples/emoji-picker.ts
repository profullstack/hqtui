/**
 * A message composer with the OpenEmoji picker. `bun examples/emoji-picker.ts`
 *
 * Type a message; Ctrl+E opens the picker. Pick with
 * Enter or a click, and the emoji lands at the caret. Enter sends. Ctrl+C quits.
 */
import { createApp, editText, emojify, insertText, widgets, type TextEditState } from "@profullstack/hqtui";

let field: TextEditState = { value: "", cursor: 0 };
let picker: widgets.EmojiPickerState | undefined;
let recent: string[] = [];
const sent: string[] = [];

const app = await createApp({ quitKeys: ["ctrl+c"] });

app.on("key", (event) => {
  if (picker) return; // the picker's own onKey has it
  if (event.key === "ctrl+e") {
    picker = widgets.createEmojiPicker(recent);
  } else if (event.key === "enter") {
    // :shortcodes: typed by hand become emoji on send.
    if (field.value.trim()) sent.push(emojify(field.value.trim()));
    field = { value: "", cursor: 0 };
  } else {
    field = editText(field, event) ?? field;
  }
});
app.on("paste", (event) => {
  if (!picker) field = insertText(field, event.text);
});

app.render(({ ui, height }) => {
  ui.panel({ title: "Messages", size: Math.max(3, height - 4) }, (p) => {
    if (!sent.length) p.label("Nothing sent yet. Try :rocket: or Ctrl+E.");
    for (const line of sent.slice(-(height - 6))) p.text(line);
  });
  ui.textInput({ value: field.value, cursor: field.cursor, placeholder: "Message (Ctrl+E for emoji)", focused: !picker });
  ui.label("Enter send · Ctrl+E emoji · Ctrl+C quit");
  if (picker) {
    ui.emojiPicker({
      state: picker,
      recent,
      onChange: (state) => { picker = state; },
      onPick: (emoji) => {
        field = insertText(field, emoji.char);
        recent = [emoji.char, ...recent.filter((c) => c !== emoji.char)].slice(0, 30);
        picker = undefined;
      },
      onClose: () => { picker = undefined; },
    });
  }
});

await app.start();
