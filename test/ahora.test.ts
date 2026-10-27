// Ahora's model (ui/src/lib/ahora.ts). Pure, no database. Sample projects are fictional.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  GONE_LEASE,
  LIVENESS_WORD,
  NO_OWNER,
  QUIET_MS,
  STALE_LEASE,
  TE_TOCA_LIMIT,
  bloqueadoOf,
  enCursoOf,
  siguienteOf,
  teTocaOf,
  urgencyRank,
  type AhoraFootprint,
  type AhoraInboxItem,
  type AhoraProject,
  type AhoraTask,
} from "../ui/src/lib/ahora.js";

const NOW = Date.parse("2026-10-11T12:00:00Z");

function ticket(key: string, status: string, extra: Partial<AhoraTask> = {}): AhoraTask {
  return { key, kind: "ticket", title: `Ticket ${key}`, status, ...extra };
}

function project(slug: string, extra: Partial<AhoraProject> = {}): AhoraProject {
  return { slug, title: slug.toUpperCase(), line: `Línea de ${slug}.`, tasks: [], next_claimable: null, ...extra };
}

function item(partial: Partial<AhoraInboxItem> & Pick<AhoraInboxItem, "id" | "group" | "waiting_since">): AhoraInboxItem {
  return {
    project: "alfa",
    key: "ALF-1",
    title: "Un ticket",
    why: "porque el demo lo dice",
    wait_s: 60,
    ...partial,
  };
}

const claim = (key: string, seen: string): AhoraTask =>
  ticket(key, "In progress", {
    claimed_by: { agent: "Agente Norte" },
    lease_until: "2026-10-11T13:00:00Z",
    claimed_at: "2026-10-11T11:00:00Z",
    last_seen_at: seen,
  });

describe("teTocaOf", () => {
  test("decisions and steps, at most three, now then soon then whenever, older first; chores stay out", () => {
    const items = [
      item({ id: "whenever", group: "decisiones", urgency: "whenever", waiting_since: "2019-01-01T00:00:00Z", why: "cuando sea" }),
      item({ id: "soon", group: "decisiones", urgency: "soon", waiting_since: "2020-01-01T00:00:00Z", why: "pronto" }),
      item({ id: "step-new", group: "pasos", waiting_since: "2026-03-01T00:00:00Z", why: "un paso" }),
      item({ id: "now", group: "decisiones", urgency: "now", waiting_since: "2026-02-01T00:00:00Z", why: "ya" }),
      item({ id: "approval", group: "decisiones", waiting_since: "2026-01-01T00:00:00Z", why: "aprobar" }),
      item({ id: "release", group: "pasos", waiting_since: "2026-04-01T00:00:00Z", why: "lanzar" }),
      item({ id: "chore", group: "limpieza", urgency: "now", waiting_since: "2018-01-01T00:00:00Z", why: "basura" }),
    ];
    const box = teTocaOf({ items, count: 6 });
    assert.equal(box.count, 6);
    assert.equal(box.items.length, TE_TOCA_LIMIT);
    assert.deepEqual(box.items.map((i) => i.id), ["approval", "now", "step-new"]);
    assert.equal(box.items.some((i) => i.group === "limpieza"), false);
    assert.deepEqual([urgencyRank("now"), urgencyRank("soon"), urgencyRank("whenever"), urgencyRank(null)], [0, 1, 2, 0]);
  });

  test("the count is get_inbox's count even when fewer than three remain", () => {
    const box = teTocaOf({
      items: [item({ id: "only", group: "pasos", waiting_since: "2026-05-01T00:00:00Z" })],
      count: 1,
    });
    assert.equal(box.count, 1);
    assert.equal(box.items.length, 1);
  });
});

