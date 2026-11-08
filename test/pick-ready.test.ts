// PLA-I29-10: a wake never picks work in a paused project, and a product owner only works its own project.
import assert from "node:assert/strict";
import { test } from "node:test";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { pickReady } = await import("../src/jobs/heartbeat.js");
type Row = Parameters<typeof pickReady>[1][number];

const row = (over: Partial<Row>): Row => ({
  project: "mianovia",
  key: "MIA-1",
  title: "work",
  priority: "P2",
  workType: "decision-needed",
  ownerAgent: null,
  paused: false,
  ...over,
});

const po = { id: "po-id", slug: "po-mianovia", role: "product-owner", capabilities: ["product-owner"] };
const taller = { id: "taller-id", slug: "taller", role: "engineer", capabilities: ["engineering"] };

test("PLA-I29-10 #1: a ticket in a paused project is never picked, even when owned", () => {
  assert.equal(pickReady(po, [row({ paused: true })]), null);
  assert.equal(pickReady(po, [row({ paused: true, ownerAgent: po.id })]), null);
  assert.equal(pickReady(taller, [row({ project: "micasa", key: "MIC-1", workType: "code", paused: true })]), null);
  const open = row({ key: "MIA-2", priority: "P3" });
  assert.equal(pickReady(po, [row({ key: "MIA-1", priority: "P0", paused: true }), open])?.key, "MIA-2");
});

test("PLA-I29-10 #2: po-<slug> ignores Ready work of other projects, even of a matching work type", () => {
  const other = row({ project: "micasa", key: "MIC-I12-10", priority: "P0" });
  assert.equal(pickReady(po, [other]), null);
  const mine = row({ key: "MIA-I1-3", priority: "P3" });
  assert.equal(pickReady(po, [other, mine])?.key, "MIA-I1-3");
  // A PO named by a project capability works that project too.
  const named = { id: "x", slug: "owner-plania", role: "product-owner", capabilities: ["plania"] };
  assert.equal(pickReady(named, [other, row({ project: "plania", key: "PLA-1" })])?.key, "PLA-1");
});

test("PLA-I29-10: shared roles still pick across unpaused projects", () => {
  const picked = pickReady(taller, [row({ project: "micasa", key: "MIC-2", workType: "code" }), row({ project: "zigzag", key: "ZIG-1", workType: "code", paused: true })]);
  assert.equal(picked?.key, "MIC-2");
});
