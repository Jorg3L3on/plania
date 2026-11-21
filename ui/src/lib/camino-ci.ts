// PLA-I68-5: Camino's «Pruebas (CI)». The repo's .github/workflows/*.yml files are the source; this is a view that edits
// them carefully. Every edit goes through the yaml Document API (comments and untouched lines stay as they were) and
// becomes a PR in the change set, validated with actionlint before it is proposed (server side). Pure: the screen and
// the tests use it (test/i68-5-pruebas.test.ts).
//   readWorkflow   a workflow's triggers, permissions, concurrency, secrets, jobs (timeouts, matrix) and steps
//   warnings       what is risky in it, each with an edit that fixes it
//   edits          pin actions, add timeouts, cancel old runs, read-only permissions, step pause/remove/reorder/add…
//   newWorkflow    a workflow from the project's own scripts with the good defaults and a ci-ok job that waits for
//                  all others (a rule then requires one name that never changes)
//   dependabotYml  the dependency bot's file, and the patch auto-merge workflow
import { isMap, isScalar, isSeq, parseDocument, Pair, Scalar, YAMLMap, YAMLSeq, type Document } from "yaml";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

const TO_STRING = { flowCollectionPadding: false, lineWidth: 0 } as const;
export type Step = { i: number; name: string | null; uses: string | null; run: string | null; off: boolean; cont: boolean };
export type Job = { id: string; name: string; timeout: number | null; matrix: string[] | null; cont: boolean; needs: string[]; steps: Step[]; env: string | null; ok: boolean };
export type Workflow = {
  path: string;
  name: string;
  on: { pr: string[] | "*" | null; push: string[] | "*" | null; dispatch: boolean; schedule: string[]; paths: boolean; branchFilter: boolean };
  permissions: "read" | "none" | "write" | "custom" | "unset";
  cancels: boolean;
  secrets: string[];
  actions: { uses: string; pinned: boolean }[];
  jobs: Job[];
  /** The check names GitHub reports for its jobs (a matrix adds « (value)»). */
  checkNames: string[];
  error: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : typeof v === "string" ? [v] : []);

export const SHA_PIN = /@[0-9a-f]{40}$/;
// A paused step's condition: an event that never happens. actionlint refuses a constant «false»; this it accepts, and
// it reads as what it is.
const PAUSED = "camino-paused";
const PAUSE_NOTE_MARK = "Paused from Plania (Camino)";
export const PAUSE_IF = "${{ github.event_name == '" + PAUSED + "' }}";

