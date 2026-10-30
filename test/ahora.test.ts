// Ahora's model (ui/src/lib/ahora.ts). Pure, no database. Sample projects are fictional.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  GONE_LEASE,
  NO_OWNER,
  QUIET_PREFIX,
  READINESS_BADGE,
  READ_ONLY_LINE,
  STALE_LEASE,
  SUMMARY_ANYWAY,
  SUMMARY_BUTTON,
  SUMMARY_CANCEL,
  SUMMARY_ONLY,
  TE_TOCA_LIMIT,
  IDEA_STAGE_LABEL,
  bloqueadoOf,
  enCursoOf,
  ideaFinished,
  ideaOutcome,
  ideasByStage,
  lastMovementLine,
  ideasFromProject,
  oldestWaitingIdea,
  quietLine,
  retomarOf,
  siguienteOf,
  sinTrabajoOf,
  summaryAction,
  summaryLabel,
  teTocaOf,
  unblockOf,
  urgencyRank,
  type AhoraFootprint,
  type AhoraInboxItem,
  type AhoraProject,
  type AhoraTask,
  type IdeaTask,
  type Readiness,
} from "../ui/src/lib/ahora.js";

const NOW = Date.parse("2026-10-11T12:00:00Z");

function ticket(key: string, status: string, extra: Partial<AhoraTask> = {}): AhoraTask {
  return { key, kind: "ticket", title: `Ticket ${key}`, status, ...extra };
}

function noContext(): Readiness {
  return {
    state: "no_context",
    reasons: [{ code: "NO_CONTEXT", severity: "no_context", text: "No hay contexto reciente para retomar.", task_key: null }],
    line: "No hay contexto reciente para retomar.",
  };
}

function readiness(state: Readiness["state"], text: string, code = state.toUpperCase(), task_key: string | null = null): Readiness {
  if (state === "ready") return { state, reasons: [], line: text };
  if (state === "no_context") return noContext();
  return { state, reasons: [{ code, severity: state, text, task_key }], line: text };
}

