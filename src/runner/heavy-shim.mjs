#!/usr/bin/env node
// PLA-I73-5: the heavy-work queue. Taller runs get this in front of npm, npx, pnpm and yarn on their PATH. A heavy
// command (test suites, type check, build, browser tests) waits for one of PLANIA_HEAVY_SLOTS slots shared by every
// run on this machine, so several agents can think at once while the Mac runs only as many heavy jobs as its memory
// holds (guided test 3: 8 GB, 5.5 GB of swap, typecheck 4 minutes, tests timing out). Everything else, dev servers
// and installs included, runs at once. Plain JS: it runs before any build step.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const [tool, ...args] = process.argv.slice(2);
const dir = process.env.PLANIA_HEAVY_DIR;
const slots = Math.max(1, Number(process.env.PLANIA_HEAVY_SLOTS) || 1);
const shimBin = process.env.PLANIA_HEAVY_BIN;

const HEAVY_SCRIPT = /^(test|tests|test:.*|typecheck|type-check|tsc|build|lint|check|check:.*|e2e|e2e:.*|verify|ci)$/;
const HEAVY_BIN = /^(tsc|vitest|jest|playwright|eslint|mocha|ava|cypress|next|vite|tsx)$/;
export function isHeavy(tool, args) {
  const a = args.filter((x) => !x.startsWith("-"));
  if (tool === "npx" || (["npm", "pnpm", "yarn"].includes(tool) && (a[0] === "exec" || a[0] === "dlx"))) {
    const bin = tool === "npx" ? a[0] : a[1];
    const rest = tool === "npx" ? a.slice(1) : a.slice(2);
    if (!bin || !HEAVY_BIN.test(bin)) return false;
    if (bin === "next" || bin === "vite") return rest[0] === "build";
    if (bin === "tsx") return false;
    return true;
  }
  if (["npm", "pnpm", "yarn"].includes(tool)) {
    if (a[0] === "test" || a[0] === "t") return true;
    const script = a[0] === "run" || a[0] === "run-script" ? a[1] : tool === "npm" ? null : a[0];
    return !!script && HEAVY_SCRIPT.test(script);
  }
  return false;
}

function realBinary(name) {
  for (const d of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!d || (shimBin && path.resolve(d) === path.resolve(shimBin))) continue;
    const p = path.join(d, name);
    if (existsSync(p)) return p;
  }
  return name;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function acquire() {
  mkdirSync(dir, { recursive: true });
  let told = false;
  for (;;) {
    for (let i = 1; i <= slots; i++) {
      const slot = path.join(dir, `slot-${i}`);
      try {
        mkdirSync(slot);
        writeFileSync(path.join(slot, "pid"), String(process.pid));
        return slot;
      } catch {
        // Taken: free it if its holder died or it is older than a day.
        try {
          const pid = Number(readFileSync(path.join(slot, "pid"), "utf8"));
          const old = Date.now() - statSync(slot).mtimeMs > 24 * 3600_000;
          if ((pid && !alive(pid)) || old) rmSync(slot, { recursive: true, force: true });
        } catch {
          /* raced with its release */
        }
      }
    }
    if (!told) {
      process.stderr.write(`[plania] waiting for a heavy-work slot (${slots} on this machine)…\n`);
      told = true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  const heavy = !!dir && isHeavy(tool, args);
  const slot = heavy ? await acquire() : null;
  const release = () => slot && rmSync(slot, { recursive: true, force: true });
  const child = spawn(realBinary(tool), args, { stdio: "inherit" });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => {
    release();
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
  child.on("error", (e) => {
    release();
    process.stderr.write(`[plania] ${tool}: ${e.message}\n`);
    process.exit(127);
  });
}

// Run only as the wrapper's program, never when a test imports isHeavy.
const direct = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (direct && tool) await main();
