// PLA-I32-2: one team per project. The roster as it stands before the deploy (11 rows, fake values, the
// same shape) is rebuilt on a fresh test store with six projects, then seedOrg runs the way Jorge's deploy
// runs it, twice. Never a real database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { resetTestStore, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { roleOf } = await import("../src/runner/limits.js");
const { notNull } = await import("../src/store/types.js");

const PROJECTS: [slug: string, title: string, prefix: string][] = [
  ["filmia", "Filmia", "FIL"],
  ["mianovia", "Mianovia", "MIA"],
  ["micasa", "MiCasa", "MIC"],
  ["plania", "Plania", "PLA"],
  ["workia", "Workia", "WRK"],
  ["zigzag", "Zigzag", "ZIG"],
];

// Today's 11 rows after PLA-I30-1 (fake names, same roles).
const ROSTER: [slug: string, name: string, role: string, title: string, kind: string, caps: string, parent: string | null][] = [
  ["ceo", "CEO", "human", "CEO", "human", "{}", null],
  ["asistente", "Asistente", "chief-of-staff", "Chief of Staff", "bot", "{staff}", "ceo"],
  ["taller", "Taller", "taller", "Builder", "bot", "{engineering}", "ceo"],
  ["research", "Research", "shared", "Shared service", "bot", "{research}", "asistente"],
  ["artist", "Artist", "shared", "Shared service", "bot", "{design}", "asistente"],
  ["po-mianovia", "Bot Mianovia", "product-owner", "Product owner", "bot", "{mianovia}", "ceo"],
  ["housi", "Housi", "product-owner", "Product owner", "bot", "{micasa}", "ceo"],
  ["workia", "Workia", "product-owner", "Product owner", "bot", "{workia}", "ceo"],
  ["filmia", "Filmia", "product-owner", "Product owner", "bot", "{filmia}", "ceo"],
  ["zigzag", "ZigZag", "product-owner", "Product owner", "bot", "{zigzag}", "ceo"],
  ["owner-plania", "Plania", "product-owner", "Product owner", "bot", "{plania}", "ceo"],
];

