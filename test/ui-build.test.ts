// PLA-I46-1: the server rebuilds dist/ui at start when its stamp is not the checkout's HEAD.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { BUILD_STAMP, readUiBuild, staleReason } from "../src/ui-build.js";

const HEAD = { commit: "f039c8e0fbf17cea90fb0ffea489952ba12006bd", dirty: false };
const built = (commit: string | null, dirty = false) => ({ commit, dirty, built_at: "2026-11-13T00:00:00Z" });

describe("ui build stamp", () => {
  test("no index.html is always stale", () => {
    assert.equal(staleReason(built(HEAD.commit), HEAD, false), "no build");
  });
  test("a build on HEAD is fresh", () => {
    assert.equal(staleReason(built(HEAD.commit), HEAD, true), null);
  });
  test("a build on an older commit is stale, with both commits named", () => {
    assert.equal(staleReason(built("6b17fa41f8cf"), HEAD, true), "build is 6b17fa4, HEAD is f039c8e");
  });
  test("a build without a stamp (before this change) is stale", () => {
    assert.match(staleReason(null, HEAD, true) ?? "", /no stamp/);
  });
  test("a build from uncommitted changes is stale", () => {
    assert.match(staleReason(built(HEAD.commit, true), HEAD, true) ?? "", /uncommitted/);
  });
  test("outside git, serve what is there", () => {
    assert.equal(staleReason(null, null, true), null);
  });
  test("readUiBuild reads the stamp the build writes and survives a broken one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-ui-"));
    assert.equal(readUiBuild(dir), null);
    writeFileSync(path.join(dir, BUILD_STAMP), JSON.stringify(built(HEAD.commit)));
    assert.equal(readUiBuild(dir)?.commit, HEAD.commit);
    writeFileSync(path.join(dir, BUILD_STAMP), "{not json");
    assert.equal(readUiBuild(dir), null);
  });
});
