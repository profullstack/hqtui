import type { Surface, Align } from "../surface.ts";
import { Attr, type Style } from "../buffer.ts";
import { type Color, mix } from "../color.ts";
import { fit, stringWidth, truncate, wrap } from "../unicode.ts";
import { elevate } from "../theme.ts";

export interface ButtonOptions {
  label: string;
  focused?: boolean;
  color?: Color;
  variant?: "primary" | "success" | "warning" | "danger" | "ghost";
  disabled?: boolean;
  width?: number;
  align?: Align;
}

function variantColor(surface: Surface, options: ButtonOptions): Color {
  const t = surface.theme;
  if (options.color) return options.color;
  switch (options.variant) {
    case "success": return t.success;
    case "warning": return t.warning;
    case "danger": return t.danger;
    case "ghost": return t.muted;
    default: return t.primary;
  }
}

/** Returns the width it drew, so callers can lay buttons out in a row. */
export function drawButton(surface: Surface, options: ButtonOptions): number {
  if (surface.empty) return 0;
  const theme = surface.theme;
  const color = variantColor(surface, options);
  const label = ` ${options.label} `;
  const width = Math.min(options.width ?? stringWidth(label), surface.width);
  const ghost = options.variant === "ghost";
  const style: Style = options.disabled
    ? { fg: theme.muted, bg: elevate(theme, 0.05) }
    : options.focused
      ? { fg: theme.dark ? theme.background : theme.surface, bg: color, attrs: Attr.Bold }
      : ghost
        ? { fg: color, bg: undefined }
        : { fg: color, bg: mix(theme.surface, color, 0.16), attrs: Attr.Bold };
  surface.text(0, 0, fit(truncate(label, width), width, options.align ?? "center"), style);
  return width;
}

export interface CheckboxOptions {
  label?: string;
  checked: boolean;
  focused?: boolean;
  color?: Color;
  /** Render as a switch instead of a box. */
  variant?: "checkbox" | "toggle" | "radio";
}

export function drawCheckbox(surface: Surface, options: CheckboxOptions): number {
  if (surface.empty) return 0;
  const theme = surface.theme;
  const color = options.color ?? (options.checked ? theme.success : theme.muted);
  const glyph =
    options.variant === "toggle"
      ? options.checked ? "[▮ ]" : "[ ▮]"
      : options.variant === "radio"
        ? options.checked ? "(●)" : "( )"
        : options.checked ? "[✓]" : "[ ]";
  let x = surface.text(0, 0, glyph, { fg: color, attrs: options.focused ? Attr.Bold : 0 });
  if (options.label) {
    x += surface.text(x, 0, ` ${options.label}`, {
      fg: options.focused ? theme.foreground : theme.muted,
      attrs: options.focused ? Attr.Bold : 0,
    });
  }
  return x;
}

export interface SelectOptions {
  value: string;
  focused?: boolean;
  open?: boolean;
  options?: string[];
  selectedIndex?: number;
  width?: number;
  color?: Color;
}

/** A closed dropdown, or an open one with its option list underneath. */
export function drawSelect(surface: Surface, options: SelectOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const width = Math.min(options.width ?? surface.width, surface.width);
  const color = options.color ?? (options.focused ? theme.borderFocused : theme.border);
  const label = ` ${truncate(options.value, Math.max(0, width - 4))}`;
  surface.text(0, 0, fit(label, width - 2), {
    fg: theme.foreground,
    bg: elevate(theme, 0.05),
    attrs: options.focused ? Attr.Bold : 0,
  });
  surface.text(width - 2, 0, options.open ? " ▴" : " ▾", { fg: color, bg: elevate(theme, 0.05) });

  if (options.open && options.options?.length) {
    const list = options.options;
    const height = Math.min(list.length, surface.height - 1);
    for (let i = 0; i < height; i++) {
      const selected = i === (options.selectedIndex ?? 0);
      surface.text(0, i + 1, fit(` ${truncate(list[i], width - 2)}`, width), {
        fg: selected ? theme.selectionText : theme.foreground,
        bg: selected ? theme.selection : elevate(theme, 0.08),
      });
    }
  }
}

