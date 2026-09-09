/**
 * A clickable world map: `bun examples/world.ts`
 *
 * Click a country to select it, hover to see what is under the cursor, and
 * press z to zoom to the selection or r to go back to the whole globe.
 *
 * The map is the canvas drawing polylines in degrees, which is all a map is
 * once the canvas works in the caller's own coordinates. The clicking is the
 * other direction: the cell under the cursor is turned back into a longitude
 * and latitude and tested against the outlines, so the answer is the country
 * actually there rather than whichever bounding box happened to be first.
 */
import { createApp, countryBounds, findCountry, WORLD_X, WORLD_Y } from "@profullstack/hqtui";
import type { CountryOutline, Bounds } from "@profullstack/hqtui";

let selected: CountryOutline | undefined;
let hovered: CountryOutline | undefined;
let window: { x: Bounds; y: Bounds } = { x: WORLD_X, y: WORLD_Y };

const app = await createApp({ title: "hqtui · world" });

app.render(({ ui, theme }) => {
  const shown = hovered ?? selected;
  const zoomed = window.x !== WORLD_X;

  ui.panel(
    {
      title: "World",
      subtitle: shown ? shown.name : "click a country",
      footer: zoomed ? "z zoom · r reset · q quit" : "z zoom to selection · q quit",
    },
    (p) => {
      p.worldMap({
        ...window,
        color: theme.border,
        highlight: [selected?.iso || selected?.name || "", hovered?.iso || hovered?.name || ""],
        highlightColor: theme.accent,
        onSelect: (country) => {
          selected = country;
          app.invalidate();
        },
        onHover: (country) => {
          if (country?.name !== hovered?.name) {
            hovered = country;
            app.invalidate();
          }
        },
      });

      p.row({ size: 1, gap: 2 }, (row) => {
        row.keyValues(
          [
            { label: "Selected", value: selected?.name ?? "—" },
            { label: "ISO", value: selected?.iso || "—" },
          ],
          { spread: false },
        );
      });
    },
  );
});

app.on("key", (key) => {
  if (key.name === "z" && selected) {
    window = countryBounds(selected);
    app.invalidate();
  }
  if (key.name === "r") {
    window = { x: WORLD_X, y: WORLD_Y };
    app.invalidate();
  }
});

// Somewhere to start from, so the first frame is not an empty selection.
selected = findCountry("Japan");

await app.start();
