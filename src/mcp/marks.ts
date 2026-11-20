// PLA-I66-5: deliver_marks. The project's Artist answers a logo-marks request from the Marca door (src/brand/marks.ts).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { deliverMarks, MAX_MARKS } from "../brand/marks.js";

export const registerMarksTools = (
  server: McpServer,
  host: {
    db: Db;
    identity: Identity | undefined;
    actor: z.ZodType;
    request_id: z.ZodType;
    run: (fn: () => Promise<unknown>) => Promise<CallToolResult>;
    write: { readOnlyHint: false; destructiveHint: false; openWorldHint: false };
  },
): void => {
  const { db, identity, actor, request_id, run, write } = host;
  server.registerTool(
    "deliver_marks",
    {
      description: [
        "Artist: answer a logo-marks request (a run whose reason says [marcas <id>]). Only the Artist the request woke may answer (MARKS_FORBIDDEN otherwise); one call, the last of the run.",
        `marks: 1 to ${MAX_MARKS}, each {name (two or three words), idea (one sentence), svg (a square app icon, viewBox 0 0 100 100, its own background)}.`,
        "Plania removes scripts, events and outside references, refuses what is not a square SVG, renders each mark and tests it at 16 px, against Android's circle and for contrast; the reply says which were kept and why others were not (MARKS_INVALID when none is usable).",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        project: z.string().min(1),
        id: z.string().min(1).max(40),
        marks: z.array(z.object({ name: z.string().min(1).max(80), idea: z.string().max(400), svg: z.string().min(10).max(100_000) })).min(1).max(MAX_MARKS),
      },
      annotations: write,
    },
    (raw) =>
      run(() => {
        const input = raw as { project: string; id: string; marks: { name: string; idea: string; svg: string }[]; actor: { agent?: string; session_id?: string } };
        return deliverMarks(db, input, { agent: identity?.agent ?? input.actor.agent ?? "", session_id: input.actor.session_id ?? null });
      }),
  );
};
