// PLA-I52-6: señalar y preguntar. Two ways for the owner to talk to Taller from El Probador, with no session open.
//   marcas     pins on a picture travel with «Devolver a Taller»: the note lists each one (view, side, width, where,
//              what to change) with a crop of the picture around it, kept in the capture store, whose file path on
//              this Mac Taller can open.
//   preguntas  «Pregúntale a Taller»: the question is kept on the ticket and wakes the Taller that built the delivery
//              for a short read-only run (no edits, no commits, no pushes: the QA deny rules). Taller answers in the
//              project thread with a message linked to the ticket that starts «Respuesta:»; the card shows it.
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Db } from "../db/client.js";
import type { Project, Task } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { enqueueWake } from "../runner/events.js";
import { writeVia } from "../runner/limits.js";
import { readerOf } from "../store/port.js";
import { gt } from "../store/types.js";
import { cropRaster, decodePng, encodePng } from "./diff.js";
import { capturesDir, imageUrl, newestFirst, putFile, readFile } from "./store.js";

export type Marca = { vista: string; side: "antes" | "despues"; width: "desktop" | "phone"; x: number; y: number; note: string };
export const PREGUNTA_MARK = "[pregunta]";
export const RESPUESTA = /^\s*Respuesta:\s*/i;

async function load(db: Db, slug: string, key: string): Promise<{ p: Project; t: Task }> {
  const p = await readerOf(db).get("projects", { slug });
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  const t = await readerOf(db).get("tasks", { projectId: p.id, key });
  if (!t) throw new ToolError("TASK_NOT_FOUND", { key });
  return { p, t };
}

// A thread message's links include this ticket (jsonb containment of {kind: ticket, ref}).
export const linksTicket = (links: readonly { kind: string; ref: string }[] | null | undefined, key: string) => (links ?? []).some((l) => l.kind === "ticket" && l.ref === key);

export function cleanMarcas(v: unknown): Marca[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 12)
    .map((m) => m as Partial<Marca>)
    .filter((m) => typeof m.vista === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(m.vista) && typeof m.x === "number" && typeof m.y === "number")
    .map((m) => ({
      vista: m.vista!,
      side: m.side === "antes" ? "antes" : "despues",
      width: m.width === "phone" ? "phone" : "desktop",
      x: Math.max(0, Math.min(1, m.x!)),
      y: Math.max(0, Math.min(1, m.y!)),
      note: String(m.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
    }));
}

// The return note's part for the pins, and a crop of each (about a third of the picture, centred on the pin).
export async function marcasText(db: Db, slug: string, key: string, marcas: Marca[]): Promise<{ text: string; crops: string[] }> {
  if (!marcas.length) return { text: "", crops: [] };
  const { p, t } = await load(db, slug, key);
  const lines: string[] = [];
  const crops: string[] = [];
  for (const [i, m] of marcas.entries()) {
    const label = t.muestra?.vistas.find((v) => v.key === m.vista)?.label ?? m.vista;
    const [s] = newestFirst(await readerOf(db).find("captureStills", { taskId: t.id, pageKey: m.vista, side: m.side, viewport: m.width, status: "ok" }));
    let where = "";
    const png = s?.file ? readFile(p.slug, s.file) : null;
    const r = png ? decodePng(png) : null;
    if (s && r) {
      const w = r.width * 0.36;
      const h = r.height * 0.3;
      const crop = encodePng(cropRaster(r, m.x * r.width - w / 2, m.y * r.height - h / 2, w, h));
      const file = putFile(p.slug, crop);
      const row = await writeVia(
        db,
        (uow) =>
          uow.insert("captureStills", {
            projectId: p.id,
            taskId: t.id,
            runId: randomUUID(),
            pageKey: `marca-${i + 1}-${m.vista}`.slice(0, 40),
            pageLabel: `Marca ${i + 1} · ${label}`.slice(0, 60),
            path: s.path,
            viewport: m.width,
            width: Math.round(w),
            height: Math.round(h),
            status: "ok",
            file,
            bytes: crop.length,
            actor: { agent: "jorge", session_id: "screen" },
            side: m.side,
            commit: s.commit,
            branch: s.branch,
          }),
        p.id,
      );
      where = ` · foto: ${path.join(capturesDir(), p.slug, file)} (${imageUrl(p.slug, row.id)})`;
      crops.push(row.id);
    }
    const pos = `${Math.round(m.x * 100)}% desde la izquierda, ${Math.round(m.y * 100)}% desde arriba`;
    lines.push(`${i + 1}. ${label} (${s?.path ?? m.vista}), ${m.side === "antes" ? "antes" : "después"}, ${m.width === "phone" ? "teléfono" : "escritorio"}, ${pos}: ${m.note || "(sin nota)"}${where}`);
  }
  return { text: `Marcas en El Probador:\n${lines.join("\n")}`, crops };
}

