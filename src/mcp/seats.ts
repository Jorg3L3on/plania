// PLA-I71-3: propose_seat. A project's PO proposes one more seat, with the reason, from the role catalog; the owner
// accepts or declines it on the screen (an amber card on Equipo's chart). Runs never create, move, pause or retire
// seats: this tool only writes a proposal, and nothing on MCP decides one.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import type { Actor } from "../db/schema.js";
import { agentOfCtx } from "../runner/events.js";
import { proposeSeat } from "../runner/puestos.js";

export const registerSeatTools = (
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
    "propose_seat",
    {
      description: [
        "Propose one more seat for a project's team, with the reason, for the owner to accept or decline on the screen. Only that project's product owner may (SEAT_PROPOSAL_NOT_PO).",
        "role: a slug of the role catalog (product-owner, research, artist, taller, qa, copy, seguridad, marketing, data, or a role of the owner's own); one already on the team is SEAT_TAKEN. reason: why the work needs it, 3-600 characters.",
        "A second proposal of the same role returns the open one. An accepted seat arrives paused; nothing on MCP accepts, creates, moves, pauses or retires a seat.",
      ].join(" "),
      inputSchema: { actor, request_id, project: z.string().min(1), role: z.string().min(1).max(60), reason: z.string().min(1).max(600) },
      annotations: write,
    },
    (raw) =>
      run(async () => {
        const input = raw as { project: string; role: string; reason: string; actor: Actor };
        const who = { ...input.actor, agent: identity?.agent ?? input.actor.agent } as Actor;
        const by = await agentOfCtx(db, { actor: who, runSession: identity?.runSession });
        return { proposal: await proposeSeat(db, input, by) };
      }),
  );
};
