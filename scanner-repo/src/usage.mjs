// PLA-I38-3: minute estimates. The billing usage endpoint is the bill.
// A workflow run's wall clock is only a cheap stand-in, rounded up per run.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return null;
}

export function monthWindow(now) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return { start, end };
}

export function summarizeBilling(report) {
  const items = report && Array.isArray(report.usageItems) ? report.usageItems : [];
  let actionItems = 0;
  let actionMinutes = 0;
  let actionNet = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const product = String(item.product ?? "").toLowerCase();
    if (!product.includes("action")) continue;
    actionItems += 1;
    if (typeof item.quantity === "number" && /minute/i.test(String(item.unitType ?? ""))) actionMinutes += item.quantity;
    if (typeof item.netAmount === "number") actionNet += item.netAmount;
  }
  return { actionItems, actionMinutes, actionNet };
}

/** Wall-clock stand-in: each completed run in the month counts at least 1 minute, rounded up. */
export function estimateRunMinutes(runs, monthStartMs, monthEndMs) {
  let minutes = 0;
  let counted = 0;
  for (const run of runs ?? []) {
    if (!run || run.status !== "completed") continue;
    const started = Date.parse(run.run_started_at ?? "");
    const ended = Date.parse(run.updated_at ?? "");
    if (!Number.isFinite(started) || started < monthStartMs || started >= monthEndMs) continue;
    if (!Number.isFinite(ended) || ended < started) continue;
    minutes += Math.max(1, Math.ceil((ended - started) / 60_000));
    counted += 1;
  }
  return { minutes, counted };
}

export function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "plania-scan",
  };
}

export async function listWorkflowRuns(fetchImpl, token, repo, created) {
  const runs = [];
  let url = `https://api.github.com/repos/${repo}/actions/runs?per_page=100&created=${encodeURIComponent(created)}`;
  for (let page = 0; page < 10 && url; page++) {
    const response = await fetchImpl(url, { headers: githubHeaders(token) });
    if (!response.ok) throw new Error(`github ${response.status}`);
    const body = await response.json();
    if (!body || !Array.isArray(body.workflow_runs)) throw new Error("github list was not a list");
    runs.push(...body.workflow_runs);
    url = nextLink(response.headers.get("link"));
  }
  return runs;
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (invokedDirectly()) {
  if (process.argv.includes("--live")) {
    const token = process.env.GH_TOKEN ?? "";
    const repo = process.env.GITHUB_REPOSITORY ?? "";
    if (!token || !repo) {
      process.stderr.write("missing token or repository\n");
      process.exit(2);
    } else {
      const now = new Date();
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");
      const day = String(now.getUTCDate()).padStart(2, "0");
      const created = `${now.getUTCFullYear()}-${month}-01..${now.getUTCFullYear()}-${month}-${day}`;
      const runs = await listWorkflowRuns(fetch, token, repo, created);
      const window = monthWindow(now);
      const estimate = estimateRunMinutes(runs, window.start, window.end);
      process.stdout.write(`${JSON.stringify({ ...estimate, note: "wall-clock estimate, not the billing usage report" })}\n`);
    }
  } else {
    const raw = readFileSync(0, "utf8");
    const data = raw.trim() ? JSON.parse(raw) : {};
    if (process.argv.includes("--runs")) {
      const window = monthWindow(new Date());
      const runs = Array.isArray(data) ? data : data.workflow_runs ?? [];
      process.stdout.write(`${JSON.stringify(estimateRunMinutes(runs, window.start, window.end))}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(summarizeBilling(data))}\n`);
    }
  }
}
