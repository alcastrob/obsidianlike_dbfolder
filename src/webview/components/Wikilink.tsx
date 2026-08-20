import React from "react";
import { findWikilinks } from "../../core/wikilinks";
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
