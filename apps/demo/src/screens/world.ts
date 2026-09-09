import type { Container, Theme } from "@profullstack/hqtui";
import { WORLD_COUNTRIES, WORLD_X, WORLD_Y, countryBounds } from "@profullstack/hqtui";
import { focusPane, pane, panelGap, scrollPane, type DemoState } from "../state.ts";

/** How many coordinates a country's outlines are drawn from. */
function pointCount(rings: number[][]): number {
  let total = 0;
  for (const ring of rings) total += ring.length / 2;
  return total;
}

function degrees(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(1)}°${value >= 0 ? positive : negative}`;
}

/**
 * The clickable world map.
 *
 * The country list and the map are two views of one selection rather than two
 * selections that have to be kept in step: the list's pane index *is* which
 * country is picked, so the arrows move the highlight on the map for free, and
 * a click on the map only has to move the list.
 */
export function worldScreen(ui: Container, state: DemoState, theme: Theme): void {
  const gap = panelGap(state);
  const countries = pane(state, "world.countries", WORLD_COUNTRIES.length);
  const selected = WORLD_COUNTRIES[countries.selected];
  const hovered = state.worldHovered ? WORLD_COUNTRIES.find((c) => c.name === state.worldHovered) : undefined;

  // Zooming is only meaningful with something to zoom to, and a country whose
  // outlines are a single pixel would otherwise zoom to an empty window.
  const window = state.worldZoom && selected ? countryBounds(selected) : { x: WORLD_X, y: WORLD_Y };

  ui.row({ size: "1fr", gap }, (row) => {
    row.panel({
      title: "World",
      subtitle: hovered ? hovered.name : selected?.name ?? "click a country",
      subtitleColor: hovered ? theme.accent : theme.muted,
      borderColor: theme.primary,
      footer: state.worldZoom ? "click select · z zoom · r whole globe" : "click select · z zoom to selection",
    }, (p) => {
      p.worldMap({
        ...window,
        color: theme.border,
        highlight: [selected?.iso || selected?.name || "", hovered?.iso || hovered?.name || ""],
        highlightColor: theme.accent,
        onSelect: (country) => {
          if (!country) return;
          const index = WORLD_COUNTRIES.findIndex((c) => c.name === country.name);
          if (index >= 0) {
            countries.selected = index;
            focusPane(state, "world.countries");
          }
        },
        onHover: (country) => {
          state.worldHovered = country?.name ?? "";
        },
      });
    });

    row.column({ width: 34, gap, bordered: true }, (column) => {
      column.panel({ title: "Selection", size: 9, borderColor: theme.accent }, (p) => {
        if (!selected) {
          p.label("Nothing selected.");
          return;
        }
        const b = countryBounds(selected);
        p.keyValues([
          { label: "Country", value: selected.name, color: theme.accent },
          { label: "ISO", value: selected.iso || "—" },
          { label: "Longitude", value: `${degrees(b.x.min, "E", "W")} – ${degrees(b.x.max, "E", "W")}`, color: theme.primary },
          { label: "Latitude", value: `${degrees(b.y.min, "N", "S")} – ${degrees(b.y.max, "N", "S")}`, color: theme.primary },
          { label: "Outlines", value: String(selected.rings.length), color: theme.muted },
          { label: "Points", value: String(pointCount(selected.rings)), color: theme.muted },
        ], { spread: false });
      });

      column.panel({
        title: "Countries",
        subtitle: String(WORLD_COUNTRIES.length),
        size: "1fr",
        borderColor: theme.secondary,
      }, (p) => {
        p.table({
          rows: WORLD_COUNTRIES as unknown as Array<{ name: string; iso: string }>,
          selected: countries.selected,
          offset: countries.offset,
          followSelection: true,
          onScroll: (delta) => scrollPane(countries, delta),
          onFocus: () => focusPane(state, "world.countries"),
          onSelectRow: (row) => { countries.selected = countries.offset + row; },
          zebra: true,
          scrollbar: true,
          columns: [
            { key: "name", title: "Country", min: 16, color: theme.foreground },
            { key: "iso", title: "ISO", width: 4, color: theme.muted },
          ],
        });
      });
    });
  });
}
