// PLA-I2-18: GET /api/help-report, the help report as a file to download (src/help-report/). Behind the screen's
// session like the rest of /api. The owner chooses whether to send it; the server sends nothing.
import { Hono } from "hono";
import { withDb } from "../db/client.js";
import { buildHelpReport, helpReportFileName, renderHelpReport, type HelpReportDeps } from "../help-report/index.js";

export function helpReportRoutes(deps: HelpReportDeps = {}) {
  const routes = new Hono();
  routes.get("/", async (c) => {
    const report = await withDb((db) => buildHelpReport({ db, ...deps }));
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${helpReportFileName(report)}"`);
    c.header("Cache-Control", "no-store");
    return c.body(renderHelpReport(report));
  });
  return routes;
}