test("I32-2: today's 11-row roster becomes asistente, ceo and six teams of four; the shared three retire with their history", async () => {
  // The test store starts with four of the six projects; the roster starts empty.
  const store = await resetTestStore();
  try {
    // A Postgres array literal ("{a,b}") as a list.
    const list = (literal: string) => literal.slice(1, -1).split(",").filter(Boolean);
    await store.fix(async (uow) => {
      for (const [slug, title, prefix] of PROJECTS) if (!(await uow.get("projects", { slug }))) await uow.insert("projects", { slug, title, keyPrefix: prefix });
      for (const [slug, nm, role, title, kind, caps] of ROSTER) {
        await uow.insert("agents", { slug, name: nm, role, title, kind, adapter: kind === "human" ? "none" : "claude_code", adapterConfig: { command_env: "CLAUDE_CODE_BIN" }, capabilities: list(caps) });
      }
      for (const [slug, , , , , , parent] of ROSTER) {
        if (parent) await uow.update("agents", { slug }, { reportsTo: (await uow.get("agents", { slug: parent }))!.id });
      }
    });
    const id = async (slug: string) => {
      const agent = await store.get("agents", { slug });
      assert.ok(agent, slug);
      return agent.id;
    };
    const pid = (slug: string) => store.projectId(slug);
    // History on the rows that change: runs of a PO about to be renamed and of the shared taller,
    // an open ticket of the shared taller in micasa and a closed one in filmia.
    const [housi, taller, ownerPlania, micasa, filmia] = [await id("housi"), await id("taller"), await id("owner-plania"), await pid("micasa"), await pid("filmia")];
    await store.fix(async (uow) => {
      await uow.insert("agentRuns", { agentId: housi, projectId: micasa, role: "product-owner", status: "ok" });
      await uow.insert("agentRuns", { agentId: housi, projectId: micasa, role: "product-owner", status: "fail" });
      await uow.insert("agentRuns", { agentId: taller, projectId: micasa, role: "taller", status: "ok" });
      await uow.insert("heartbeatRuns", { agentId: ownerPlania, startedAt: uow.now, status: "ok", adapter: "claude_code" });
      await uow.insert("tasks", { projectId: micasa, key: "MIC-1", title: "Fake open ticket", kind: "ticket", status: "Ready", ownerAgent: taller });
      await uow.insert("tasks", { projectId: filmia, key: "FIL-1", title: "Fake closed ticket", kind: "ticket", status: "Done", ownerAgent: taller });
    });
    const housiId = await id("housi");

    const { db } = makeDb();
    const first = await seedOrg(db);
    assert.deepEqual(first.renamed.sort(), ["filmia→po-filmia", "housi→po-micasa", "owner-plania→po-plania", "workia→po-workia", "zigzag→po-zigzag"]);
    assert.deepEqual(first.retired.sort(), ["artist", "research", "taller"]);
    const second = await seedOrg(db);
    assert.deepEqual([second.inserted, second.removed, second.renamed, second.retired], [[], [], [], []], "a second run changes nothing");

    const agents = await store.find("agents", {}, { orderBy: [{ column: "slug" }] });
    const projectSlug = new Map((await store.find("projects")).map((p) => [p.id, p.slug]));
    const agentSlug = new Map(agents.map((a) => [a.id, a.slug]));
    const rows = agents.map((a) => ({
      slug: a.slug,
      status: a.status,
      adapter: a.adapter,
      project: a.projectId ? (projectSlug.get(a.projectId) ?? null) : null,
      role_template: a.roleTemplate,
      boss: a.reportsTo ? (agentSlug.get(a.reportsTo) ?? null) : null,
      note: a.note,
      role: a.role,
      capabilities: a.capabilities,
    }));
    const live = rows.filter((r) => r.status !== "retired");
    const company = live.filter((r) => !r.project).map((r) => r.slug);
    assert.deepEqual(company, ["asistente", "ceo"]);
    assert.equal(live.find((r) => r.slug === "asistente")!.role_template, "asistente");
    for (const [slug] of PROJECTS) {
      const team = live.filter((r) => r.project === slug);
      assert.deepEqual(
        team.map((r) => [r.slug, r.role_template, r.boss]),
        [
          [`artist-${slug}`, "artist", `po-${slug}`],
          [`po-${slug}`, "product-owner", "ceo"],
          [`research-${slug}`, "research", `po-${slug}`],
          [`taller-${slug}`, "taller", `po-${slug}`],
        ],
        slug,
      );
      for (const r of team) {
        assert.equal(r.adapter, "claude_code", r.slug);
        assert.equal(roleOf({ slug: r.slug, role: r.role, capabilities: r.capabilities, roleTemplate: r.role_template }), r.role_template, r.slug);
      }
    }
    assert.equal(live.length, 2 + 6 * 4);

    const retired = rows.filter((r) => r.status === "retired");
    assert.deepEqual(retired.map((r) => [r.slug, r.adapter, r.project]), [["artist", "none", null], ["research", "none", null], ["taller", "none", null]]);

    // Renamed POs keep their id, name and runs; the old slug is in the note.
    const micasaPo = (await store.get("agents", { slug: "po-micasa" }))!;
    assert.equal(micasaPo.id, housiId);
    assert.equal(micasaPo.name, "Housi");
    assert.match(micasaPo.note, /alias: housi/);
    assert.equal(await store.count("agentRuns", { agentId: housiId }), 2);
    assert.equal(await store.count("heartbeatRuns", { agentId: await id("po-plania") }), 1);
    assert.equal((await store.get("agents", { slug: "po-mianovia" }))!.name, "Bot Mianovia", "an existing name is kept");

    // The shared taller keeps its run; its open ticket moved to the project's Taller, the closed one stayed.
    assert.equal(await store.count("agentRuns", { agentId: await id("taller") }), 1);
    const slugOf = new Map((await store.find("agents")).map((a) => [a.id, a.slug]));
    const owners = (await store.find("tasks", { ownerAgent: notNull() }, { orderBy: [{ column: "key" }] })).map((t) => ({ key: t.key, slug: slugOf.get(t.ownerAgent!) }));
    assert.deepEqual(owners, [{ key: "FIL-1", slug: "taller" }, { key: "MIC-1", slug: "taller-micasa" }]);
  } finally {
    await store.end();
  }
});
