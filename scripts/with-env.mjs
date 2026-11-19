#!/usr/bin/env node
// PLA-I2-4: `node scripts/with-env.mjs NAME=value ... command args...` sets the leading NAME=value pairs and runs the
// command, so a package.json script needs no POSIX `VAR=value` prefix and starts the same from sh, zsh, cmd and
// PowerShell. Plain JavaScript (no tsx) so it runs before anything is compiled.
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const env = { ...process.env };
while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) {
  const pair = args.shift();
  const eq = pair.indexOf("=");
  env[pair.slice(0, eq)] = pair.slice(eq + 1);
}
if (!args.length) {
  console.error("usage: node scripts/with-env.mjs NAME=value ... command [args...]");
  process.exit(2);
}

// On Windows the package bins (tsx, vite) are .cmd shims, which only a shell starts: one command line, each argument
// quoted the way a Windows program reads its argv. Elsewhere, no shell at all.
const quote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`);
const child =
  process.platform === "win32"
    ? spawn(args.map(quote).join(" "), { env, stdio: "inherit", shell: true })
    : spawn(args[0], args.slice(1), { env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("error", (err) => {
  console.error(`${args[0]}: ${err.message}`);
  process.exit(127);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
