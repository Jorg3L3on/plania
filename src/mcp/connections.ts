// PLA-I75 (Conexiones): request_connection. A run asks for one tool from the reviewed catalog, for its own seat, with
// the reason; the owner accepts or declines it on the agent's sheet (an amber card on Conexiones). Nothing on MCP
// connects a tool, accepts a request or turns on a tool that writes.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import type { Actor } from "../db/schema.js";
import { CATALOG } from "../runner/conexiones.js";
import { requestConnection } from "../runner/conexiones-store.js";
import { agentOfCtx } from "../runner/events.js";

export const registerConnectionTools = (
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
    "request_connection",
    {
      description: [
        "Ask the owner for one more tool for your own seat, with the reason, from Plania's reviewed catalog; the owner accepts or declines it on your sheet. Only a run of a seat on that project may (CONNECTION_REQUEST_NO_SEAT).",
        `server: one of ${CATALOG.map((e) => e.id).join(", ")} (else CONNECTION_UNKNOWN); one you already have is CONNECTION_EXISTS. reason: what the work needs it for, 3-600 characters.`,
        "A second request for the same tool returns the open one. An accepted tool reads only and arrives on your next run; nothing on MCP connects a tool or turns on one that writes.",
      ].join(" "),
      inputSchema: { actor, request_id, project: z.string().min(1), server: z.string().min(1).max(40), reason: z.string().min(1).max(600) },
      annotations: write,
    },
    (raw) =>
      run(async () => {
        const input = raw as { project: string; server: string; reason: string; actor: Actor };
        const who = { ...input.actor, agent: identity?.agent ?? input.actor.agent } as Actor;
        const by = await agentOfCtx(db, { actor: who, runSession: identity?.runSession });
        return { request: await requestConnection(db, input, by) };
      }),
  );
};
