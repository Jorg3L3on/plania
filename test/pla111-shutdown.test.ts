// PLA-111 (guided test PLA-86): F-39, a restart lets the requests in flight finish before the process exits (an
// owner's «Aceptar» vanished in a restart); F-33, a project's live copy keeps its port and «Pruébala en vivo» opens
// the tab in the same click. Pure: no database, no browser.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";

process.env.PLANIA_JOBS = "0";
const shutdown = await import("../src/ops/shutdown.js");
const { vivoPort, VIVO_BASE } = await import("../src/captures/vivo.js");
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => shutdown.resetShutdown());

test("PLA-111 F-39: the exit waits for the server's requests in flight, once, and gives up after the limit", async () => {
  const exits: number[] = [];
  let finish: (() => void) | null = null;
  let idle = 0;
  shutdown.setHttpServer({ close: (cb) => (finish = () => cb?.()), closeIdleConnections: () => idle++ });
  shutdown.exitAfterDrain(143, { exit: (c) => exits.push(c), ms: 1000 });
  shutdown.exitAfterDrain(143, { exit: (c) => exits.push(c), ms: 1000 });
  await tick(20);
  assert.deepEqual(exits, [], "not while a request is in flight");
  assert.equal(idle, 1, "idle keep-alive connections are closed at once");
  finish!();
  assert.deepEqual(exits, [143], "exits when the last request finished, once");

  shutdown.resetShutdown();
  const late: number[] = [];
  shutdown.setHttpServer({ close: () => undefined });
  shutdown.exitAfterDrain(143, { exit: (c) => late.push(c), ms: 30 });
  await tick(60);
  assert.deepEqual(late, [143], "a request that never ends does not hold the restart past the limit");

  shutdown.resetShutdown();
  const now: number[] = [];
  shutdown.exitAfterDrain(130, { exit: (c) => now.push(c) });
  assert.deepEqual(now, [130], "no server: exits at once");
});

test("PLA-111 F-39: the server and the copies' signal hook both drain", async () => {
  const dev = await readFile(new URL("../scripts/dev.ts", import.meta.url), "utf8");
  assert.match(dev, /setHttpServer\(http as never\)/);
  assert.match(dev, /process\.once\(sig, \(\) => exitAfterDrain\(/);
  const prueba = await readFile(new URL("../src/captures/prueba.ts", import.meta.url), "utf8");
  assert.match(prueba, /exitAfterDrain\(sig === "SIGINT" \? 130 : 143\)/);
  assert.doesNotMatch(prueba, /process\.exit\(sig === "SIGINT" \? 130 : 143\)/);
});

test("PLA-111 F-33: a project's live-copy port is steady and in its range; the card opens the tab in the click", async () => {
  for (const slug of ["mianovia", "filmia", "micasa", "plania", "workia", "zigzag"]) {
    const p = vivoPort(slug);
    assert.equal(p, vivoPort(slug));
    assert.ok(p >= VIVO_BASE && p < VIVO_BASE + 100, `${slug} ${p}`);
  }
  const entrega = await readFile(new URL("../ui/src/components/corriente/entrega.tsx", import.meta.url), "utf8");
  assert.match(entrega, /const tab = typeof window !== "undefined" \? window\.open\("about:blank", "_blank"\) : null;/);
  assert.match(entrega, /tab\.location\.href = url;/);
});