// The Taller that answers: the ticket's owner, else the project's Taller.
async function tallerOf(db: Db, p: Project, t: Task) {
  if (t.ownerAgent) {
    const a = await readerOf(db).get("agents", { id: t.ownerAgent });
    if (a) return a;
  }
  return (await readerOf(db).get("agents", { projectId: p.id, roleTemplate: "taller" })) ?? null;
}

export async function preguntar(db: Db, slug: string, key: string, text: string): Promise<{ id: string; wake: string }> {
  const q = text.replace(/\s+/g, " ").trim();
  if (!q) throw new ToolError("INVALID_FILTER", { field: "text", hint: "escribe la pregunta" });
  if (q.length > 400) throw new ToolError("TOO_LARGE", { field: "text", max: 400 });
  const { p, t } = await load(db, slug, key);
  const id = randomUUID();
  await writeVia(
    db,
    async (uow) => {
      const cur = await uow.get("tasks", { id: t.id });
      if (cur) await uow.update("tasks", { id: t.id }, { preguntas: [...(cur.preguntas ?? []), { id, text: q, at: uow.now.toISOString() }] });
    },
    p.id,
  );
  const taller = await tallerOf(db, p, t);
  const reason =
    `${PREGUNTA_MARK} El dueño pregunta sobre la entrega ${t.key}: «${q}». Contesta en español, en tres frases o menos, ` +
    `con thread_post en el hilo de ${p.slug}, links [{"kind":"ticket","ref":"${t.key}"}], empezando con «Respuesta: ». ` +
    `Solo lee el código y la muestra (get_task fields muestra): esta corrida no puede editar, hacer commit ni push.`;
  const w = await enqueueWake(db, { agent: taller, project: { id: p.id, slug: p.slug }, taskKey: t.key, reason });
  return { id, wake: w.kind === "queued" ? "queued" : w.reason };
}

export type QA = { id: string; text: string; at: string; answer: { text: string; at: string; by: string } | null };

// Each question with the first answer after it (a «Respuesta:» message linked to the ticket in the project thread).
export async function preguntasOf(db: Db, p: Pick<Project, "id">, t: Pick<Task, "key" | "preguntas">): Promise<QA[]> {
  const qs = (t.preguntas ?? []).slice(-10);
  if (!qs.length) return [];
  const since = new Date(qs[0]!.at);
  const r = readerOf(db);
  const threadIds = (await r.find("threads", { projectId: p.id })).map((th) => th.id);
  const rows = threadIds.length
    ? (await r.find("threadMessages", { threadId: threadIds, at: gt(since) }, { orderBy: [{ column: "at" }] }))
        .filter((m) => linksTicket(m.links, t.key))
        .map((m) => ({ body: m.body, at: m.at, by: m.authorRole }))
    : [];
  const answers = rows.filter((x) => RESPUESTA.test(x.body));
  const used = new Set<number>();
  return qs.map((q, i) => {
    const next = qs[i + 1] ? new Date(qs[i + 1]!.at) : null;
    const k = answers.findIndex((a, j) => !used.has(j) && a.at > new Date(q.at) && (!next || a.at <= next || i === qs.length - 1));
    if (k < 0) return { ...q, answer: null };
    used.add(k);
    const a = answers[k]!;
    return { ...q, answer: { text: a.body.replace(RESPUESTA, "").trim(), at: a.at.toISOString(), by: a.by } };
  });
}
