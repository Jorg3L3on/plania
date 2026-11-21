// PLA-I72-5: the rules and words of the new Máquinas door (ui/src/lib/cuarto.ts, CUARTO_WORDS), without a browser:
// a copy's state and pill, the summary chips, sizes the Spanish way, the leftovers' lines, the drawer named by the
// address (old single words included), the disk bars, the missing key found in a log, and the words in both
// languages with no branch names, no ticket keys and no «sandbox» in what the owner reads.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

type Json = Record<string, any>;
const cuarto = (await import(new URL("../ui/src/lib/cuarto.ts", import.meta.url).href)) as Json;
const { CUARTO_WORDS } = (await import(new URL("../ui/src/lib/maquinas-words.ts", import.meta.url).href)) as Json;

const copia = (patch: Json = {}): Json => ({ id: "inicio", kind: "inicio", key: null, title: "Inicio", status: null, branch: "sandbox", phase: "off", managed: false, port: null, url: null, started_at: null, error: null, detail: null, keep: false, database: "zz_dev_prueba", worktree: null, made: true, ...patch });
const ini = (patch: Json = {}): Json => copia({ id: "ZZ-I1", kind: "iniciativa", key: "ZZ-I1", title: "Agenda de citas", status: "Active", made: true, database: "zz_dev_ini_zz_i1", ...patch });

test("I72-5: a copy's state, pill and switch", () => {
  assert.equal(cuarto.rowState(copia({ phase: "live", managed: true })), "on");
  assert.equal(cuarto.rowState(copia({ phase: "capturing" })), "on");
  assert.equal(cuarto.rowState(copia({ phase: "starting" })), "starting");
  assert.equal(cuarto.rowState(copia({ phase: "failed" })), "failed");
  assert.equal(cuarto.rowState(copia({ phase: "running" })), "outside");
  assert.equal(cuarto.rowState(copia({ phase: "unavailable" })), "unavailable");
  assert.equal(cuarto.rowState(ini({ made: false })), "never");
  assert.equal(cuarto.rowState(ini()), "off");
  assert.equal(cuarto.pillWord("failed", "es"), "No arrancó");
  assert.equal(cuarto.pillWord("failed", "en"), "Did not start");
  assert.equal(cuarto.pillTone("on"), "ok");
  assert.equal(cuarto.pillTone("failed"), "bad");
  assert.deepEqual(cuarto.switchOf(copia({ phase: "live", managed: true })), { on: true, can: true });
  assert.deepEqual(cuarto.switchOf(copia({ phase: "running", managed: false })), { on: false, can: false }, "started outside Plania: the switch cannot stop it");
  assert.equal(cuarto.appUrl(copia({ phase: "live", url: "http://localhost:3001" })), "http://localhost:3001");
  assert.equal(cuarto.appUrl(copia({ phase: "starting", url: "http://localhost:3001" })), null, "Abrir la app only once it answers");
  assert.equal(cuarto.copySub(ini(), "es"), "Iniciativa · construyendo");
  assert.equal(cuarto.copySub(copia(), "es"), "Lo que ya se aceptó");
});

test("I72-5: the summary counts made copies, the ones on, the ones that did not start, and the leftovers", () => {
  const r = { project: "zz", configured: true, own_bases: true, no_code: false, copias: [copia({ phase: "live" }), ini({ phase: "failed" }), ini({ id: "ZZ-I2", key: "ZZ-I2", title: "Pagos", made: false })] };
  const s = cuarto.summaryOf(r, { project: "zz", sobrantes: [], total: 4, total_bytes: 1.34 * 1024 ** 3, swept_at: null }, "es");
  assert.equal(s.total, 2, "an initiative never turned on is not a copy yet");
  assert.equal(s.on, 1);
  assert.deepEqual(s.failed, [{ id: "ZZ-I1", name: "Agenda de citas" }]);
  assert.equal(s.leftovers, 4);
  assert.equal(CUARTO_WORDS.es.leftovers(4, cuarto.sizeText(s.leftover_bytes, "es")), "4 sobrantes · 1.34 GB");
});

test("I72-5: sizes, times and percentages the way the screen writes them", () => {
  // The house locale (es-MX), as every other number on the screen.
  assert.deepEqual(cuarto.size(1.27 * 1024 ** 3, "es"), { v: "1.27", u: "GB" });
  assert.deepEqual(cuarto.size(1.27 * 1024 ** 3, "en"), { v: "1.27", u: "GB" });
  assert.deepEqual(cuarto.size(414 * 1024 ** 2, "es"), { v: "414", u: "MB" });
  assert.equal(cuarto.size(null), null);
  assert.equal(cuarto.since(8040, "es"), "2 h 14 m");
  assert.equal(cuarto.since(2460, "es"), "41 m");
  assert.equal(cuarto.since(6 * 86400, "es"), "6 días");
  assert.equal(cuarto.since(null), "—");
  assert.equal(cuarto.pct(63, 100), 63);
  assert.equal(cuarto.pct(5, 0), null);
  assert.equal(cuarto.cpuText(2.74, "es"), "2.7");
  const now = Date.parse("2026-11-21T12:00:00Z");
  assert.equal(cuarto.ago("2026-11-15T12:00:00Z", now, "es"), "hace 6 días");
  assert.equal(cuarto.ago("2026-11-01T12:00:00Z", now, "es"), "hace 2 semanas");
});

