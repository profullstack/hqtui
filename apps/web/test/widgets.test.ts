import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const catalog = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../content/widgets.json"), "utf8"),
) as {
  languages: { id: string; label: string }[];
  widgets: { id: string; examples: Record<string, { code: string } | undefined> }[];
};

// The site used to explain its gaps rather than close them: it told readers a
// widget was "not yet in Ruby, PHP, Perl, COBOL" because those reach the
// library through a narrower core. That was never true — they were verbs
// nobody had finished. This asserts the claim the site now makes.
test("every language has a runnable example for every widget", () => {
  const gaps: string[] = [];
  for (const widget of catalog.widgets) {
    for (const language of catalog.languages) {
      const code = widget.examples[language.id]?.code;
      if (!code || code.trim().length === 0) gaps.push(`${language.id}/${widget.id}`);
    }
  }
  assert.deepEqual(gaps, [], `missing examples: ${gaps.join(", ")}`);
});

test("the catalog covers the widgets and languages the site promises", () => {
  assert.equal(catalog.widgets.length, 31);
  assert.equal(catalog.languages.length, 11);
  assert.ok(catalog.languages.some((language) => language.id === "cobol"));
});
