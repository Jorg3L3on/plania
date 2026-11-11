// Vendored from src/lib/scan for the private scanner repo. No plaintext patterns.
// PLA-04: the added lines of a unified diff (`git diff --unified=0`), with file and new line number,
// plus the files the diff adds or changes. Removed and context lines are not scanned.

export type AddedLine = { file: string; line: number; text: string };

export function addedLines(diff: string): { lines: AddedLine[]; files: string[] } {
  const lines: AddedLine[] = [];
  const files: string[] = [];
  let file: string | null = null;
  let next = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4).trim();
      file = path === "/dev/null" ? null : path.replace(/^b\//, "");
      if (file) files.push(file);
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff --git ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (raw.startsWith("+")) lines.push({ file, line: next++, text: raw.slice(1) });
    else if (raw.startsWith(" ")) next++;
  }
  return { lines, files };
}
