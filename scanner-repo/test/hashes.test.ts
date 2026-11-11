import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hashesFromLines, parseHashArgs } from "../src/build-hashes.ts";
import { hashToken, normalizeToken } from "../src/scan/hashes.ts";

test("hash lines match the synthetic example file and the command does not accept a missing salt", () => {
  const example = JSON.parse(readFileSync(new URL("../fixtures/hashes.example.json", import.meta.url), "utf8")) as { salt: string; hashes: string[] };
  const lines = ["persona ficticia", "nombre ejemplo", "cuenta-demo-000"].join("\n");
  assert.deepEqual(hashesFromLines(`# comment\n\n${lines}\n`, example.salt), example.hashes);
  assert.equal(hashToken(example.salt, normalizeToken("cuenta-demo-000")), example.hashes[2]);
  assert.equal("error" in parseHashArgs(["--in", "names.txt", "--out", "out.json"], ""), true);
  const parsed = parseHashArgs(["--in", "names.txt", "--out", "out.json", "--salt", "example-salt"]);
  assert.equal("error" in parsed, false);
});
