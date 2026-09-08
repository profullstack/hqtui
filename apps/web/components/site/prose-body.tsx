"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CopyButton } from "@/components/site/copy-button";

/**
 * Prose rendered from our own markdown, with a copy button on every code block.
 *
 * The blog and the cookbook render to an HTML string rather than to React, so
 * there is no element to hang a button off at render time. This finds the
 * wrappers `renderMarkdown` emits after mount and portals a real React button
 * into each — the same component the rest of the site uses, so a snippet in a
 * chapter behaves exactly like a snippet on the widget gallery.
 *
 * Server-rendered output is the prose alone. The buttons appear on hydration,
 * which is the right way round: a button that cannot copy anything until its
 * JavaScript arrives should not be painted before then.
 */
export function ProseBody({ html, className }: { html: string; className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<HTMLElement[]>([]);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    setBlocks(Array.from(root.querySelectorAll<HTMLElement>(".code-block")));
    // `html` is the whole body, so a new chapter re-runs this and drops the
    // portals that pointed into the old one.
  }, [html]);

  return (
    <>
      {/* Rendered by lib/blog.ts from files in this repository, never from user
          input, and every text node in it is escaped there. */}
      <div ref={container} className={className} dangerouslySetInnerHTML={{ __html: html }} />
      {blocks.map((block, i) =>
        createPortal(<CopyButton text={block.textContent ?? ""} label="code" />, block, String(i)),
      )}
    </>
  );
}