export interface TextInputOptions {
  value: string;
  placeholder?: string;
  focused?: boolean;
  /** Caret index; defaults to the end of the value. */
  cursor?: number;
  width?: number;
  label?: string;
  password?: boolean;
  color?: Color;
}

export function drawTextInput(surface: Surface, options: TextInputOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const width = Math.min(options.width ?? surface.width, surface.width);
  const labelWidth = options.label ? stringWidth(options.label) + 1 : 0;
  if (options.label) {
    surface.text(0, 0, options.label, { fg: theme.muted });
  }
  const fieldWidth = Math.max(0, width - labelWidth);
  const bg = elevate(theme, options.focused ? 0.1 : 0.05);
  surface.fillRect(labelWidth, 0, fieldWidth, 1, { bg });

  const shown = options.password ? "•".repeat(options.value.length) : options.value;
  const empty = shown.length === 0;
  const text = empty ? options.placeholder ?? "" : shown;
  surface.text(labelWidth + 1, 0, truncate(text, Math.max(0, fieldWidth - 2)), {
    fg: empty ? theme.muted : theme.foreground,
    bg,
  });

  if (options.focused) {
    const cursorX = Math.min(
      labelWidth + 1 + (options.cursor ?? stringWidth(shown)),
      labelWidth + fieldWidth - 1,
    );
    surface.styleRect(cursorX, 0, 1, 1, { bg: options.color ?? theme.cursor, fg: theme.background });
  }
}

export interface TabsOptions {
  tabs: string[];
  active: number;
  color?: Color;
  align?: Align;
  /** Underline the active tab instead of filling it. */
  variant?: "filled" | "underline";
}

export function drawTabs(surface: Surface, options: TabsOptions): void {
  if (surface.empty) return;
  const theme = surface.theme;
  const color = options.color ?? theme.accent;
  const variant = options.variant ?? "filled";
  const total = options.tabs.reduce((a, t) => a + stringWidth(t) + 4, 0);
  let x = options.align === "center" ? Math.max(0, Math.floor((surface.width - total) / 2))
    : options.align === "right" ? Math.max(0, surface.width - total) : 0;

  options.tabs.forEach((tab, i) => {
    const active = i === options.active;
    const label = `  ${tab}  `;
    const style: Style = active
      ? variant === "filled"
        ? { fg: theme.dark ? theme.background : theme.surface, bg: color, attrs: Attr.Bold }
        : { fg: color, attrs: Attr.Bold | Attr.Underline }
      : { fg: theme.muted };
    x += surface.text(x, 0, label, style);
  });
}

export interface ModalOptions {
  title?: string;
  message?: string;
  width?: number;
  height?: number;
  /** Dim the screen behind the dialog. Default true. */
  backdrop?: boolean;
  buttons?: { label: string; variant?: ButtonOptions["variant"]; focused?: boolean }[];
  color?: Color;
  align?: Align;
}

/**
 * Centres a dialog over the whole surface and returns its interior, so callers
 * can draw custom content instead of `message` if they want to.
 */