describe("enCursoOf", () => {
  const live = "2026-10-11T11:50:00Z";
  const quiet = new Date(NOW - QUIET_MS - 60_000).toISOString();

  test("the line is the project's own, and liveness is the liveliest claim", () => {
    const alfa = project("alfa", { line: "En curso: ALF-2 (Agente Norte). Siguiente: ALF-3.", tasks: [claim("ALF-2", live), ticket("ALF-1", "Done")] });
    const beta = project("beta", { line: "En curso: BET-1 (Agente Sur).", tasks: [claim("BET-1", quiet)] });
    const gamma = project("gamma", { line: "Sin ficha.", tasks: [ticket("GAM-1", "In progress")] });
    const delta = project("delta", { line: "Siguiente: DEL-1.", tasks: [] });
    const rows = enCursoOf([alfa, beta, gamma, delta], [], NOW);
    assert.deepEqual(rows.map((r) => [r.slug, r.line, r.liveness && LIVENESS_WORD[r.liveness]]), [
      ["alfa", alfa.line, "en vivo"],
      ["beta", beta.line, "quieto"],
      ["gamma", "Sin ficha.", "vencido"],
      ["delta", delta.line, null],
    ]);
  });

  test("a live heartbeat loses to a stale or gone footprint, and a live claim beats a quiet one", () => {
    const alfa = project("alfa", { tasks: [claim("ALF-2", live)] });
    const gone: AhoraFootprint[] = [{ project: "alfa", task_key: "ALF-2", state: "stale" }];
    assert.equal(enCursoOf([alfa], gone, NOW)[0]!.liveness, "stale");
    const mixed = project("beta", { tasks: [claim("BET-1", quiet), claim("BET-2", live)] });
    assert.equal(enCursoOf([mixed], [], NOW)[0]!.liveness, "live");
    assert.equal(enCursoOf([project("alfa", { tasks: [claim("ALF-9", live)] })], [{ project: "alfa", task_key: "ALF-9", state: "gone" }], NOW)[0]!.liveness, "stale");
  });
});

describe("bloqueadoOf", () => {
  test("drops waits on Jorge and keeps the rest, plus a lease that ran out or left the machine", () => {
    const alfa = project("alfa", {
      initiatives: [{
        key: "ALF-I1",
        waiting_on: [
          { key: "ALF-1", on: "Jorge: una pregunta" },
          { key: "ALF-2", on: "Jorge: aprobar done" },
          { key: "ALF-3", on: "beta migration_gte 4" },
          { key: "ALF-4", on: "ALF-9 (In review)" },
        ],
      }],
      tasks: [
        ticket("ALF-5", "In progress", {
          claimed_by: { agent: "Agente Norte" },
          lease_until: "2026-10-11T11:00:00Z",
        }),
        claim("ALF-6", "2026-10-11T11:50:00Z"),
        ticket("ALF-7", "Ready"),
      ],
    });
    const rows = bloqueadoOf([alfa], [{ project: "alfa", task_key: "ALF-6", state: "gone" }], NOW);
    assert.deepEqual(rows.map((r) => [r.key, r.on, r.kind]), [
      ["ALF-3", "beta migration_gte 4", "wait"],
      ["ALF-4", "ALF-9 (In review)", "wait"],
      ["ALF-5", STALE_LEASE, "lease"],
      ["ALF-6", GONE_LEASE, "lease"],
    ]);
  });

  test("in progress with no claim is sin dueño; a lease that ran out stays arrendamiento vencido", () => {
    const alfa = project("alfa", {
      tasks: [
        ticket("ALF-1", "In progress"),
        ticket("ALF-2", "In progress", {
          claimed_by: { agent: "Agente Sur" },
          lease_until: "2026-10-11T10:00:00Z",
        }),
        ticket("ALF-3", "Ready"),
      ],
    });
    assert.deepEqual(bloqueadoOf([alfa], [], NOW).map((r) => [r.key, r.on]), [
      ["ALF-1", NO_OWNER],
      ["ALF-2", STALE_LEASE],
    ]);
    const gone = bloqueadoOf([alfa], [{ project: "alfa", task_key: "ALF-1", state: "gone" }], NOW);
    assert.equal(gone.find((r) => r.key === "ALF-1")?.on, GONE_LEASE);
  });
});

describe("siguienteOf", () => {
  test("one next claimable per project that has one", () => {
    const alfa = project("alfa", { next_claimable: { key: "ALF-3", title: "Cerrar el demo" } });
    const beta = project("beta");
    const gamma = project("gamma", { next_claimable: { key: "GAM-1", title: "Empezar" } });
    assert.deepEqual(siguienteOf([alfa, beta, gamma]), [
      { slug: "alfa", title: "ALFA", key: "ALF-3", taskTitle: "Cerrar el demo" },
      { slug: "gamma", title: "GAMMA", key: "GAM-1", taskTitle: "Empezar" },
    ]);
  });
});
