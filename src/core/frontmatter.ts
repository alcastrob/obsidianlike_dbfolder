import * as fs from "fs";
import matter from "gray-matter";

export interface ParsedNote {
  data: Record<string, unknown>;
  content: string;
}

export function readNote(filePath: string): ParsedNote {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  return { data: parsed.data ?? {}, content: parsed.content ?? "" };
}

/**
 * Merges `updates` into the note's frontmatter and writes the file back,
 * preserving the body content untouched. A key set to `undefined` is removed.
 */
export function writeFrontmatter(
  filePath: string,
  updates: Record<string, unknown>
): void {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  const data = { ...parsed.data };

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete data[key];
    } else {
      data[key] = value;
    }
  }

  const output = matter.stringify(parsed.content ?? "", data);
  fs.writeFileSync(filePath, output, "utf8");
}

export function createNote(
  filePath: string,
  data: Record<string, unknown>,
  content = ""
): void {
  const output = matter.stringify(content, data);
  fs.writeFileSync(filePath, output, "utf8");
}
