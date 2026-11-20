// PLA-126: the manifest.ts Plania writes reads back in Plania's own checker. Pure.
import assert from "node:assert/strict";
import { test } from "node:test";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { parseManifest } = await import("../src/brand/check.js");
const { manifestText } = await import("../src/brand/generate.js");

test("PLA-126 #1 Plania's own Next.js manifest.ts reads back with every field and its four icons", () => {
  const at = (k: string) => ({ a192: "public/icons/icon-192.png", a512: "public/icons/icon-512.png", mask: "public/icons/icon-512-maskable.png", mono: "public/icons/icon-monochrome.png" })[k] ?? "";
  const text = manifestText("next-app", "Mianovia", "#0c0c10", at as never, "public");
  const m = parseManifest("src/app/manifest.ts", text);
  assert.deepEqual([m.name, m.shortName, m.theme, m.background, m.display], ["Mianovia", "Mianovia", "#0c0c10", "#0c0c10", "standalone"]);
  assert.deepEqual(m.icons.map((i) => [i.src, i.sizes, i.purpose]), [
    ["/icons/icon-192.png", "192x192", "any"],
    ["/icons/icon-512.png", "512x512", "any"],
    ["/icons/icon-512-maskable.png", "512x512", "maskable"],
    ["/icons/icon-monochrome.png", "512x512", "monochrome"],
  ]);
});

test("PLA-126 #2 unquoted keys still read; a constant stands for a value set in code; shortcut icons do not count", () => {
  const text = `export default function manifest() { return { name: 'Tienda', short_name: "T", theme_color: THEME, display: "standalone", icons: [{ src: "/i/192.png", sizes: "192x192" }], shortcuts: [{ name: "x", icons: [{ src: "/s.png", sizes: "96x96" }] }] }; }`;
  const m = parseManifest("app/manifest.ts", text);
  assert.deepEqual([m.name, m.shortName, m.theme, m.display], ["Tienda", "T", "THEME", "standalone"]);
  assert.deepEqual(m.icons.map((i) => [i.src, i.purpose]), [["/i/192.png", "any"]]);
});
