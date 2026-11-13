// `pnpm dev:api`: the dev API on 3738 under tsx watch, with background jobs off.
// A launcher instead of `PLANIA_JOBS=0 tsx …` in package.json, because that syntax only works in a POSIX shell.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const tsx = fileURLToPath(import.meta.resolve("tsx/cli"));
const child = spawn(process.execPath, [tsx, "watch", "--env-file=.env", "scripts/dev.ts", "--port", "3738", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, PLANIA_JOBS: "0" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
