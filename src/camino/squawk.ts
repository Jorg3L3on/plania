// PLA-I68-6: squawk (https://squawkhq.com, free) reviews a migration's SQL before a release that carries it. It runs on
// this Mac when it is installed (on PATH, or where pip puts it for the user); otherwise the review says it did not run.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { commandPath } from "../jobs/machine/run.js";

export type SqlIssue = { rule: string; level: string; message: string };
export type SqlReview = (file: string, sql: string) => Promise<{ available: boolean; issues: SqlIssue[] }>;

/** squawk on this Mac: on PATH, or where pip puts it for the user. */
export function squawkPath(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of commandPath(env.PATH).split(path.delimiter)) if (dir && existsSync(path.join(dir, "squawk"))) return path.join(dir, "squawk");
  try {
    const py = path.join(env.HOME || homedir(), "Library", "Python");
    for (const v of readdirSync(py)) if (existsSync(path.join(py, v, "bin", "squawk"))) return path.join(py, v, "bin", "squawk");
  } catch {
    // no user Python folder
  }
  return null;
}

export const runSquawk: SqlReview = (file, sql) =>
  new Promise((resolve) => {
    const bin = squawkPath();
    if (!bin) return resolve({ available: false, issues: [] });
    const dir = mkdtempSync(path.join(tmpdir(), "plania-squawk-"));
    const f = path.join(dir, path.basename(file).replace(/[^A-Za-z0-9._-]/g, "_") || "m.sql");
    writeFileSync(f, sql);
    let out = "";
    const child = spawn(bin, ["--reporter", "json", f], { stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    const done = () => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
    };
    child.on("error", () => {
      done();
      resolve({ available: false, issues: [] });
    });
    child.on("close", () => {
      done();
      try {
        const list = JSON.parse(out.trim() || "[]") as { rule_name: string; level: string; message: string }[];
        resolve({ available: true, issues: list.map((x) => ({ rule: x.rule_name, level: x.level, message: x.message.slice(0, 240) })) });
      } catch {
        resolve({ available: true, issues: [] });
      }
    });
  });
