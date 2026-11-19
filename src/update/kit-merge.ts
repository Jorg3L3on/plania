// PLA-I2-8: the buyer's kit edits survive an update. A kit file (role prompt, skill) the buyer changed since it was
// shipped is never overwritten: the buyer's copy goes into the new program files, and when the release also changed
// that file, the release's version is put beside it under kit.new/ so the buyer can compare. Files the buyer added
// stay. What was shipped is known from the previous manifest's `kit` hashes; without them (an older package), any
// file that differs from the new release counts as the buyer's.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileHash } from "../release.js";

export const KIT_NEW = "kit.new";

// What happened to one of the buyer's kit files. `both` means the release changed it too: theirs is kept, ours is in
// kit.new/<file>.
export type KitKept = { file: string; kind: "edited" | "both" | "added" };

function listFiles(dir: string, rel = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, r));
    else out.push(r);
  }
  return out;
}

// prevRoot: the program files being replaced; nextRoot: the new release, already in place. Copies the buyer's kit
// files over the new ones and returns what it kept.
export function keepKitEdits(prevRoot: string, nextRoot: string, shipped: Record<string, string> | null): KitKept[] {
  const prevKit = path.join(prevRoot, "kit");
  const nextKit = path.join(nextRoot, "kit");
  const kept: KitKept[] = [];
  for (const rel of listFiles(prevKit)) {
    const mine = path.join(prevKit, rel);
    const theirs = path.join(nextKit, rel);
    const mineHash = fileHash(mine);
    const nextHash = existsSync(theirs) ? fileHash(theirs) : null;
    if (nextHash === mineHash) continue;
    const original = shipped ? (shipped[rel] ?? null) : null;
    let kind: KitKept["kind"];
    if (shipped) {
      if (original === null) kind = "added";
      else if (original === mineHash) continue; // untouched by the buyer: the release's version wins
      else kind = nextHash === null || nextHash === original ? "edited" : "both";
    } else {
      kind = nextHash === null ? "added" : "both";
    }
    if (kind === "both") {
      const beside = path.join(nextRoot, KIT_NEW, rel);
      mkdirSync(path.dirname(beside), { recursive: true });
      cpSync(theirs, beside);
    }
    mkdirSync(path.dirname(theirs), { recursive: true });
    cpSync(mine, theirs);
    kept.push({ file: `kit/${rel}`, kind });
  }
  return kept;
}
