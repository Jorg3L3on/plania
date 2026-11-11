// Usage: see src/lib/scan/cli.ts (pnpm scan:diff).
// PLA-I38-1: pre-merge scan. Prints rule id, file, and line. Exit 1 on findings, 2 on errors.
// Nothing is written to the scanned repo. Matched values are not printed.
import { parseArgs } from "../src/lib/scan/cli.js";
import { renderJson, renderText } from "../src/lib/scan/report.js";
import { emptyReport, execute } from "../src/lib/scan/run.js";

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`${parsed.message}\n`);
  if (parsed.json) process.stdout.write(renderJson(emptyReport({ error: parsed.message })));
  process.exitCode = 2;
} else {
  try {
    const report = await execute(parsed.options);
    if (parsed.json) process.stdout.write(renderJson(report));
    else if (!report.error || report.findings.length > 0) process.stdout.write(renderText(report));
    if (report.error) process.stderr.write(`${report.error}\n`);
    process.exitCode = report.error ? 2 : report.findings.length > 0 ? 1 : 0;
  } catch {
    process.stderr.write("scan failed\n");
    process.exitCode = 2;
  }
}
