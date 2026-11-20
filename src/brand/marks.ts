// PLA-I66-5: logos proposed by Artist for a project that has none (or wants another). The owner gives hints: what the
// project is about, inspiration images (staged like an upload), how it should feel, what it must not have, colours
// taken from the images. The request is kept under <captures dir>/_marca/<project>/marks/<id>/ and queues the project's
// Artist with the marker «[marcas <id>]»: the runner gives that run a read-only prompt (marksPrompt) in a scratch
// folder, and Artist answers with deliver_marks. Plania cleans every SVG, renders it and runs the three pixel tests
// (src/brand/pixels.ts) before the owner sees it; a mark that fails a test is shown with the reason, not hidden.
// Using a mark makes it the original (source artist, the owner's choice). No paid service: a normal Artist run.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, projects, type Actor, type Agent, type Project, type ProjectLogo } from "../db/schema.js";
import { capturesDir } from "../captures/store.js";
import { ToolError } from "../mcp/errors.js";
import { enqueueWake } from "../runner/events.js";
import { isSessionOf } from "../runner/run-session.js";
import { ownerLanguage } from "../runner/owner-language.js";
import { inspect, svgIsClean } from "./detect.js";
import { addLogoVersion, putLogoFile } from "./logos.js";
import { forgetMarcaOf } from "./marca.js";
import { palette, type PixelTests } from "./pixels.js";
import { cleanSvg, LogoError, testTile } from "./upload.js";

export const MAX_MARKS = 8;
export const MARKS_MARK = "[marcas";
export const MARKS_RE = /\[marcas ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/;
export const marksIdOf = (reason: string | null | undefined): string | null => MARKS_RE.exec(reason ?? "")?.[1] ?? null;
/** The request a run was queued for (its reason carries the marker), while it is still drawing. */
export const marksRequestOfRun = (slug: string, reason: string | null | undefined): MarksRequest | null => {
  const id = marksIdOf(reason);
  const r = id ? loadRequest(slug, id) : null;
  return r?.status === "drawing" ? r : null;
};

export type Hints = { about: string; feel: string[]; avoid: string[]; colors: string[]; images: string[]; like?: string | null };
export type Mark = { id: string; name: string; idea: string; file: string; tile: string; variant: "icon" | "mark"; colors: string[]; tests: PixelTests };
export type MarksRequest = { id: string; slug: string; status: "drawing" | "ready" | "failed"; hints: Hints; runId: string | null; at: string; marks: Mark[]; rejected: { name: string; why: string }[] };

function dirOf(slug: string, id?: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  const base = path.join(capturesDir(), "_marca", slug, "marks");
  if (id === undefined) return base;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("bad marks id");
  return path.join(base, id);
}
const save = (r: MarksRequest) => {
  const dir = dirOf(r.slug, r.id);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.request.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify(r, null, 1));
  renameSync(tmp, path.join(dir, "request.json"));
};
export function loadRequest(slug: string, id: string): MarksRequest | null {
  const p = path.join(dirOf(slug, id), "request.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as MarksRequest) : null;
}
/** The newest request of a project. */
export function latestRequest(slug: string): MarksRequest | null {
  const base = dirOf(slug);
  if (!existsSync(base)) return null;
  const all = readdirSync(base)
    .map((id) => (/^[0-9a-f-]{36}$/.test(id) ? loadRequest(slug, id) : null))
    .filter((r): r is MarksRequest => r !== null)
    .sort((a, b) => b.at.localeCompare(a.at));
  return all[0] ?? null;
}
export const markFile = (slug: string, id: string, file: string): Buffer | null => {
  if (!/^[a-z0-9-]+\.(svg|png)$/.test(file)) return null;
  const p = path.join(dirOf(slug, id), file);
  return existsSync(p) ? readFileSync(p) : null;
};

const words = (list: string[] | undefined, max: number) => [...new Set((list ?? []).map((w) => w.replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean))].slice(0, max);

export async function artistOf(db: Db, projectId: string): Promise<Agent | null> {
  const [a] = await db.select().from(agents).where(and(eq(agents.projectId, projectId), eq(agents.roleTemplate, "artist"))).limit(1);
  return a ?? null;
}

export type Wake = (db: Db, input: { agent: Agent | null; project: { id: string; slug: string }; reason: string }) => Promise<{ runId: string | null; why?: string }>;
const realWake: Wake = async (db, input) => {
  const w = await enqueueWake(db, { agent: input.agent, project: input.project, taskKey: null, reason: input.reason, trigger: "event" });
  return w.kind === "queued" ? { runId: w.runId } : { runId: w.existingRunId ?? null, why: w.reason };
};

/** Keeps the hints and queues the project's Artist. A request already drawing is answered as it is. */
export async function requestMarks(db: Db, project: Pick<Project, "id" | "slug" | "title">, input: Partial<Hints>, deps: { wake?: Wake } = {}): Promise<MarksRequest> {
  const open = latestRequest(project.slug);
  if (open?.status === "drawing") return open;
  const hints: Hints = {
    about: String(input.about ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
    feel: words(input.feel, 6),
    avoid: words(input.avoid, 6),
    colors: (input.colors ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6),
    images: (input.images ?? []).filter((u) => /^[0-9a-f]{64}\.(png|jpeg|webp|svg)$/.test(u)).slice(0, 6),
    like: null,
  };
  // «Más como esta»: the liked mark of the last round, as words Artist can draw from.
  if (input.like && open?.status === "ready") {
    const m = open.marks.find((x) => x.id === input.like);
    if (m) hints.like = `${m.name}: ${m.idea}`.slice(0, 300);
  }
  const r: MarksRequest = { id: randomUUID(), slug: project.slug, status: "drawing", hints, runId: null, at: new Date().toISOString(), marks: [], rejected: [] };
  save(r);
  const agent = await artistOf(db, project.id);
  const w = await (deps.wake ?? realWake)(db, { agent, project, reason: `${MARKS_MARK} ${r.id}] Draw logo marks for ${project.title}; answer with deliver_marks` });
  if (!w.runId && !agent) r.status = "failed";
  r.runId = w.runId;
  save(r);
  return r;
}

/** A request still drawing whose run ended without marks has failed (the screen offers to try again). */
export async function settle(db: Db, r: MarksRequest | null): Promise<MarksRequest | null> {
  if (!r || r.status !== "drawing" || !r.runId) return r;
  const [run] = await db.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, r.runId)).limit(1);
  if (run && !["queued", "running", "starting"].includes(run.status)) {
    r.status = "failed";
    save(r);
  }
  return r;
}

