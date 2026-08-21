import React from "react";
import { findWikilinks, parseWholeWikilink } from "../../core/wikilinks";
import { post } from "../vscodeApi";

function openWikilink(target: string): void {
  post({ type: "openWikilink", target });
}

export function Wikilink({ target, label }: { target: string; label: string }): JSX.Element {
  return (
    <a
      className="wikilink"
      onClick={(e) => {
        e.stopPropagation();
        openWikilink(target);
      }}
    >
      {label}
    </a>
  );
}

/** Renders free text, turning any [[wikilink]] segments into clickable links in place. */
export function renderWithWikilinks(text: string): React.ReactNode {
  const matches = findWikilinks(text);
  if (matches.length === 0) return text;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) nodes.push(text.slice(cursor, m.start));
    nodes.push(<Wikilink key={i} target={m.target} label={m.label} />);
    cursor = m.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** Renders a card property value (Board/Gallery views), turning [[wikilink]] syntax into
 *  clickable links — a whole array item that's nothing but a link renders as one (matching
 *  the tag-chip treatment in PropertyCell), everything else goes through the free-text scan. */
export function renderPropValue(v: unknown): React.ReactNode {
  if (Array.isArray(v)) {
    return v.map((item, i) => {
      const str = String(item);
      const link = parseWholeWikilink(str);
      return (
        <React.Fragment key={i}>
          {i > 0 && ", "}
          {link ? <Wikilink target={link.target} label={link.label} /> : str}
        </React.Fragment>
      );
    });
  }
  return renderWithWikilinks(String(v));
}

/** True when a card property value is empty and shouldn't be rendered at all: undefined,
 *  a YAML-null blank frontmatter key, an empty string, or an empty array. */
export function isBlankPropValue(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}
