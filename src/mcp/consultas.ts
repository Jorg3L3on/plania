// PLA-I57-1: answer_consulta. The project's PO answers the owner's question from Preguntar (src/pedidos/consultas.ts).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { answerConsulta, type AnswerInput } from "../pedidos/consultas.js";

export const registerConsultaTools = (
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
    "answer_consulta",
    {
      description: [
        "Answer a question the owner asked about a project with Pedir's Preguntar mode. Only the PO the question woke may answer (CONSULTA_FORBIDDEN otherwise); one call, the last of your run.",
        "short: the answer in two sentences at most, in the language of the question. why: up to six reasons. sources: every file you relied on {path relative to the repo root, line}, missing true for one you looked for that does not exist.",
        "branch and commit: what you read. sure: seen (you saw it in the code) or guess. fix: the change as request text the owner could send, only when there is something to fix.",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        project: z.string().min(1),
        id: z.string().min(1).max(40),
        short: z.string().min(1).max(600),
        why: z.array(z.string().max(700)).max(6).optional(),
        sources: z.array(z.object({ path: z.string().min(1).max(200), line: z.number().int().positive().nullable().optional(), missing: z.boolean().optional() })).max(12).optional(),
        branch: z.string().max(120).nullable().optional(),
        commit: z.string().max(40).nullable().optional(),
        sure: z.enum(["seen", "guess"]).optional(),
        fix: z.string().max(1200).nullable().optional(),
      },
      annotations: write,
    },
    (raw) =>
      run(() => {
        const input = raw as AnswerInput & { actor: { agent?: string; session_id?: string } };
        return answerConsulta(db, input, { agent: identity?.agent ?? input.actor.agent ?? "", session_id: input.actor.session_id ?? null });
      }),
  );
};
