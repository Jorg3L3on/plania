// PLA-I72: a fake machine shared by the Máquinas copy tests (fictional project «zigzag»). Not a test file.
// Fake git (worktree add/remove make and delete the folder), fake processes that answer on their PORT at once, and a
// fake psql that keeps each database's rows in memory, so a test can see which base a server was started with.
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { PruebaDeps } from "../src/captures/prueba.js";

type Json = Record<string, any>;
export type Child = { pid: number; port: number; env: NodeJS.ProcessEnv; cwd: string; print: (s: string) => void };

export const HEAD = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d";
export const APP_URL = "postgres://zz@localhost:5432/zz_dev";

export function fakeMachine(wtRoot: string) {
  const m = {
    gitCalls: [] as string[][],
    children: [] as Child[],
    killed: [] as number[],
    upPorts: new Set<number>(),
    bases: new Map<string, string[]>(),
    execs: [] as string[],
    failExec: null as RegExp | null,
    nextPid: 12000,
  };
  const nameOf = (url: string | undefined) => (url ? decodeURIComponent(new URL(url).pathname.slice(1)) : "");
  const git = async (args: string[]) => {
    m.gitCalls.push(args);
    if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
    if (args[0] === "worktree" && args[1] === "remove") rmSync(args[3]!, { recursive: true, force: true });
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "HEAD\n", stderr: "" };
    if (args[0] === "rev-parse") return { code: 0, stdout: `${HEAD}\n`, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const spawn: PruebaDeps["spawn"] = (_command, { cwd, env }) => {
    const listeners: Record<string, ((...a: any[]) => void)[]> = {};
    const c = {
      pid: m.nextPid++,
      stdout: { on: (_e: string, f: any) => (listeners.data ??= []).push(f) },
      stderr: { on: () => undefined },
      once: (e: string, f: any) => (listeners[e] ??= []).push(f),
    };
    const port = Number(env.PORT);
    m.children.push({ pid: c.pid, port, env, cwd, print: (s) => listeners.data?.forEach((f) => f(s)) });
    m.upPorts.add(port);
    return c as any;
  };
  const exec: PruebaDeps["exec"] = async (command, opts) => {
    m.execs.push(command);
    if (m.failExec?.test(command)) return { code: 1, stdout: "", stderr: "falló" };
    const e = (opts?.env ?? {}) as Record<string, string>;
    const listQ = /datname in \('([^']+)', '([^']+)'\)/.exec(command);
    if (listQ) return { code: 0, stdout: [listQ[1], listQ[2]].filter((n) => m.bases.has(n!)).join("\n"), stderr: "" };
    const create = /create database ([A-Za-z0-9_]+)/.exec(command);
    if (create) {
      m.bases.set(create[1]!, [...(m.bases.get(nameOf(e.PLANIA_FROM_URL)) ?? [])]);
      return { code: 0, stdout: "", stderr: "" };
    }
    const drop = /drop database if exists ([A-Za-z0-9_]+)/.exec(command);
    if (drop) {
      m.bases.delete(drop[1]!);
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" }; // install, migrate, password commands
  };
  const deps = (over: Partial<PruebaDeps> = {}): PruebaDeps => ({
    git,
    spawn,
    kill: (pid) => void m.killed.push(pid),
    alive: () => false,
    exec,
    up: async (url) => m.upPorts.has(Number(new URL(url).port)),
    portBusy: async () => false,
    env: { ...process.env, PLANIA_WORKTREES_ROOT: wtRoot },
    pollMs: 5,
    readyMs: 2_000,
    stopGraceMs: 10,
    sweep: false,
    signals: false,
    readPg: async () => ({ ok: false }),
    ...over,
  });
  const reset = () => {
    m.gitCalls = [];
    m.children = [];
    m.killed = [];
    m.execs = [];
    m.upPorts = new Set();
    m.failExec = null;
    m.bases = new Map([
      ["zz_dev", ["app-row"]],
      ["zz_dev_prueba", ["inicio-row"]],
    ]);
  };
  reset();
  return { m, git, spawn, exec, deps, reset, nameOf };
}

export const CAPTURE = (repo: string, extra: Json = {}) => ({
  capture: { start_command: "npm run dev -- --port {port}", port: 3200, pages: [{ key: "inicio", path: "/", label: "Inicio" }], database: { env_var: "DATABASE_URL", migrate_command: "npm run db:migrate" }, ...extra },
  local: { repo_path: repo },
});
export const repoOf = (tmp: string) => path.join(tmp, "repos", "zigzag");