export function drawModal(root: Surface, options: ModalOptions): Surface {
  const theme = root.theme;
  if (options.backdrop !== false) {
    // Dim rather than blank: the dashboard stays legible behind the dialog.
    root.styleRect(0, 0, root.width, root.height, { fg: mix(theme.foreground, theme.background, 0.72) });
  }

  const width = Math.min(options.width ?? 48, root.width - 2);
  const messageLines = options.message ? wrap(options.message, width - 4).length : 0;
  const height = Math.min(
    options.height ?? messageLines + (options.buttons?.length ? 5 : 4),
    root.height - 2,
  );
  const x = Math.max(0, Math.floor((root.width - width) / 2));
  const y = Math.max(0, Math.floor((root.height - height) / 2));

  const surface = root.sub(x, y, width, height);
  const inner = surface.box({
    title: options.title,
    titleAlign: options.align ?? "center",
    border: "rounded",
    borderColor: options.color ?? theme.borderFocused,
    bg: elevate(theme, 0.08),
  });

  if (options.message) {
    const lines = wrap(options.message, inner.width - 2);
    lines.forEach((line, i) => {
      if (i + 1 >= inner.height) return;
      inner.text(1, i + 1, fit(line, inner.width - 2, options.align ?? "center"), { fg: theme.foreground });
    });
  }

  if (options.buttons?.length) {
    const widths = options.buttons.map((b) => stringWidth(b.label) + 4);
    const total = widths.reduce((a, b) => a + b + 2, -2);
    let bx = Math.max(0, Math.floor((inner.width - total) / 2));
    const by = inner.height - 2;
    options.buttons.forEach((button, i) => {
      drawButton(inner.sub(bx, by, widths[i], 1), {
        label: button.label,
        variant: button.variant,
        focused: button.focused,
        width: widths[i],
      });
      bx += widths[i] + 2;
    });
  }

  return inner;
}

export interface CommandPaletteOptions {
  query: string;
  items: { label: string; hint?: string }[];
  selected?: number;
  width?: number;
  height?: number;
  placeholder?: string;
}

/** Ctrl+K style palette: a query line above a filtered list. */
export function drawCommandPalette(root: Surface, options: CommandPaletteOptions): void {
  const theme = root.theme;
  const width = Math.min(options.width ?? 60, root.width - 2);
  const height = Math.min(options.height ?? Math.min(options.items.length + 4, 14), root.height - 2);
  const x = Math.max(0, Math.floor((root.width - width) / 2));
  const y = Math.max(1, Math.floor(root.height / 5));

  root.styleRect(0, 0, root.width, root.height, { fg: mix(theme.foreground, theme.background, 0.7) });
  const surface = root.sub(x, y, width, height);
  const inner = surface.box({
    border: "rounded",
    borderColor: theme.borderFocused,
    bg: elevate(theme, 0.1),
    title: "Command Palette",
  });

  inner.text(0, 0, "› ", { fg: theme.accent, attrs: Attr.Bold });
  inner.text(2, 0, options.query || options.placeholder || "Type a command…", {
    fg: options.query ? theme.foreground : theme.muted,
  });
  inner.hline(0, 1, inner.width, "─", { fg: theme.border });

  const listHeight = inner.height - 2;
  for (let i = 0; i < listHeight; i++) {
    const item = options.items[i];
    if (!item) break;
    const selected = i === (options.selected ?? 0);
    const yy = i + 2;
    if (selected) inner.fillRect(0, yy, inner.width, 1, { bg: theme.selection });
    inner.text(1, yy, truncate(item.label, inner.width - 2), {
      fg: selected ? theme.selectionText : theme.foreground,
      bg: selected ? theme.selection : undefined,
      attrs: selected ? Attr.Bold : 0,
    });
    if (item.hint) {
      const hw = stringWidth(item.hint);
      if (hw + 3 < inner.width) {
        inner.text(inner.width - hw - 1, yy, item.hint, {
          fg: theme.muted,
          bg: selected ? theme.selection : undefined,
        });
      }
    }
  }
}

export interface TooltipOptions {
  text: string;
  x: number;
  y: number;
  color?: Color;
}

export function drawTooltip(root: Surface, options: TooltipOptions): void {
  const theme = root.theme;
  const width = Math.min(stringWidth(options.text) + 4, root.width);
  const x = Math.max(0, Math.min(options.x, root.width - width));
  const y = Math.max(0, Math.min(options.y, root.height - 3));
  const surface = root.sub(x, y, width, 3);
  const inner = surface.box({
    border: "rounded",
    borderColor: options.color ?? theme.borderFocused,
    bg: elevate(theme, 0.12),
  });
  inner.text(0, 0, truncate(options.text, inner.width), { fg: theme.foreground });
}
