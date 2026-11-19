// PLA-I2-17: pnpm notices — writes THIRD_PARTY_NOTICES at the repo root from the production dependencies' licences
// (src/packaging/notices.ts). Run it after a dependency changes; `pnpm release:pack` also writes one into the package.
//   pnpm notices            write the file
//   pnpm notices --check    exit 1 when the committed file is not what the dependencies say
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { collectNotices, renderNotices } from "../src/packaging/notices.js";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } }, strict: true });
const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, "THIRD_PARTY_NOTICES");
const notices = collectNotices(root);
const text = renderNotices(notices);
if (values.check) {
  const same = existsSync(file) && readFileSync(file, "utf8").replace(/\r\n/g, "\n") === text;
  console.log(same ? "THIRD_PARTY_NOTICES is current." : "THIRD_PARTY_NOTICES is out of date: run pnpm notices.");
  process.exit(same ? 0 : 1);
}
writeFileSync(file, text);
const unknown = notices.filter((n) => n.license === "UNKNOWN").map((n) => n.name);
console.log(`THIRD_PARTY_NOTICES: ${notices.length} packages${unknown.length ? `; no licence declared: ${unknown.join(", ")}` : ""}.`);
