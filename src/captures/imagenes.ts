// PLA-127: the images a delivery changes, before and after. An icons change (Android's icons, a favicon) shows on no
// page El Probador photographs, so the owner was asked to accept with «Esta entrega no tiene fotos». The delivery's
// branch and the project's start branch are read from the project's checkout with git (never the working tree): every
// image file the branch changes since it left the start branch, and each file's bytes on either side.
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks } from "../db/schema.js";
import { fetchStart, realGit, type Git } from "../brand/logos.js";
import { repoPathOf } from "../runner/worktree.js";
import { startBranchOf } from "../runner/start-branch.js";

export const IMAGE_FILE = /\.(png|svg|ico|jpe?g|webp|gif)$/i;
const MAX_FILES = 24;
export type ImagenCambio = { path: string; estado: "nueva" | "cambio" | "borrada" };
export type ImagenesRead = { base: string; head: string; files: ImagenCambio[] };

async function rev(git: Git, repo: string, ref: string): Promise<string | null> {
  const r = await git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const s = r.stdout.toString("utf8").trim();
  return r.code === 0 && /^[0-9a-f]{40}$/.test(s) ? s : null;
}

async function sides(db: Db, slug: string, key: string, git: Git): Promise<{ repo: string; base: string; head: string } | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const [t] = await db.select({ branch: tasks.branch }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!t?.branch || !/^[\w./-]+$/.test(t.branch)) return null;
  const repo = repoPathOf(p.slug, p.settings);
  const start = startBranchOf(p.settings);
  await fetchStart(git, repo, start, Date.now());
  const head = (await rev(git, repo, t.branch)) ?? (await rev(git, repo, `origin/${t.branch}`));
  const tip = (await rev(git, repo, `origin/${start}`)) ?? (await rev(git, repo, start));
  if (!head || !tip) return null;
  // Where the branch left the start branch: after a merge too, «before» stays the start branch as it was.
  const mb = await git(repo, ["merge-base", tip, head]);
  const base = mb.stdout.toString("utf8").trim();
  return mb.code === 0 && /^[0-9a-f]{40}$/.test(base) ? { repo, base, head } : null;
}

/** The image files the delivery's branch changes, or null when its branch cannot be read here. */
export async function imagenesRead(db: Db, slug: string, key: string, git: Git = realGit): Promise<ImagenesRead | null> {
  const s = await sides(db, slug, key, git);
  if (!s) return null;
  const d = await git(s.repo, ["diff", "--name-status", "-z", "--no-renames", s.base, s.head]);
  if (d.code !== 0) return null;
  const parts = d.stdout.toString("utf8").split("\0").filter(Boolean);
  const files: ImagenCambio[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [st, path] = [parts[i]!, parts[i + 1]!];
    if (!IMAGE_FILE.test(path)) continue;
    files.push({ path, estado: st === "A" ? "nueva" : st === "D" ? "borrada" : "cambio" });
    if (files.length >= MAX_FILES) break;
  }
  return { base: s.base, head: s.head, files };
}

/** One changed image's bytes on one side; only a file the delivery changes. */
export async function imagenBytes(db: Db, slug: string, key: string, lado: "antes" | "despues", file: string, git: Git = realGit): Promise<{ bytes: Buffer; mime: string } | null> {
  const s = await sides(db, slug, key, git);
  const r = s ? await imagenesRead(db, slug, key, git) : null;
  if (!s || !r || !r.files.some((f) => f.path === file)) return null;
  const blob = await git(s.repo, ["cat-file", "blob", `${lado === "antes" ? r.base : r.head}:${file}`]);
  if (blob.code !== 0) return null;
  const ext = file.split(".").pop()!.toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "ico" ? "image/x-icon" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  return { bytes: blob.stdout, mime };
}
