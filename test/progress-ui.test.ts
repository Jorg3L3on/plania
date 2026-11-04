// PLA-I19-3: the bitácora applies project, type and search together. Pure, no database.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { entryMatches, monthSpan, monthsBack, type LogNeedle } from "../ui/src/lib/progress.js";

const row = (patch: Partial<Parameters<typeof entryMatches>[0]> = {}) => ({
  project: "filmia",
  type: "bug",
  title: "Login de ejemplo en Safari",
  summary: "La sesión de ejemplo se quedaba a medias.",
  change: "",
  key: "FIL-B2",
  prs: [{ number: 293, title: "Arreglo de ejemplo" }],
  ...patch,
});

const keep = (rows: ReturnType<typeof row>[], needle: LogNeedle) => rows.filter((entry) => entryMatches(entry, needle));

describe("bitácora filters", () => {
  const rows = [
    row(),
    row({ project: "filmia", type: "code", title: "Login de ejemplo con un paso nuevo", key: "FIL-C2", prs: [] }),
    row({ project: "micasa", type: "bug", title: "Login de ejemplo no redirigía", key: "MIC-B1", prs: [{ number: 401, title: "Regreso" }] }),
    row({ project: "workia", type: "code", title: "Campo de ejemplo", key: "WRK-1", prs: [{ number: 293, title: "Otro" }] }),
  ];

  test("project, type and search all have to match", () => {
    const found = keep(rows, { project: "filmia", type: "bug", q: "login" });
    assert.deepEqual(found.map((entry) => entry.key), ["FIL-B2"]);
  });

  test("a type chip does not hide the other types from the matcher when it is empty", () => {
    const found = keep(rows, { project: "filmia", q: "login" });
    assert.deepEqual(found.map((entry) => entry.key).sort(), ["FIL-B2", "FIL-C2"]);
  });

  test("searching #293 matches the pull request, not a lookalike title", () => {
    const found = keep(rows, { q: "#293" });
    assert.deepEqual(found.map((entry) => entry.key).sort(), ["FIL-B2", "WRK-1"]);
  });

  test("the scrubber can name any of the last twelve months", () => {
    const months = monthsBack("2026-11-03", 12);
    assert.equal(months.length, 12);
    assert.equal(months[0]?.key, "2026-11");
    assert.equal(months[11]?.key, "2025-12");
    assert.equal(months.some((month) => month.key === "2026-03"), true);
    assert.deepEqual(monthSpan("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(monthSpan("2024-02"), { from: "2024-02-01", to: "2024-02-29" });
  });
});
