// Gallery view's cover column value doesn't always arrive as the plain string it
// looks like on the page. Two YAML shapes get in the way, both handled here so the
// host (image resolution) and the webview (text/URL rendering) agree on what a cover
// value "is" without duplicating this logic:
//
// - Obsidian's "List" property type stores even a single value as a one-item array
//   (`Imagen:\n  - "[[foo.png]]"` -> `["[[foo.png]]"]`).
// - A wikilink written directly as an unquoted scalar (`Imagen: [[foo.png]]`, no
//   quotes) isn't a string to YAML at all: `[` starts a flow sequence, so `[[x]]`
//   parses as a *nested* one-item array (`[["x"]]`) and the literal "[[" "]]"
//   characters are consumed as list syntax rather than preserved in a string -
//   there is no way to recover "this was meant to be a wikilink" except by shape,
//   but a doubly-nested single string is exactly (and only) what that YAML gotcha
//   produces, so it's reconstructed back into the `[[x]]` text it clearly meant.

/** Normalizes a raw column value down to the single string a cover should render,
 *  or undefined when it isn't unambiguously one (empty, a multi-item array, ...). */
export function resolveCoverText(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw.trim() || undefined;
  if (Array.isArray(raw) && raw.length === 1) {
    const [item] = raw;
    if (typeof item === "string") return item.trim() || undefined;
    if (Array.isArray(item) && item.length === 1 && typeof item[0] === "string") {
      return `[[${item[0]}]]`;
    }
  }
  return undefined;
}
