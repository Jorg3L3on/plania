// PLA-I38-2: pnpm merge-gate <owner/repo> <pr> [--merge squash] [--json]
// Fetches the pull request into a temporary bare clone, runs scan:diff in JSON mode, and
// exits 0 only when ok, gitleaks.ran and gitleaks.error is null. --merge pins sha to that head.
import { parseMergeArgs } from "../src/lib/scan/merge-cli.js";
import { mergeGateExit, renderMergeJson, renderMergeText, runMergeGate } from "../src/lib/scan/merge-gate.js";

const parsed = parseMergeArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`${parsed.message}\n`);
  process.exitCode = 2;
} else {
  const result = await runMergeGate(parsed.options);
  process.stdout.write(parsed.options.json ? renderMergeJson(result) : renderMergeText(result));
  if (result.error) process.stderr.write(`${result.error}\n`);
  process.exitCode = mergeGateExit(result);
}
