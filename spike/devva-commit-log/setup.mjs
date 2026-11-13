// Prepare the spike on a fresh clone: copy the devva client build and generate the engine token.
//   node spike/devva-commit-log/setup.mjs [path to a built devva TypeScript client]
// The client is not committed. By default it is copied from the devva-eval checkout beside this repo's parent.
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const source = path.resolve(process.argv[2] ?? path.join(here, "..", "..", "..", "..", "xyz", "devva-eval", "app", "vendor", "xyzdb"));
const target = path.join(here, "vendor", "xyzdb");

if (!existsSync(path.join(source, "dist", "src", "index.js"))) {
  console.error(`No built client at ${source}. Pass the path of one that has dist/src/index.js.`);
  process.exit(1);
}
mkdirSync(path.join(target, "dist"), { recursive: true });
cpSync(path.join(source, "dist", "src"), path.join(target, "dist", "src"), { recursive: true });
for (const f of ["package.json", "LICENSE"]) if (existsSync(path.join(source, f))) cpSync(path.join(source, f), path.join(target, f));
console.log(`client copied from ${source}`);

const token = path.join(here, ".token");
if (existsSync(token)) console.log("token kept");
else {
  writeFileSync(token, randomBytes(24).toString("hex"));
  console.log("token generated");
}
