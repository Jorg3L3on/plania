import { readFileSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { agents, docs, projects, type Project } from "../db/schema.js";
import { attachDoc } from "./docs.js";
import { createProjectFromTemplate } from "../runner/new-project.js";
import { ToolError } from "./errors.js";
import type { Ctx, Q } from "./tx.js";

// PLA-I25: one call makes a project, its product owner, and a Playbook doc.
// The same slug again changes nothing. The Playbook copy lives in docs/templates/product-owner.md.
// NEWPROJ-1: the project and its team come from createProjectFromTemplate (src/runner/new-project.ts),
// the same function the screen's sheet and `pnpm project:add` use: paused, plan approval on, a checked
// key prefix, the four core roles on the runner config. The tool keeps only the Playbook doc on top;
// the PO's note points at the `Prompt: Product owner` doc like every other PO's.

const SLUG = /^[a-z][a-z0-9-]{0,55}$/;
const TEMPLATE = path.resolve(import.meta.dirname, "../../docs/templates/product-owner.md");
const PLAYBOOK_TITLE = "Playbook";

export type CompanyProject = {
  created: boolean;
  project: string;
  name: string;
  owner: { slug: string; name: string; role: string } | null;
  playbook: { title: string; version: number } | null;
};

export function readProductOwnerTemplate(): { skills: string; playbook: string } {
  const text = readFileSync(TEMPLATE, "utf8").replace(/\r\n/g, "\n").trim();
  const marker = "\n# Playbook\n";
  const at = text.indexOf(marker);
  if (at < 0) throw new Error("product-owner template is missing the Playbook section");
  const skills = text.slice(0, at).replace(/^# Skills\n+/, "").trim();
  const playbook = text.slice(at + 1).trim();
  if (!skills || !playbook) throw new Error("product-owner template is empty");
  return { skills, playbook };
}

function checkSlug(slug: string): string {
  const trimmed = slug.trim().toLowerCase();
  if (!SLUG.test(trimmed)) throw new ToolError("INVALID_FILTER", { field: "slug", hint: "lowercase letters, digits and dashes, at most 56 characters" });
  return trimmed;
}

function checkName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 40) throw new ToolError("INVALID_FILTER", { field: "name", max: 40 });
  return trimmed;
}

function checkOwner(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) throw new ToolError("INVALID_FILTER", { field: "owner_bot_name", max: 60 });
  return trimmed;
}

function ownerSlugOf(slug: string): string {
  return `po-${slug}`;
}

async function shapeOf(db: Q, project: Project, created: boolean): Promise<CompanyProject> {
  const [owner] = await db.select().from(agents).where(eq(agents.slug, ownerSlugOf(project.slug))).limit(1);
  const [doc] = await db
    .select()
    .from(docs)
    .where(and(eq(docs.projectId, project.id), isNull(docs.taskId), eq(docs.title, PLAYBOOK_TITLE)))
    .limit(1);
  return {
    created,
    project: project.slug,
    name: project.title,
    owner: owner ? { slug: owner.slug, name: owner.name, role: owner.role } : null,
    playbook: doc ? { title: doc.title, version: doc.version } : null,
  };
}

export async function createCompanyProject(
  db: Db,
  input: { slug: string; name: string; owner_bot_name: string },
  ctx: Ctx,
): Promise<CompanyProject> {
  const slug = checkSlug(input.slug);
  const name = checkName(input.name);
  const ownerName = checkOwner(input.owner_bot_name);
  const { playbook } = readProductOwnerTemplate();

  const [existing] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (existing) return shapeOf(db, existing, false);

  const quiet = { ...ctx, requestId: undefined };
  const out = await createProjectFromTemplate(db, { name, slug, po_name: ownerName }, { requirePromptDoc: false, ctx: { ...quiet, tool: "create_company_project" } });
  if ("error" in out) {
    if (out.error === "PROJECT_EXISTS") throw new ToolError("INVALID_FILTER", { field: "slug", hint: "a team slug for this project is already on the roster" });
    throw new ToolError("INVALID_FILTER", { field: out.field ?? "slug" });
  }
  await attachDoc(db, { project: slug, title: PLAYBOOK_TITLE, markdown: playbook }, { ...quiet, tool: "attach_doc" });
  const [fresh] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return shapeOf(db, fresh!, true);
}

type WriteCtx = (
  tool: string,
  input: { actor: { agent?: string; session_id: string; machine?: string; model?: string }; request_id?: string; verbose?: boolean },
  identity: Identity | undefined,
) => Ctx;

export function registerTemplateTools(
  server: McpServer,
  host: {
    db: Db;
    identity: Identity | undefined;
    writeCtx: WriteCtx;
    actor: z.ZodType;
    request_id: z.ZodType;
    run: (fn: () => Promise<unknown>) => Promise<CallToolResult>;
    write: { readOnlyHint: false; destructiveHint: false; openWorldHint: false };
  },
): void {
  const { db, identity, writeCtx, actor, request_id, run, write } = host;

  server.registerTool(
    "create_company_project",
    {
      description: [
        "Create a project from the company template: paused, plan approval on, its team (product owner, research, artist, taller) and a Playbook doc.",
        "slug, name and owner_bot_name (the product owner's name). The same slug again is a no-op.",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        slug: z.string().min(1).max(56).describe("Project slug. A second call with this slug changes nothing"),
        name: z.string().min(1).max(40).describe("Project title"),
        owner_bot_name: z.string().min(1).max(60).describe("Name of the product-owner bot"),
      },
      annotations: write,
    },
    (raw) =>
      run(() => {
        const body = raw as { slug: string; name: string; owner_bot_name: string; actor: { agent?: string; session_id: string; machine?: string; model?: string }; request_id?: string };
        const ctx = writeCtx("create_company_project", body, identity);
        return createCompanyProject(db, body, ctx);
      }),
  );
}
