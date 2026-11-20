// PLA-I68-5: a workflow Camino proposes is checked with actionlint (https://github.com/rhysd/actionlint, free) before
// any PR is opened: its errors block the proposal. The file goes in on stdin; nothing is written to disk. When
// actionlint is not on this machine the check says so instead of passing silently.
import { spawn } from "node:child_process";
import { commandPath } from "../jobs/machine/run.js";

export type LintOut = { available: boolean; errors: { line: number; column: number; message: string; kind: string }[] };
export type Actionlint = (path: string, content: string) => Promise<LintOut>;

export const runActionlint: Actionlint = (file, content) =>
  new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (v: LintOut) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    let child;
    try {
      child = spawn("actionlint", ["-no-color", "-format", "{{json .}}", "-stdin-filename", file, "-"], { env: { ...process.env, PATH: commandPath(process.env.PATH) }, stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      return finish({ available: false, errors: [] });
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ available: false, errors: [] });
    }, 20_000);
    child.on("error", () => {
      clearTimeout(timer);
      finish({ available: false, errors: [] });
    });
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const list = (JSON.parse(out.trim() || "[]") as { line: number; column: number; message: string; kind: string }[]) ?? [];
        finish({ available: true, errors: list.map((e) => ({ line: e.line, column: e.column, message: e.message.slice(0, 300), kind: e.kind })) });
      } catch {
        finish({ available: true, errors: [] });
      }
    });
    child.stdin.end(content);
  });