/** What the Artist run is told (after its role prompt). */
export function marksPrompt(input: { agent: string; project: { slug: string; title: string }; request: MarksRequest; sessionId: string; imageDir: string }): string {
  const h = input.request.hints;
  const imgs = h.images.map((u) => path.join(input.imageDir, u));
  return [
    `You are ${input.agent}, the designer of project ${input.project.slug} (${input.project.title}), woken by the Plania runner to draw logo marks. Nothing else: no code, no files in any repo, no tickets.`,
    `What the project is about: "${h.about || input.project.title}".`,
    h.feel.length ? `It should feel: ${h.feel.join(", ")}.` : "",
    h.avoid.length ? `It must not have: ${h.avoid.join(", ")}.` : "",
    h.colors.length ? `Colours taken from the owner's inspiration: ${h.colors.join(", ")}.` : "",
    imgs.length ? `Inspiration images (look at each with the Read tool; take mood and colour, never copy them): ${imgs.join(", ")}.` : "",
    h.like ? `The owner liked "${h.like}": draw six variations of that idea (shape, weight, colour), not new ideas.` : "",
    "Draw 6 marks that are different ideas (a letterform, a geometric shape, a symbol of what the project does), each an app icon: a square SVG with viewBox 0 0 100 100, its own background filling the whole square (a <rect> or a gradient) and the drawing on it.",
    "Rules: at most 6 shapes, no <text>, no images, no scripts, no external references, two or three colours, strokes 8 or more units wide (they must survive at 16 px), the drawing inside a circle of radius 38 around the centre (Android crops the rest), strong contrast between drawing and background.",
    `Name each mark in two or three words and give its idea in one sentence, both in ${ownerLanguage()}.`,
    `Finish with exactly one call: deliver_marks {project: "${input.project.slug}", id: "${input.request.id}", marks: [{name, idea, svg}]} with actor session_id ${input.sessionId}. Then stop.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Artist's answer: each SVG cleaned, rendered and tested; the request is ready. */
export async function deliverMarks(db: Db, input: { project: string; id: string; marks: { name: string; idea: string; svg: string }[] }, who: { agent: string; session_id?: string | null }): Promise<{ id: string; kept: number; rejected: { name: string; why: string }[] }> {
  const [p] = await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.slug, input.project)).limit(1);
  const r = p && /^[0-9a-f-]{36}$/.test(input.id) ? loadRequest(p.slug, input.id) : null;
  if (!p || !r) throw new ToolError("MARKS_NOT_FOUND", { id: input.id });
  if (r.status === "ready") throw new ToolError("MARKS_NOT_FOUND", { id: input.id, hint: "already delivered" });
  const artist = await artistOf(db, p.id);
  // PLA-119: the run's session is run-<16 hex> since PLA-I60-1; the old 8-hex form still reads.
  const runOk = !!r.runId && isSessionOf(who.session_id, r.runId);
  if (!runOk && (!artist || (who.agent !== artist.slug && who.agent !== artist.name))) throw new ToolError("MARKS_FORBIDDEN", { id: input.id, agent: who.agent });
  const dir = dirOf(p.slug, r.id);
  mkdirSync(dir, { recursive: true });
  const marks: Mark[] = [];
  const rejected: { name: string; why: string }[] = [];
  for (const [i, m] of input.marks.slice(0, MAX_MARKS).entries()) {
    const name = String(m.name ?? "").trim().slice(0, 60) || `#${i + 1}`;
    const idea = String(m.idea ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    const clean = cleanSvg(String(m.svg ?? ""));
    if (!/<svg[\s>]/i.test(clean.svg) || !svgIsClean(clean.svg) || clean.svg.length > 100_000) {
      rejected.push({ name, why: "unsafe or not an SVG" });
      continue;
    }
    const bytes = Buffer.from(clean.svg);
    const cand = inspect({ path: "mark.svg", bytes }, p.slug);
    if (!cand) {
      rejected.push({ name, why: "not square or unreadable" });
      continue;
    }
    let tile: Buffer;
    try {
      tile = await sharp(bytes, { density: 512 }).resize(512, 512).png().toBuffer();
    } catch {
      rejected.push({ name, why: "could not be drawn" });
      continue;
    }
    // An icon's own background may be a gradient: it is read from the corners and blended across.
    const bg = cand.variant === "icon" ? ("corners" as const) : null;
    const id = `m${i + 1}-${randomUUID().slice(0, 6)}`;
    writeFileSync(path.join(dir, `${id}.svg`), bytes);
    writeFileSync(path.join(dir, `${id}.png`), tile);
    const small = await sharp(tile).resize(64, 64).ensureAlpha().raw().toBuffer();
    marks.push({ id, name, idea, file: `${id}.svg`, tile: `${id}.png`, variant: cand.variant, colors: cand.colors.length ? cand.colors : palette({ width: 64, height: 64, data: new Uint8Array(small) }, 2), tests: await testTile(tile, bg) });
  }
  if (!marks.length) throw new ToolError("MARKS_INVALID", { reasons: rejected });
  r.marks = marks;
  r.rejected = rejected;
  r.status = "ready";
  save(r);
  const { bus } = await import("../events.js");
  bus.publish({ type: "project", project: p.slug });
  return { id: r.id, kept: marks.length, rejected };
}

/** One of the marks becomes the project's original (source artist, the owner's choice). */
export async function useMark(db: Db, project: Pick<Project, "id" | "slug">, requestId: string, markId: string, actor: Actor): Promise<ProjectLogo> {
  const r = loadRequest(project.slug, requestId);
  const m = r?.marks.find((x) => x.id === markId);
  const bytes = m ? markFile(project.slug, requestId, m.file) : null;
  if (!r || !m || !bytes) throw new LogoError("LOGO_MARK_NOT_FOUND", 404, "mark not found");
  const logo = await addLogoVersion(db, project, {
    file: putLogoFile(project.slug, bytes, "image/svg+xml"),
    mime: "image/svg+xml",
    bytes: bytes.length,
    width: 100,
    height: 100,
    variant: m.variant,
    source: "artist",
    sourcePath: m.name,
    colors: m.colors,
    chosen: true,
    actor,
  });
  forgetMarcaOf(project.id);
  return logo;
}
