import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

// The GitHub token lives in a file, one trimmed line, so the poller does not call `gh` (and `gh`
// does not call `security`). The path is ~/.config/plania/github-token unless PLANIA_GITHUB_TOKEN_FILE
// or the argument says otherwise. Every call stats the file and re-reads it when the mtime or size
// changes. A mode that lets the group or others read it still returns the token, and logs one note
// per mtime, with no file contents. A missing file, an empty file, or more than one line is no token.
// Nothing here throws.

export type TokenFile = { token: string | null; modeNote: string | null; path: string };

const cache = new Map<string, { mtimeMs: number; size: number; token: string | null }>();
const warned = new Set<string>();

export function resetTokenFileCache(): void {
  cache.clear();
  warned.clear();
}

/** A single trimmed line, or null when the text is empty or has more than one line. */
export function oneLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

export function githubTokenFilePath(env: Record<string, string | undefined> = process.env): string {
  return env.PLANIA_GITHUB_TOKEN_FILE || join(homedir(), ".config", "plania", "github-token");
}

export function githubReleaseTokenFilePath(env: Record<string, string | undefined> = process.env): string {
  return env.PLANIA_GITHUB_RELEASE_TOKEN_FILE || join(homedir(), ".config", "plania", "github-release-token");
}

function displayPath(file: string): string {
  const home = homedir();
  if (home && (file === home || file.startsWith(home + sep))) return `~${file.slice(home.length)}`;
  return file;
}

function modeNoteFor(mode: number): string | null {
  if ((mode & 0o077) === 0) return null;
  const bits = (mode & 0o777).toString(8).padStart(3, "0");
  return `mode ${bits} is group or world readable`;
}

function warnMode(file: string, mtimeMs: number, modeNote: string | null): void {
  if (!modeNote) return;
  const key = `${file}\0${mtimeMs}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[plania] ${displayPath(file)} ${modeNote}`);
}

export function readTokenFile(filePath?: string, env: Record<string, string | undefined> = process.env): TokenFile {
  const file = filePath || githubTokenFilePath(env);
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(file);
  } catch {
    return { token: null, modeNote: null, path: file };
  }
  const modeNote = modeNoteFor(st.mode);
  warnMode(file, st.mtimeMs, modeNote);
  const prev = cache.get(file);
  if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return { token: prev.token, modeNote, path: file };
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { token: null, modeNote, path: file };
  }
  const token = oneLine(text);
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, token });
  return { token, modeNote, path: file };
}
