// PLA-I69-6: Marca → Historial. Everything the brand has been, in one list: the logo's versions, the style's and the
// voice's (each with its values, so the screen can compare and go back), and every request Marca sent to Taller
// (icons, style, name) with where it stands. Going back never deletes: it makes a new version.
import { and, desc, eq, ilike } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks } from "../db/schema.js";
import { listVersions, type VersionRef } from "./upload.js";
import { styleHistory, type Style } from "./style.js";
import { voiceHistory, type Voice } from "./voz.js";

export type RequestKind = "caras" | "estilo" | "nombre";
export type Historial = {
  logo: VersionRef[];
  style: { v: number; at: string; current: boolean; style: Style }[];
  voice: { v: number; at: string; current: boolean; voice: Voice }[];
  requests: { key: string; title: string; kind: RequestKind; status: string; at: string; pr: string | null }[];
};
export const kindOfScope = (scope: string | null): RequestKind | null =>
  !scope ? null : scope.includes("<!-- plania:marca-estilo ") ? "estilo" : scope.includes("<!-- plania:marca-nombre ") ? "nombre" : scope.includes("<!-- plania:marca set=") ? "caras" : null;

export async function historialOf(db: Db, slug: string): Promise<Historial | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const rows = await db
    .select({ key: tasks.key, title: tasks.title, status: tasks.status, scope: tasks.scope, at: tasks.createdAt, pr: tasks.prUrl })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), ilike(tasks.scope, "%<!-- plania:marca%")))
    .orderBy(desc(tasks.createdAt))
    .limit(40);
  const requests = rows.flatMap((r) => {
    const kind = kindOfScope(r.scope);
    return kind ? [{ key: r.key, title: r.title, kind, status: r.status, at: r.at.toISOString(), pr: r.pr ?? null }] : [];
  });
  return { logo: await listVersions(db, p.id), style: styleHistory(slug), voice: voiceHistory(slug), requests };
}