function project(slug: string, extra: Partial<AhoraProject> = {}): AhoraProject {
  return { slug, title: slug.toUpperCase(), line: `Línea de ${slug}.`, readiness: noContext(), tasks: [], next_claimable: null, ...extra };
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

  test("live work is a row; everything else is the quiet line", () => {
    const alfa = project("alfa", {
      title: "Proyecto A",
      readiness: readiness("ready", "ALF-2: se puede retomar."),
      tasks: [claim("ALF-2", live), ticket("ALF-1", "Done")],
    });
    const beta = project("beta", {
      title: "Proyecto B",
      readiness: readiness("caution", "BET-1: un check del PR sigue pendiente.", "PR_PENDING", "BET-1"),
      tasks: [ticket("BET-1", "In review")],
    });
    const gamma = project("gamma", {
      title: "Proyecto C",
      readiness: readiness("caution", "GAM-1: la reserva de trabajo ya venció.", "LEASE_EXPIRED", "GAM-1"),
      tasks: [ticket("GAM-1", "In progress")],
    });
    const delta = project("delta", {
      title: "Proyecto D",
      readiness: readiness("ready", "Siguiente: DEL-1."),
      tasks: [ticket("DEL-1", "Ready")],
      next_claimable: { key: "DEL-1", title: "Empezar" },
    });
    const epsilon = project("epsilon", { title: "Proyecto E" });
    const rows = enCursoOf([alfa, beta, gamma, delta, epsilon]);
    assert.deepEqual(rows.map((row) => [row.slug, row.state, row.line]), [
      ["alfa", "ready", "ALF-2: se puede retomar."],
      ["beta", "caution", "BET-1: un check del PR sigue pendiente."],
      ["gamma", "caution", "GAM-1: la reserva de trabajo ya venció."],
    ]);
    assert.deepEqual(rows[0]!.reasons, []);
    assert.equal(rows[1]!.reasons[0]!.code, "PR_PENDING");
    assert.deepEqual(sinTrabajoOf([alfa, beta, gamma, delta, epsilon]).map((row) => row.title), ["Proyecto D", "Proyecto E"]);
    assert.equal(quietLine(sinTrabajoOf([alfa, beta, gamma, delta, epsilon])), "Sin trabajo en curso: Proyecto D, Proyecto E");
  });

  test("a quiet claim is still live work, and no_context never has a row", () => {
    const quietSeen = "2026-10-11T10:00:00Z";
    const quiet = project("alfa", {
      title: "Proyecto A",
      readiness: readiness("caution", "ALF-2: el claim lleva callado.", "CLAIM_QUIET", "ALF-2"),
      tasks: [claim("ALF-2", quietSeen)],
    });
    assert.equal(enCursoOf([quiet])[0]!.state, "caution");
    const empty = project("beta", {
      title: "Proyecto B",
      tasks: [ticket("BET-1", "In review")],
    });
    assert.deepEqual(enCursoOf([empty]), []);
    assert.equal(summaryAction("no_context"), "none");
    assert.deepEqual(sinTrabajoOf([empty]).map((row) => row.title), ["Proyecto B"]);
  });

  test("each state renders a badge, the reason, and a button only when it is safe", () => {
    assert.deepEqual(READINESS_BADGE, { ready: "Listo", caution: "Con cuidado", blocked: "Bloqueado" });
    const ready = enCursoOf([
      project("alfa", {
        title: "Proyecto A",
        readiness: readiness("ready", "ALF-2: se puede retomar."),
        tasks: [claim("ALF-2", live)],
      }),
    ])[0]!;
    assert.equal(READINESS_BADGE[ready.state], "Listo");
    assert.equal(ready.line, "ALF-2: se puede retomar.");
    assert.equal(summaryAction(ready.state), "open");
    assert.equal(unblockOf(ready), null);
    assert.equal(summaryLabel(ready.title, ready.state), "Ver resumen de Proyecto A, Listo. Solo muestra un resumen.");

    const caution = enCursoOf([
      project("beta", {
        title: "Proyecto B",
        readiness: readiness("caution", "BET-1: el worktree tiene cambios sin guardar.", "WORKTREE_DIRTY", "BET-1"),
        tasks: [claim("BET-1", live)],
      }),
    ])[0]!;
    assert.equal(READINESS_BADGE[caution.state], "Con cuidado");
    assert.equal(caution.reasons[0]!.text, "BET-1: el worktree tiene cambios sin guardar.");
    assert.equal(summaryAction(caution.state), "confirm");
    assert.equal(unblockOf(caution), null);

    const blocked = enCursoOf([
      project("gamma", {
        title: "Proyecto C",
        readiness: readiness("blocked", "GAM-1: el PR falló los checks.", "CI_FAILURE", "GAM-1"),
        tasks: [ticket("GAM-1", "In review")],
      }),
    ])[0]!;
    assert.equal(READINESS_BADGE[blocked.state], "Bloqueado");
    assert.equal(blocked.line, "GAM-1: el PR falló los checks.");
    assert.equal(summaryAction(blocked.state), "none");
    assert.deepEqual(unblockOf(blocked), { href: "/p/gamma?task=GAM-1", label: "Ver GAM-1" });

    const decision = enCursoOf([
      project("delta", {
        title: "Proyecto D",
        readiness: readiness("blocked", "DEL-1: espera una decisión humana.", "DECISION_PENDING", "DEL-1"),
        tasks: [claim("DEL-1", live)],
      }),
    ])[0]!;
    assert.equal(summaryAction(decision.state), "none");
    assert.equal(unblockOf(decision, [{ project: "delta", key: "DEL-1", kind: "question" }])?.label, "Ver la pregunta de DEL-1");
    assert.equal(unblockOf(decision, [{ project: "delta", key: "DEL-1", kind: "approval" }])?.label, "Ver la aprobación de DEL-1");
    assert.equal(unblockOf(decision)?.label, "Ver la decisión de DEL-1");
  });

  test("an expired claim is a row only because of LEASE_EXPIRED", () => {
    const hidden = ticket("GAM-1", "In progress");
    const without = project("gamma", {
      title: "Proyecto C",
      readiness: readiness("caution", "GAM-1: el dueño ya no está en la máquina.", "OWNER_ABSENT", "GAM-1"),
      tasks: [hidden],
    });
    assert.deepEqual(enCursoOf([without]), []);
    const expired = project("gamma", {
      title: "Proyecto C",
      readiness: readiness("caution", "GAM-1: la reserva de trabajo ya venció.", "LEASE_EXPIRED", "GAM-1"),
      tasks: [hidden],
    });
    const rows = enCursoOf([expired]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.slug, "gamma");
    assert.equal(rows[0]!.reasons.filter((reason) => reason.code === "LEASE_EXPIRED").length, 1);
    assert.equal(rows[0]!.line, "GAM-1: la reserva de trabajo ya venció.");
  });

  test("the quiet line names the projects and has no summary button", () => {
    const only = [project("alfa", { title: "Proyecto A" }), project("beta", { title: "Proyecto B" })];
    assert.deepEqual(enCursoOf(only), []);
    assert.equal(quietLine(sinTrabajoOf(only)), `${QUIET_PREFIX}: Proyecto A, Proyecto B`);
    assert.equal(quietLine([]), `${QUIET_PREFIX}.`);
    assert.equal(summaryAction("blocked"), "none");
    assert.equal(summaryAction("no_context"), "none");
    assert.equal(SUMMARY_BUTTON, "Ver resumen");
    assert.equal(SUMMARY_ONLY, "Solo muestra un resumen.");
    assert.equal(SUMMARY_ANYWAY, "Ver resumen de todos modos");
    assert.equal(SUMMARY_CANCEL, "Cancelar");
    assert.equal(READ_ONLY_LINE, "Solo lectura. No cambia nada del proyecto.");
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

describe("lastMovementLine", () => {
  test("eight days ago names the last event; no event is empty", () => {
    const now = Date.parse("2026-10-16T12:00:00.000Z");
    assert.equal(
      lastMovementLine({ at: "2026-10-08T12:00:00.000Z", type: "note", task_key: "MC-12", agent: "agente" }, now),
      "Último movimiento hace 8 días: MC-12 · note (agente)",
    );
    assert.equal(lastMovementLine(undefined, now), "");
  });
});

describe("retomarOf", () => {
  test("headline, the note beside it, live claims and the next ticket", () => {
    const view = retomarOf({
      headline: { generated: "En curso: ALF-2 (Agente Norte).", note: { text: "Falta el entorno de demo.", stale: true } },
      claims: [
        { key: "ALF-2", title: "Medir el pulso", owner: { agent: "Agente Norte" } },
        { key: "ALF-8", title: "Sin agente", owner: null },
      ],
      next_claimable: { key: "ALF-3", title: "Cerrar el demo" },
    });
    assert.equal(view.headline, "En curso: ALF-2 (Agente Norte).");
    assert.equal(view.note, "Falta el entorno de demo.");
    assert.equal(view.noteStale, true);
    assert.deepEqual(view.claims, [
      { key: "ALF-2", title: "Medir el pulso", agent: "Agente Norte" },
      { key: "ALF-8", title: "Sin agente", agent: null },
    ]);
    assert.deepEqual(view.next, { key: "ALF-3", title: "Cerrar el demo" });
  });

  test("an empty resume still has a shape", () => {
    const view = retomarOf({
      headline: { generated: "", note: { text: "", stale: false } },
      claims: [],
      next_claimable: null,
    });
    assert.deepEqual(view, { headline: "", note: "", noteStale: false, claims: [], next: null });
  });
});

test("an idea is not in flight, blocked, or next", () => {
  const alfa = project("alfa", {
    title: "Proyecto A",
    readiness: readiness("ready", "Siguiente: nada."),
    tasks: [ticket("ALF-IDEA1", "In progress", { kind: "idea" })],
  });
  assert.deepEqual(enCursoOf([alfa]), []);
  assert.deepEqual(sinTrabajoOf([alfa]).map((row) => row.title), ["Proyecto A"]);
  assert.deepEqual(bloqueadoOf([alfa], [], NOW), []);
  assert.deepEqual(siguienteOf([alfa]), []);
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

  test("an idea is not a ticket line, even when it is marked next", () => {
    const alfa = project("alfa", {
      tasks: [ticket("WRK-IDEA1", "Open", { kind: "idea" }), ticket("WRK-3", "Ready")],
      next_claimable: { key: "WRK-IDEA1", title: "Cobrar en la app", kind: "idea" },
    });
    const beta = project("beta", {
      tasks: [ticket("BET-IDEA1", "Open", { kind: "idea" })],
      next_claimable: { key: "BET-IDEA1", title: "Otra idea" },
    });
    const gamma = project("gamma", { next_claimable: { key: "GAM-1", title: "Empezar" } });
    assert.deepEqual(siguienteOf([alfa, beta, gamma]).map((r) => r.key), ["GAM-1"]);
  });
});

function ideaTask(key: string, extra: Partial<IdeaTask> = {}): IdeaTask {
  return {
    key,
    kind: "idea",
    title: key,
    summary: "",
    status: "Open",
    stage: "idea",
    waits: "Doc Idea",
    updated_at: "2026-04-01T00:00:00.000Z",
    created_at: "2026-04-01T00:00:00.000Z",
    ...extra,
  };
}

describe("En curso on the page", () => {
  const page = readFileSync(new URL("../ui/src/pages/ahora.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("../ui/src/components/retomar-sheet.tsx", import.meta.url), "utf8");

  test("the section uses the server badge, the summary button, and a confirm step only in words", () => {
    for (const word of ["SUMMARY_BUTTON", "SUMMARY_ONLY", "SUMMARY_ANYWAY", "SUMMARY_CANCEL", "QUIET_PREFIX", "READINESS_BADGE", "summaryAction", "quietLine", "unblockOf", "Ver resumen de "]) {
      assert.equal(page.includes(word), true, word);
    }
    assert.equal(page.includes(">Retomar<"), false);
    assert.equal(page.includes("LIVENESS_WORD"), false);
    assert.equal(page.includes('variant="outline"'), true);
    assert.equal(page.includes("onCloseAutoFocus={handleConfirmCloseAutoFocus}"), true);
    assert.equal(page.includes("summaryButtonRef.current?.focus()"), true);
    assert.equal(page.includes("Dialog"), true);
  });

  test("the sheet is a read-only summary and does not call a write", () => {
    assert.equal(sheet.includes("READ_ONLY_LINE"), true);
    assert.equal(sheet.includes("Resumen de "), true);
    assert.equal(sheet.includes(">Retomar<"), false);
    assert.equal(sheet.includes("api.project"), true);
    assert.equal(sheet.replaceAll("api.project", "").includes("api."), false);
    assert.equal(/mutate|method:\s*"POST"/.test(sheet), false);
  });
});

describe("ideas on Ahora", () => {
  test("the stage labels are the five Spanish names", () => {
    assert.deepEqual(Object.values(IDEA_STAGE_LABEL), ["Idea", "Investigación", "Diseño", "Planeación", "Lista"]);
  });

  test("an idea card has no gate mark (gates were removed in 2.17)", () => {
    const page = readFileSync(new URL("../ui/src/pages/ahora.tsx", import.meta.url), "utf8");
    assert.equal(page.includes("◆"), false);
    assert.equal(/gate|compuerta/i.test(page), false);
    const [idea] = ideasFromProject({ slug: "workia", title: "Workia" }, [ideaTask("WRK-IDEA1", { title: "Cobrar", summary: "Cobrar" })]);
    assert.equal("gateOpen" in idea!, false);
  });

  test("ideaFinished: ready, promoted, Done and Won't do are finished; an open idea in planning is not", () => {
    assert.equal(ideaFinished({ status: "Open", stage: "ready" }), true);
    assert.equal(ideaFinished({ status: "Open", stage: "design", promoted_to: "WRK-I1" }), true);
    assert.equal(ideaFinished({ status: "Open", stage: "design", promotedTo: "WRK-01" }), true);
    assert.equal(ideaFinished({ status: "Done", stage: "research" }), true);
    assert.equal(ideaFinished({ status: "Won't do", stage: "idea" }), true);
    assert.equal(ideaFinished({ status: "Open", stage: "planning" }), false);
    assert.equal(ideaFinished({ status: "Open", stage: "planning", promoted_to: "  " }), false);
  });

  test("Ahora groups only unfinished ideas, by open stage, with key and one line", () => {
    const workia = ideasFromProject(
      { slug: "workia", title: "Workia" },
      [
        ideaTask("WRK-IDEA1", { title: "Cobrar en la app", summary: "Cobrar en la app", stage: "idea", created_at: "2026-01-02T00:00:00.000Z", waits: "Por qué ahora" }),
        ideaTask("WRK-IDEA2", { title: "Notas de voz", summary: "Notas de voz", stage: "research", created_at: "2026-02-01T00:00:00.000Z", waits: "Doc Investigación" }),
        ideaTask("WRK-IDEA3", { title: "Cerrada", summary: "", stage: "design", status: "Done", promoted_to: "WRK-I1", waits: "Puede avanzar", created_at: "2026-01-01T00:00:00.000Z" }),
        ideaTask("WRK-IDEA4", { title: "Descartada", stage: "planning", status: "Won't do", waits: "", created_at: "2026-03-01T00:00:00.000Z" }),
        ideaTask("WRK-IDEA5", { title: "Ya promovida", stage: "planning", promoted_to: "WRK-I2", waits: "Puede avanzar", created_at: "2026-03-03T00:00:00.000Z" }),
        ideaTask("WRK-IDEA6", { title: "En plan", summary: "En plan", stage: "planning", waits: "Doc Plan", created_at: "2026-03-04T00:00:00.000Z" }),
        { key: "WRK-01", kind: "ticket", title: "Un ticket", summary: "", status: "Ready", updated_at: "2026-01-01T00:00:00.000Z" },
      ],
    );
    const taller = ideasFromProject(
      { slug: "taller", title: "Taller" },
      [ideaTask("TAL-IDEA1", { title: "Lista para el plan", summary: "Lista para el plan", stage: "ready", waits: "Lista para promover", created_at: "2026-03-02T00:00:00.000Z" })],
    );
    const columns = ideasByStage([...workia, ...taller]);
    assert.deepEqual(columns.map((c) => c.label), ["Idea", "Investigación", "Diseño", "Planeación"]);
    assert.deepEqual(columns[0]!.ideas.map((i) => [i.key, i.line]), [["WRK-IDEA1", "Cobrar en la app"]]);
    assert.deepEqual(columns[1]!.ideas.map((i) => i.key), ["WRK-IDEA2"]);
    assert.deepEqual(columns[2]!.ideas, [], "a Done idea is hidden");
    assert.deepEqual(columns[3]!.ideas.map((i) => i.key), ["WRK-IDEA6"], "Won't do and promoted are hidden; an open one in planning stays");
    assert.equal(columns.some((c) => c.ideas.some((i) => i.key === "TAL-IDEA1" || i.key === "WRK-01")), false);
  });

  test("the project Ideas table hides finished ideas behind Mostrar terminadas (N), not persisted", () => {
    const parts = readFileSync(new URL("../ui/src/components/plan/project-parts.tsx", import.meta.url), "utf8");
    assert.match(parts, /ideaFinished/);
    assert.match(parts, /useState\(false\)/);
    assert.match(parts, /Mostrar terminadas \(\$\{finished\.length\}\)/);
    assert.equal(/localStorage|sessionStorage/.test(parts), false);
  });

  test("the oldest idea that is still waiting is one line, and a free or closed idea is not it", () => {
    const ideas = ideasFromProject(
      { slug: "workia", title: "Workia" },
      [
        ideaTask("WRK-IDEA1", { title: "Cobrar en la app", summary: "Cobrar en la app", waits: "¿Quién cobra?", created_at: "2026-01-02T00:00:00.000Z" }),
        ideaTask("WRK-IDEA2", { title: "Más vieja pero libre", summary: "Más vieja pero libre", waits: "Puede avanzar", created_at: "2026-01-01T00:00:00.000Z" }),
        ideaTask("WRK-IDEA3", { title: "Cerrada", summary: "Cerrada", status: "Done", promoted_to: "WRK-01", waits: "Doc Idea", created_at: "2025-12-01T00:00:00.000Z" }),
        ideaTask("WRK-IDEA5", { title: "Promovida", summary: "Promovida", promoted_to: "WRK-I3", waits: "Doc Idea", created_at: "2025-11-01T00:00:00.000Z" }),
        ideaTask("WRK-IDEA4", { title: "Más nueva", summary: "Más nueva", stage: "design", waits: "Doc Diseño", created_at: "2026-05-01T00:00:00.000Z" }),
      ],
    );
    const oldest = oldestWaitingIdea(ideas);
    assert.equal(oldest?.key, "WRK-IDEA1");
    assert.equal(oldest?.line, "Cobrar en la app");
    assert.equal(oldestWaitingIdea(ideas.filter((i) => i.key !== "WRK-IDEA1"))?.key, "WRK-IDEA4");
    assert.equal(oldestWaitingIdea([]), null);
  });

  test("a closed idea says what it became, and Bloqueado ignores an idea", () => {
    const ideas = ideasFromProject(
      { slug: "workia", title: "Workia" },
      [
        ideaTask("WRK-IDEA3", { title: "Cerrada", summary: "Cerrada", status: "Done", promoted_to: "WRK-I1", stage: "design" }),
        ideaTask("WRK-IDEA4", { title: "Descartada", summary: "Descartada", status: "Won't do", stage: "planning" }),
      ],
    );
    assert.deepEqual(ideas.map((i) => [i.key, ideaOutcome(i)]), [
      ["WRK-IDEA3", "Pasó a WRK-I1"],
      ["WRK-IDEA4", "Sin destino"],
    ]);
    const alfa = project("workia", {
      title: "Workia",
      initiatives: [{ key: "WRK-I1", waiting_on: [{ key: "WRK-IDEA1", on: "Doc Idea" }, { key: "WRK-9", on: "WRK-3 (In review)" }] }],
      tasks: [ticket("WRK-IDEA1", "Open", { kind: "idea" }), ticket("WRK-9", "Blocked")],
    });
    assert.deepEqual(bloqueadoOf([alfa], [], NOW).map((r) => r.key), ["WRK-9"]);
  });
});