/** The check name GitHub reports for one value of a job's matrix: the value replaces an expression in the name, or is added in parentheses. */
const matrixName = (name: string, v: string): string => (/\$\{\{/.test(name) ? name.replace(/\$\{\{[^}]*\}\}/g, v).trim() : name + " (" + v + ")");

export function readWorkflow(path: string, text: string): Workflow {
  const doc = parseDocument(text);
  const empty: Workflow = { path, name: path, on: { pr: null, push: null, dispatch: false, schedule: [], paths: false, branchFilter: false }, permissions: "unset", cancels: false, secrets: [], actions: [], jobs: [], checkNames: [], error: null };
  if (doc.errors.length) return { ...empty, error: doc.errors[0]!.message.split("\n")[0]! };
  const js = (doc.toJS() ?? {}) as Record<string, any>;
  const on = js.on ?? js.true ?? {};
  const trig = (k: string): string[] | "*" | null => {
    if (typeof on === "string") return on === k ? "*" : null;
    if (Array.isArray(on)) return on.includes(k) ? "*" : null;
    if (!(k in on)) return null;
    const b = on[k]?.branches;
    return b ? arr(b) : "*";
  };
  const perms = js.permissions;
  const permissions: Workflow["permissions"] =
    perms === undefined ? "unset" : perms === "read-all" ? "read" : perms === "write-all" ? "write" : perms && typeof perms === "object" ? (Object.keys(perms).length === 0 ? "none" : Object.values(perms).every((v) => v === "read" || v === "none") ? "read" : "custom") : "custom";
  const jobs: Job[] = Object.entries((js.jobs ?? {}) as Record<string, any>).map(([id, j]) => {
    const m = j?.strategy?.matrix;
    const mk = m && typeof m === "object" ? Object.keys(m).find((k) => k !== "include" && k !== "exclude") : null;
    return {
      id,
      name: str(j?.name) ?? id,
      timeout: typeof j?.["timeout-minutes"] === "number" ? j["timeout-minutes"] : null,
      matrix: mk ? arr(m[mk]) : null,
      cont: j?.["continue-on-error"] === true,
      needs: arr(j?.needs),
      env: str(j?.environment) ?? str(j?.environment?.name),
      ok: id === "ci-ok",
      steps: ((j?.steps ?? []) as any[]).map((s, i) => ({ i, name: str(s?.name), uses: str(s?.uses), run: str(s?.run), off: s?.if === false || s?.if === "${{ false }}" || s?.if === "false" || String(s?.if ?? "").includes(PAUSED), cont: s?.["continue-on-error"] === true })),
    };
  });
  const uses = jobs.flatMap((j) => j.steps.map((s) => s.uses).filter((u): u is string => !!u && !u.startsWith("./") && !u.startsWith("docker://")));
  const prOn = typeof on === "object" && !Array.isArray(on) ? on.pull_request ?? on.pull_request_target : null;
  return {
    path,
    name: str(js.name) ?? path.split("/").pop()!,
    on: {
      pr: trig("pull_request") ?? trig("pull_request_target"),
      push: trig("push"),
      dispatch: trig("workflow_dispatch") !== null,
      schedule: typeof on === "object" && !Array.isArray(on) && Array.isArray(on.schedule) ? on.schedule.map((x: any) => String(x?.cron ?? "")) : [],
      paths: !!(prOn && (prOn.paths || prOn["paths-ignore"])),
      branchFilter: !!(prOn && (prOn.branches || prOn["branches-ignore"])),
    },
    permissions,
    cancels: js.concurrency?.["cancel-in-progress"] === true || /cancel-in-progress:\s*true/.test(text),
    secrets: [...new Set([...text.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!).filter((n) => n !== "GITHUB_TOKEN"))],
    actions: [...new Set(uses)].map((u) => ({ uses: u, pinned: SHA_PIN.test(u.replace(/\s.*$/, "")) })),
    jobs,
    checkNames: jobs.flatMap((j) => (j.matrix ? j.matrix.map((v) => matrixName(j.name, v)) : [j.name])),
    error: null,
  };
}

// ---- edits (each returns the new text; untouched lines stay as they were)
type Edit = (doc: Document.Parsed) => void;
function edit(text: string, fn: Edit): string {
  const doc = parseDocument(text);
  fn(doc);
  return doc.toString(TO_STRING);
}
const mapAt = (doc: Document.Parsed, path: (string | number)[]): YAMLMap | null => {
  const n = path.length ? doc.getIn(path, true) : doc.contents;
  return isMap(n) ? (n as YAMLMap) : null;
};
/** Puts key: value in a map before the first of the «before» keys it has (or after an «after» key), else at the end. */
function place(doc: Document.Parsed, map: YAMLMap, key: string, value: unknown, where: { before?: string[]; after?: string[] }) {
  const existing = map.items.findIndex((p) => isScalar(p.key) && p.key.value === key);
  const node = doc.createNode(value);
  if (existing >= 0) {
    map.items[existing]!.value = node;
    return;
  }
  const pair = new Pair(new Scalar(key), node);
  const idx = (keys: string[] | undefined, off: number) => {
    for (const k of keys ?? []) {
      const i = map.items.findIndex((p) => isScalar(p.key) && p.key.value === k);
      if (i >= 0) return i + off;
    }
    return -1;
  };
  let at = idx(where.before, 0);
  if (at < 0) at = idx(where.after, 1);
  if (at < 0) map.items.push(pair);
  else map.items.splice(at, 0, pair);
}
const stepsOf = (doc: Document.Parsed, job: string): YAMLSeq | null => {
  const n = doc.getIn(["jobs", job, "steps"], true);
  return isSeq(n) ? (n as YAMLSeq) : null;
};

export const edits = {
  readPermissions: (t: string) => edit(t, (d) => place(d, d.contents as YAMLMap, "permissions", { contents: "read" }, { before: ["concurrency", "env", "defaults", "jobs"] })),
  cancelOld: (t: string) =>
    edit(t, (d) => place(d, d.contents as YAMLMap, "concurrency", { group: "${{ github.workflow }}-${{ github.ref }}", "cancel-in-progress": true }, { before: ["env", "defaults", "jobs"] })),
  timeouts: (t: string, minutes = 20) =>
    edit(t, (d) => {
      const jobs = mapAt(d, ["jobs"]);
      for (const p of jobs?.items ?? []) {
        const j = p.value;
        if (isMap(j) && !(j as YAMLMap).has("timeout-minutes") && !(j as YAMLMap).has("uses")) place(d, j as YAMLMap, "timeout-minutes", minutes, { after: ["runs-on", "needs", "name"] });
      }
    }),
  noContinue: (t: string) =>
    edit(t, (d) => {
      for (const p of mapAt(d, ["jobs"])?.items ?? []) {
        const j = p.value as YAMLMap;
        if (!isMap(j)) continue;
        j.delete("continue-on-error");
        const steps = j.get("steps", true);
        if (isSeq(steps)) for (const s of (steps as YAMLSeq).items) if (isMap(s)) (s as YAMLMap).delete("continue-on-error");
      }
    }),
  noPathFilters: (t: string) =>
    edit(t, (d) => {
      for (const k of ["pull_request", "pull_request_target"]) {
        const m = mapAt(d, ["on", k]);
        m?.delete("paths");
        m?.delete("paths-ignore");
      }
    }),
  noSchedule: (t: string) => edit(t, (d) => mapAt(d, ["on"])?.delete("schedule")),
  environment: (t: string, job: string, env = "production") => edit(t, (d) => mapAt(d, ["jobs", job]) && place(d, mapAt(d, ["jobs", job])!, "environment", env, { after: ["runs-on", "needs", "name"] })),
  /** Pins every listed action to its commit, keeping the tag as a comment. shas: "owner/repo@tag" → 40-hex sha. */
  pin: (t: string, shas: Record<string, string>) =>
    edit(t, (d) => {
      for (const p of mapAt(d, ["jobs"])?.items ?? []) {
        const steps = isMap(p.value) ? (p.value as YAMLMap).get("steps", true) : null;
        if (!isSeq(steps)) continue;
        for (const s of (steps as YAMLSeq).items) {
          if (!isMap(s)) continue;
          const u = (s as YAMLMap).get("uses", true);
          if (!isScalar(u) || typeof u.value !== "string") continue;
          const sha = shas[u.value];
          if (!sha) continue;
          const tag = u.value.split("@")[1];
          const old = u.comment?.trim();
          u.value = `${u.value.split("@")[0]}@${sha}`;
          u.comment = " " + tag + (old && old !== tag ? " · " + old : "");
        }
      }
    }),
  /** Adds a ci-ok job that needs every other job and fails when any did; the one name a rule should require. */
  okJob: (t: string) =>
    edit(t, (d) => {
      const jobs = mapAt(d, ["jobs"]);
      if (!jobs || jobs.has("ci-ok")) return;
      const others = jobs.items.map((p) => String((p.key as Scalar).value));
      place(d, jobs, "ci-ok", {
        name: "ci-ok",
        if: "${{ always() }}",
        needs: others,
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 2,
        steps: [{ name: "Every job passed", run: "test \"${{ !contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled') }}\" = true" }],
      }, {});
    }),
  stepPause: (t: string, job: string, i: number) =>
    edit(t, (d) => {
      const s = stepsOf(d, job)?.items[i];
      if (!isMap(s)) return;
      const m = s as YAMLMap;
      const cur = m.get("if");
      if (cur !== undefined && (String(cur).includes(PAUSED) || cur === false || cur === "${{ false }}")) {
        m.delete("if");
        if (String(m.commentBefore ?? "").includes(PAUSE_NOTE_MARK)) m.commentBefore = null;
      } else if (cur === undefined) {
        place(d, m, "if", PAUSE_IF, { before: ["uses", "run", "with", "env"] });
        // PLA-I70-42: the file says why this step never runs.
        m.commentBefore = ` ${PAUSE_NOTE_MARK}: the 'if' below never holds, so the step does not run. Delete that line to run it again.`;
      }
    }),
  stepRemove: (t: string, job: string, i: number) => edit(t, (d) => void stepsOf(d, job)?.items.splice(i, 1)),
  stepMove: (t: string, job: string, i: number, dir: -1 | 1) =>
    edit(t, (d) => {
      const s = stepsOf(d, job);
      const j = i + dir;
      if (!s || j < 0 || j >= s.items.length) return;
      [s.items[i], s.items[j]] = [s.items[j]!, s.items[i]!];
    }),
  stepAdd: (t: string, job: string, command: string) => edit(t, (d) => void stepsOf(d, job)?.items.push(d.createNode({ run: command }))),
};

/** The scripts a CI step may run: not ones that start servers, deploy, publish or touch a real database. */
export const UNSAFE_SCRIPT = /^(dev|start|serve|preview|deploy|release|publish|db:(migrate|push|seed|reset)|migrate|seed)(:|$)|deploy|publish|migrate(?!:check)/;
export const runOf = (pm: "npm" | "pnpm" | "yarn", script: string) => (pm === "npm" ? `npm run ${script}` : `${pm} ${script}`);

export function newWorkflow(scripts: string[], pm: "npm" | "pnpm" | "yarn", branches: string[]): string {
  const pick = ["lint", "typecheck", "test", "test:db", "build"].filter((s) => scripts.includes(s));
  const install = pm === "pnpm" ? "pnpm install --frozen-lockfile" : pm === "yarn" ? "yarn install --frozen-lockfile" : "npm ci";
  const lines = [
    "name: CI",
    "",
    "# Proposed by Plania (Camino › Tests) with the project's own scripts.",
    "on:",
    "  pull_request:",
    `    branches: [${branches.join(", ")}]`,
    "",
    "permissions:",
    "  contents: read",
    "",
    "concurrency:",
    "  group: ${{ github.workflow }}-${{ github.ref }}",
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  check:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 20",
    "    steps:",
    "      - uses: actions/checkout@v4",
    ...(pm === "pnpm" ? ["      - uses: pnpm/action-setup@v4"] : []),
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    `      - run: ${install}`,
    ...pick.map((s) => `      - run: ${runOf(pm, s)}`),
    "",
    "  ci-ok:",
    "    name: ci-ok",
    "    if: ${{ always() }}",
    "    needs: [check]",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 2",
    "    steps:",
    "      - name: Every job passed",
    "        run: test \"${{ !contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled') }}\" = true",
    "",
  ];
  return lines.join("\n");
}

export type WarnId = "permissions" | "unpinned" | "timeout" | "cancel" | "continue" | "paths" | "matrix" | "secret" | "schedule";
export type Warn = { id: WarnId; text: string; detail: string; fix: { label: string; kind: "edit" | "pin" | "ok-job" | "env" } | null };
const PROD_SECRET = /^(PROD|PRODUCTION)_|DATABASE_URL$|^DIRECT_URL$|_DB_URL$|^DB_PASSWORD$|^PG(PASSWORD|URL)$/;

/** What is risky in a workflow, given the checks a rule requires and how quiet the repo is. */
export function warnings(wf: Workflow, ctx: { required: string[]; publicRepo: boolean; quietDays: number | null }, language: Language = getLanguage()): Warn[] {
  const w = words(CI_WORDS, language).warn;
  const out: Warn[] = [];
  if (wf.error) return out;
  const runsOnPr = wf.on.pr !== null;
  const requiredHere = wf.jobs.filter((j) => ctx.required.some((r) => r === j.name || r.startsWith(j.name + " (")));
  if (wf.permissions === "unset" || wf.permissions === "write") out.push({ id: "permissions", text: w.permissions.text, detail: wf.permissions === "write" ? w.permissions.detailWrite : w.permissions.detail, fix: { label: w.fixes.permissions, kind: "edit" } });
  const loose = wf.actions.filter((a) => !a.pinned);
  if (loose.length) out.push({ id: "unpinned", text: w.unpinned.text, detail: w.unpinned.detail(loose.map((a) => a.uses).join(", ")), fix: { label: w.fixes.pin, kind: "pin" } });
  if (wf.jobs.some((j) => j.timeout === null) && (runsOnPr || wf.on.push)) out.push({ id: "timeout", ...w.timeout, fix: { label: w.fixes.timeout, kind: "edit" } });
  if (runsOnPr && !wf.cancels) out.push({ id: "cancel", ...w.cancel, fix: { label: w.fixes.cancel, kind: "edit" } });
  const contJobs = requiredHere.filter((j) => j.cont || j.steps.some((s) => s.cont));
  if (contJobs.length || (!ctx.required.length && wf.jobs.some((j) => j.cont || j.steps.some((s) => s.cont)))) out.push({ id: "continue", ...w.continue, fix: { label: w.fixes.continue, kind: "edit" } });
  if (requiredHere.length && wf.on.paths) out.push({ id: "paths", ...w.paths, fix: { label: w.fixes.paths, kind: "edit" } });
  const matrixReq = wf.jobs.some((j) => j.matrix && ctx.required.includes(j.name));
  if (matrixReq || (wf.jobs.some((j) => j.matrix) && !wf.jobs.some((j) => j.ok) && runsOnPr)) out.push({ id: "matrix", ...w.matrix, fix: wf.jobs.some((j) => j.ok) ? null : { label: w.fixes.okJob, kind: "ok-job" } });
  const prod = wf.secrets.filter((s) => PROD_SECRET.test(s));
  const unprotected = prod.length && wf.jobs.some((j) => !j.env);
  if (unprotected) out.push({ id: "secret", text: w.secret.text, detail: w.secret.detail(prod.join(", ")), fix: { label: w.fixes.env, kind: "env" } });
  if (wf.on.schedule.length && ctx.publicRepo && (ctx.quietDays ?? 0) >= 45) out.push({ id: "schedule", ...w.schedule, fix: { label: w.fixes.schedule, kind: "edit" } });
  return out;
}

/** The edit a warning's fix makes (pin and env need more: the shas, the job). */
export function fixEdit(id: WarnId, text: string, wf: Workflow, shas: Record<string, string> = {}): string {
  switch (id) {
    case "permissions":
      return edits.readPermissions(text);
    case "unpinned":
      return edits.pin(text, shas);
    case "timeout":
      return edits.timeouts(text);
    case "cancel":
      return edits.cancelOld(text);
    case "continue":
      return edits.noContinue(text);
    case "paths":
      return edits.noPathFilters(text);
    case "matrix":
      return edits.okJob(text);
    case "secret":
      return wf.jobs.filter((j) => !j.env && j.steps.some(() => true)).reduce((t, j) => (/secrets\./.test(t) ? edits.environment(t, j.id) : t), text);
    case "schedule":
      return edits.noSchedule(text);
  }
}

// ---- runs
export type RunRow = { id: number; name: string; branch: string; event: string; conclusion: string | null; status: string; head_sha: string; created_at: string; updated_at: string; url: string; workflow_id: number | null };
/** Flaky: the same workflow passed and failed on the same commit. */
export function flaky(runs: RunRow[]): Set<number> {
  const keyOf = (r: RunRow) => String(r.workflow_id ?? r.name) + ":" + r.head_sha;
  const by = new Map<string, Set<string>>();
  for (const r of runs) by.set(keyOf(r), (by.get(keyOf(r)) ?? new Set<string>()).add(r.conclusion ?? ""));
  return new Set(runs.filter((r) => by.get(keyOf(r))!.has("success") && by.get(keyOf(r))!.has("failure")).map((r) => r.id));
}
export const minutesOf = (runs: RunRow[]): number => Math.round(runs.reduce((a, r) => a + Math.max(0, new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()), 0) / 60000);

// ---- the dependency bot
export type DepsForm = { on: boolean; interval: "daily" | "weekly" | "monthly"; target: string | null; group: boolean; auto_patch: boolean };
export function dependabotYml(f: DepsForm, ecosystems: string[]): string {
  const lines = ["# Proposed by Plania (Camino › Tests › Updates).", "version: 2", "updates:"];
  for (const eco of ecosystems) {
    lines.push("  - package-ecosystem: " + eco, '    directory: "/"', "    schedule:", "      interval: " + f.interval);
    if (f.target) lines.push("    target-branch: " + f.target);
    if (f.group && eco !== "github-actions") lines.push("    groups:", "      minor-and-patch:", "        update-types: [minor, patch]");
  }
  lines.push("");
  return lines.join("\n");
}
/** Merges patch PRs from the dependency bot once the required checks pass (auto-merge waits for them). No third-party action. */
export const AUTO_PATCH_YML = [
  "name: Dependabot patch auto-merge",
  "",
  "# Proposed by Plania (Camino › Tests › Updates): only patch updates, and only through the repo's required checks.",
  "on: pull_request",
  "",
  "permissions:",
  "  contents: write",
  "  pull-requests: write",
  "",
  "jobs:",
  "  merge:",
  "    if: github.event.pull_request.user.login == 'dependabot[bot]'",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
  "    steps:",
  "      - name: Turn on auto-merge for a patch update",
  "        env:",
  "          TITLE: ${{ github.event.pull_request.title }}",
  "          PR: ${{ github.event.pull_request.html_url }}",
  "          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
  "        run: |",
  "          if printf '%s' \"$TITLE\" | grep -Eq 'from ([0-9]+)\\.([0-9]+)\\.[0-9]+ to \\1\\.\\2\\.[0-9]+'; then",
  "            gh pr merge --auto --squash \"$PR\"",
  "          fi",
  "",
].join("\n");

export const CI_WORDS = defineWords({
  es: {
    warn: {
      permissions: { text: "Puede escribir en el repo sin pedirlo", detail: "Sin «permissions» arriba, el token del flujo puede escribir. Lo seguro es solo leer.", detailWrite: "El flujo pide permiso de escritura en todo el repo («write-all»). Lo seguro es solo leer." },
      unpinned: { text: "Las acciones siguen etiquetas que su autor puede mover", detail: (list: string) => `En 2025 una acción popular movió sus etiquetas a código que robaba secretos. Sin fijar: ${list}.` },
      timeout: { text: "Sin límite de tiempo", detail: "GitHub espera hasta 6 horas a un trabajo trabado." },
      cancel: { text: "Las corridas viejas siguen corriendo", detail: "Cancelar la anterior cuando llega un commit nuevo ahorra minutos." },
      continue: { text: "Un paso puede fallar sin que la prueba falle", detail: "El paso está marcado para seguir aunque falle, y por eso la prueba queda en verde aunque ese paso falle." },
      paths: { text: "Una prueba exigida no corre en todas las propuestas", detail: "Con filtros de archivos, una propuesta que no los toca nunca recibe la prueba y GitHub la espera para siempre." },
      matrix: { text: "Los nombres cambian con cada sistema", detail: "«Build (ubuntu)», «(macos)»… Una regla que exija «Build» nunca coincide. Un trabajo ci-ok que espera a todos da un nombre fijo." },
      secret: { text: "Usa la llave de la base de producción guardada en GitHub", detail: (list: string) => `Cualquier flujo del repo puede leer ${list}. Un entorno protegido de GitHub la limita a este trabajo.` },
      schedule: { text: "GitHub apagará su horario", detail: "En un repo público sin actividad por 60 días, GitHub desactiva los flujos programados." },
      fixes: {
        permissions: "Solo leer",
        pin: "Fijar al commit",
        timeout: "Poner 20 min",
        cancel: "Cancelar viejas",
        continue: "Hacerlo obligatorio",
        paths: "Quitar los filtros",
        okJob: "Agregar ci-ok",
        env: "Usar un entorno protegido",
        schedule: "Quitar el horario",
      },
    },
  },
  en: {
    warn: {
      permissions: { text: "It can write to the repo without asking", detail: "With no top-level «permissions», the workflow's token can write. Read-only is the safe default.", detailWrite: "The workflow asks for write access to the whole repo («write-all»). Read-only is the safe default." },
      unpinned: { text: "Actions follow tags their author can move", detail: (list: string) => `In 2025 a popular action moved its tags to code that stole secrets. Not pinned: ${list}.` },
      timeout: { text: "No time limit", detail: "GitHub waits up to 6 hours for a stuck job." },
      cancel: { text: "Old runs keep running", detail: "Cancelling the previous run when a new commit arrives saves minutes." },
      continue: { text: "A step can fail without failing the check", detail: "continue-on-error keeps the check green even when that step fails." },
      paths: { text: "A required check does not run on every PR", detail: "With file filters, a PR that touches none of them never gets the check, and GitHub waits for it forever." },
      matrix: { text: "Names change with each system", detail: "«Build (ubuntu)», «(macos)»… A rule requiring «Build» never matches. A ci-ok job that waits for all gives one fixed name." },
      secret: { text: "It uses the production database key stored in GitHub", detail: (list: string) => `Any workflow in the repo can read ${list}. A protected GitHub environment limits it to this job.` },
      schedule: { text: "GitHub will turn its schedule off", detail: "On a public repo with no activity for 60 days, GitHub disables scheduled workflows." },
      fixes: {
        permissions: "Read only",
        pin: "Pin to the commit",
        timeout: "Set 20 min",
        cancel: "Cancel old runs",
        continue: "Make it count",
        paths: "Remove the filters",
        okJob: "Add ci-ok",
        env: "Use a protected environment",
        schedule: "Remove the schedule",
      },
    },
  },
});

// ---- what the review must say before a set with workflow changes can apply
/** The required check names a workflow edit would make disappear (a rename or a removal): nothing could merge. */
export function lostRequired(before: string, after: string | null, path: string, required: string[]): string[] {
  const was = readWorkflow(path, before).checkNames;
  const now = after === null ? [] : readWorkflow(path, after).checkNames;
  return required.filter((n) => was.includes(n) && !now.includes(n));
}
/** The required check names a workflow produces (turning it off leaves them waiting forever). */
export const requiredIn = (text: string, path: string, required: string[]): string[] => readWorkflow(path, text).checkNames.filter((n) => required.includes(n));
