// PLA-I2-17: Plania as a service (src/packaging/service.ts).
//   pnpm service:install                 launchd agent on macOS, systemd user unit on Linux, a Scheduled Task at
//                                        logon on Windows (PLA-I2-19); starts it now
//   pnpm service:install --at-boot       Linux: also start before anyone logs in (loginctl enable-linger)
//   pnpm service:install --port 3737     another port
//   pnpm service:uninstall               stop it and remove the agent or unit; data and logs stay
// Run it from the package (or checkout) the service should run, after the install wrote .env.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { applyPlan, detectSystem, installPlan, servicePath, uninstallPlan, type ServiceEnv } from "../src/packaging/service.js";

const { values, positionals } = parseArgs({
  options: { "at-boot": { type: "boolean", default: false }, port: { type: "string", default: "3737" } },
  allowPositionals: true,
  strict: true,
});
const action = positionals[0];
if (action !== "install" && action !== "uninstall") {
  console.error("Uso: pnpm service:install | pnpm service:uninstall");
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, "..");
const env: ServiceEnv = {
  platform: process.platform,
  home: homedir(),
  uid: userInfo().uid,
  root,
  node: process.execPath,
  path: servicePath(process.env.PATH ?? "", path.delimiter),
  port: Number(values.port),
  ...detectSystem(),
  // Windows (PLA-I2-19): the task runs as this user; its log goes under %LOCALAPPDATA%.
  localAppData: process.env.LOCALAPPDATA,
  user: process.env.USERNAME ? [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join("\\") : undefined,
  systemRoot: process.env.SystemRoot,
};

if (action === "install" && !existsSync(path.join(root, ".env"))) {
  console.error("Falta el archivo de ajustes (.env): corre primero pnpm plania:install.");
  process.exit(1);
}
const plan = action === "install" ? installPlan(env, { atBoot: values["at-boot"] }) : uninstallPlan(env);
try {
  applyPlan(plan, {
    mkdir: (d) => mkdirSync(d, { recursive: true }),
    write: (f, c, encoding) => writeFileSync(f, c, { encoding: encoding ?? "utf8" }),
    remove: (f) => rmSync(f, { force: true }),
    run: (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: root }),
  });
} catch (e) {
  console.error(`No se pudo terminar: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
for (const line of plan.lines) console.log(line);
if (plan.platform === "wsl-no-systemd" || plan.platform === "unsupported") process.exit(1);
