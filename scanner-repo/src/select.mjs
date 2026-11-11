// PLA-I38-3: decide which open pull requests still need a plania-scan status.
// Descriptions posted on the head commit are counts only.

export const STATUS_CONTEXT = "plania-scan";
export const STALE_PENDING_MS = 15 * 60 * 1000;

export const TARGET_REPOS = [
  { owner: "Jorg3L3on", repo: "filmia" },
  { owner: "Jorg3L3on", repo: "micasa" },
  { owner: "Jorg3L3on", repo: "zigzag" },
  { owner: "Jorg3L3on", repo: "workia" },
];

const SHA = /^[0-9a-f]{40}$/i;

export function pullTarget(owner, repo, pull) {
  if (!pull || typeof pull !== "object") return null;
  if (!Number.isInteger(pull.number) || pull.number < 1) return null;
  const head = pull.head && typeof pull.head === "object" ? pull.head : null;
  const base = pull.base && typeof pull.base === "object" ? pull.base : null;
  const headSha = head && typeof head.sha === "string" ? head.sha : "";
  const baseRef = base && typeof base.ref === "string" ? base.ref : "";
  const baseSha = base && typeof base.sha === "string" ? base.sha : null;
  if (!SHA.test(headSha) || !baseRef) return null;
  return { owner, repo, number: pull.number, headSha, baseRef, baseSha };
}

export function latestForContext(statuses, context = STATUS_CONTEXT) {
  if (!Array.isArray(statuses)) return null;
  let best = null;
  let bestAt = -1;
  for (const row of statuses) {
    if (!row || typeof row !== "object" || row.context !== context) continue;
    const stamp = Date.parse(row.updated_at || row.created_at || "");
    const at = Number.isFinite(stamp) ? stamp : 0;
    if (!best || at >= bestAt) {
      best = row;
      bestAt = at;
    }
  }
  return best;
}

/** True when this head has no settled plania-scan status. A fresh pending status is left alone. */
export function needsScan(status, nowMs, staleMs = STALE_PENDING_MS) {
  if (!status) return true;
  if (status.state === "success" || status.state === "failure" || status.state === "error") return false;
  if (status.state === "pending") {
    const stamp = Date.parse(status.updated_at || status.created_at || "");
    if (!Number.isFinite(stamp)) return true;
    return nowMs - stamp > staleMs;
  }
  return true;
}

export function unmarkedTargets(pulls, statusesBySha, nowMs, staleMs = STALE_PENDING_MS) {
  const out = [];
  for (const pull of pulls) {
    const statuses = statusesBySha.get(pull.headSha) ?? [];
    if (needsScan(latestForContext(statuses), nowMs, staleMs)) out.push(pull);
  }
  return out;
}

function countWord(count, word) {
  if (!Number.isInteger(count) || count < 0 || count > 100000) throw new Error("bad count");
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Commit-status body. The description is counts or a fixed phrase, never a matched value. */
export function statusRequest(input) {
  if (!input || typeof input !== "object") throw new Error("bad status");
  if (input.phase === "pending") {
    return { state: "pending", context: STATUS_CONTEXT, description: "scan started" };
  }
  if (input.phase !== "result") throw new Error("bad status");
  if (input.error) {
    return { state: "failure", context: STATUS_CONTEXT, description: "scan did not finish" };
  }
  const description = `${countWord(input.findingCount, "finding")}, ${countWord(input.ruleCount, "rule")}`;
  if (description.length > 140) throw new Error("description too long");
  const state = input.findingCount === 0 ? "success" : "failure";
  return { state, context: STATUS_CONTEXT, description };
}

export function resultFromFindings(findings, error) {
  if (error) return { phase: "result", error: true, findingCount: 0, ruleCount: 0 };
  const rules = new Set();
  for (const finding of findings ?? []) {
    if (finding && typeof finding.rule === "string") rules.add(finding.rule);
  }
  return { phase: "result", error: false, findingCount: (findings ?? []).length, ruleCount: rules.size };
}
