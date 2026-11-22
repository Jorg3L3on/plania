// PLA-I74-9: the production build in the verify list by default. A production build that failed on the host had never
// run before merge. A project whose checkout has a build script gets one more step, «build», with the command the host
// runs: vercel.json's buildCommand, else the vercel-build script, else the build script, through the package manager
// the lockfile names. The owner removes it only with a reason (settings.qa.no_build.reason), which Ajustes shows.
// Everyone that runs the list reads it through verifyListOf: the QA lane, finish (AUDIT-1), readiness.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Project } from "../db/schema.js";
import type { QaSettings } from "./qa-settings.js";

export const BUILD_NAME = "build";
// A production build can be slow; the host's own limit is 45 minutes, ours stays inside the lane's 60.
const BUILD_MINUTES = 20;

export type BuildStep = { name: string; command: string; timeout_minutes: number; source: "vercel.json" | "vercel-build" | "build" };
export type VerifyEntry = { name: string; command: string; timeout_minutes?: number };
export type ReadFile = (file: string) => string | null;

const readText: ReadFile = (file) => {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
};
const json = (text: string | null): Record<string, unknown> | null => {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** The package manager the checkout's lockfile names (npm when none does). */
export function packageManagerOf(dir: string, read: ReadFile = readText): "pnpm" | "yarn" | "bun" | "npm" {
  if (read(path.join(dir, "pnpm-lock.yaml")) !== null) return "pnpm";
  if (read(path.join(dir, "yarn.lock")) !== null) return "yarn";
  if (read(path.join(dir, "bun.lock")) !== null || read(path.join(dir, "bun.lockb")) !== null) return "bun";
  return "npm";
}

/** The build the host runs for this checkout, or null when it has no build script. */
export function hostBuildOf(dir: string | null, read: ReadFile = readText): BuildStep | null {
  if (!dir) return null;
  const pkg = json(read(path.join(dir, "package.json")));
  const scripts = (pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {}) as Record<string, unknown>;
  const vercel = json(read(path.join(dir, "vercel.json")));
  const own = typeof vercel?.buildCommand === "string" ? vercel.buildCommand.trim() : "";
  if (own) return { name: BUILD_NAME, command: own, timeout_minutes: BUILD_MINUTES, source: "vercel.json" };
  const pm = packageManagerOf(dir, read);
  for (const script of ["vercel-build", "build"] as const) {
    if (typeof scripts[script] === "string" && (scripts[script] as string).trim()) return { name: BUILD_NAME, command: `${pm} run ${script}`, timeout_minutes: BUILD_MINUTES, source: script };
  }
  return null;
}

// A step of the owner's list that already builds: named build, or a command that runs the build script or a framework build.
const BUILDS = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:vercel-)?build|next\s+build|vite\s+build|astro\s+build|nuxt\s+build|remix\s+build)\b/;
export const alreadyBuilds = (verify: VerifyEntry[], step: Pick<BuildStep, "command">): boolean =>
  verify.some((v) => v.name.toLowerCase() === BUILD_NAME || v.command.trim() === step.command || BUILDS.test(v.command));

/** Why the owner removed the build step, or null while it is on. */
export const buildOffReason = (qa: QaSettings | undefined): string | null => qa?.no_build?.reason?.trim() || null;

/** The verify list as it runs: the owner's steps, then the host's build unless the list already builds or the owner
 * removed it with a reason. dir is the checkout the list runs in (or the project's repo). */
export function verifyListOf(p: Pick<Project, "settings">, dir: string | null, read: ReadFile = readText): VerifyEntry[] {
  const qa = p.settings?.qa;
  const own: VerifyEntry[] = qa?.verify ?? [];
  if (buildOffReason(qa)) return own;
  const step = hostBuildOf(dir, read);
  if (!step || alreadyBuilds(own, step)) return own;
  return [...own, { name: step.name, command: step.command, timeout_minutes: step.timeout_minutes }];
}

/** What Ajustes shows: the build the host runs, whether the list runs it, and the owner's reason when removed. */
export type BuildRead = { command: string | null; source: BuildStep["source"] | null; on: boolean; in_list: boolean; off_reason: string | null };
export function buildRead(p: Pick<Project, "settings">, dir: string | null, read: ReadFile = readText): BuildRead {
  const step = hostBuildOf(dir, read);
  const off = buildOffReason(p.settings?.qa);
  const own = p.settings?.qa?.verify ?? [];
  return { command: step?.command ?? null, source: step?.source ?? null, on: !!step && !off, in_list: !!step && alreadyBuilds(own, step), off_reason: off };
}