test("I72-5: a leftover's line says what it is, where it came from, its size and its button", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const base = cuarto.leftLine({ id: "base:mianovia_resenas", kind: "base", name: "mianovia_resenas", initiative: { key: "X-I9", title: "Reseñas", status: "Done", closed_at: "2026-11-15T12:00:00Z" }, size_bytes: 74 * 1024 ** 2, mem_bytes: null, port: null }, now, "es");
  assert.deepEqual(base, { kind: "Base", name: "mianovia_resenas", from: "de «Reseñas» · terminada hace 6 días", amount: "74 MB", button: "Borrar", icon: "db" });
  const srv = cuarto.leftLine({ id: "servidor:port:3004", kind: "servidor", name: "port:3004", initiative: { key: "X-I9", title: "Reseñas", status: "Won't do", closed_at: null }, size_bytes: null, mem_bytes: 380 * 1024 ** 2, port: 3004 }, now, "es");
  assert.equal(srv.name, "localhost:3004");
  assert.equal(srv.amount, "380 MB en memoria");
  assert.equal(srv.button, "Apagar y borrar");
  assert.equal(srv.from, "de «Reseñas» · descartada");
  const folder = cuarto.leftLine({ id: "carpeta:_ini_x_i3", kind: "carpeta", name: "_ini_x_i3", initiative: { key: "X-I3", title: "Cupones", status: "Done", closed_at: null }, size_bytes: 1.21 * 1024 ** 3, mem_bytes: null, port: null }, now, "es");
  assert.equal(folder.name, "copia de «Cupones»", "a folder is named by its initiative, never by its folder or key");
  assert.ok(!JSON.stringify([base, srv, folder]).includes("X-I"), "no ticket key on screen");
});

test("I72-5: the drawer named by the address, old single words included", () => {
  const cs = [copia(), ini()];
  assert.deepEqual(cuarto.focusOf("ZZ-I1:servidor", cs), { who: "ZZ-I1", part: "servidor" });
  assert.deepEqual(cuarto.focusOf("shared:llaves", cs), { who: "shared", part: "llaves" });
  assert.deepEqual(cuarto.focusOf("servidor", cs), { who: "inicio", part: "servidor" });
  assert.deepEqual(cuarto.focusOf("llaves", cs), { who: "shared", part: "llaves" });
  assert.deepEqual(cuarto.focusOf("tabla:citas", cs), { who: "inicio", part: "base" });
  assert.equal(cuarto.focusOf("pruebas", cs), null, "Pruebas is gone from this door");
  assert.equal(cuarto.focusOf("ZZ-I9:base", cs), null, "a copy that is not listed opens nothing");
  assert.equal(cuarto.focusOf("shared:otra", cs), null);
  assert.equal(cuarto.focusKey({ who: "ZZ-I1", part: "base" }), "ZZ-I1:base");
});

test("I72-5: disk bars, the missing key in a log, the last request and the sparkline", () => {
  const bars = cuarto.diskBars({ total: 900, code: 100, deps: 600, cache: 200, log: 0 }, "es");
  assert.deepEqual(bars.map((b: Json) => [b.label, b.share]), [["código", 17], ["dependencias", 100], ["caché de compilación", 33]]);
  assert.equal(cuarto.missingKey("Error: Missing env STRIPE_SECRET_KEY\nexit 1", ["STRIPE_SECRET_KEY", "RESEND_API_KEY"]), "STRIPE_SECRET_KEY");
  assert.equal(cuarto.missingKey("Error: ECONNREFUSED", ["STRIPE_SECRET_KEY"]), null);
  assert.equal(cuarto.lastRequest(["Ready", " GET /citas 200 in 70ms", " POST /citas 201 in 133ms", "compiled"]), "POST /citas 201 in 133ms");
  assert.equal(cuarto.errorLine(["Ready", "Error: Missing env X", "at y"]), "Error: Missing env X");
  assert.ok(cuarto.spark([1, 3, 2]).line.startsWith("M0.0,"));
  assert.equal(cuarto.spark([1]), null);
});

test("I72-5: every word exists in both languages; what the owner reads names no branch, key or «sandbox»", () => {
  const flat = (o: Json, out: string[] = []): string[] => {
    for (const v of Object.values(o)) {
      if (typeof v === "string") out.push(v);
      else if (typeof v === "function") out.push(String(v(2, 3)));
      else if (v && typeof v === "object") flat(v, out);
    }
    return out;
  };
  const keys = (o: Json, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(CUARTO_WORDS.es).filter((k) => !k.startsWith("status.") && !k.startsWith("leftHow.") && !k.startsWith("leftKind.") && !k.startsWith("diskParts.")), keys(CUARTO_WORDS.en).filter((k) => !k.startsWith("status.") && !k.startsWith("leftHow.") && !k.startsWith("leftKind.") && !k.startsWith("diskParts.")));
  for (const s of flat(CUARTO_WORDS.es)) {
    assert.ok(!/sandbox|\bmain\b|jl\/|PLA-/i.test(s), s);
  }
});

test("I72-5: the door has no app still, Tomar captura, Pruebas or test walk, and no coloured stripe on a card's edge", () => {
  const door = readFileSync(new URL("../ui/src/components/corriente/maquinas.tsx", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  for (const gone of ["api.prueba(", "api.captures(", "api.pruebas(", "api.correrPruebas(", "api.recorrido(", "cor-appview", "Tomar captura"]) assert.ok(!door.includes(gone), gone);
  const css = readFileSync(new URL("../ui/src/corriente.css", import.meta.url), "utf8");
  const mine = css.slice(css.indexOf("/* PLA-I72-5"));
  assert.ok(!/border-left\s*:\s*\d+px\s+solid\s+(?!var\(--cor-line)/.test(mine), "no left accent stripe");
  assert.ok(!/inset\s+\d+px\s+0\s+0/.test(mine), "no inset left stripe");
});
