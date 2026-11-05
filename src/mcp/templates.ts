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
import { ToolError } from "./errors.js";
import { setProject } from "./project.js";
import { setAgent } from "./team.js";
import { writeTx, type Ctx, type Q } from "./tx.js";

// PLA-I25: one call makes a project, a product-owner bot, and a Playbook doc.
// The same slug again changes nothing. The copy lives in docs/templates/product-owner.md.

const SLUG = /^[a-z][a-z0-9-]{0,55}$/;
const TEMPLATE = path.resolve(import.meta.dirname, "../../docs/templates/product-owner.md");
const PLAYBOOK_TITLE = "Playbook";
const COMPANY_BODY = "Company project. The plan lives in Plania.";

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

function prefixOf(slug: string): string {
  const letters = slug.replace(/[^a-z0-9]/g, "").toUpperCase();
  return (letters + "XXX").slice(0, 3);
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
  const { skills, playbook } = readProductOwnerTemplate();
  const ownerSlug = ownerSlugOf(slug);

  const [existing] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (existing) return shapeOf(db, existing, false);

  const [taken] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, ownerSlug)).limit(1);
  if (taken) throw new ToolError("INVALID_FILTER", { field: "slug", hint: "the product-owner slug is already on the roster" });

  const [coo] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, "plania")).limit(1);
  const [created] = await db
    .insert(projects)
    .values({ slug, title: name, keyPrefix: prefixOf(slug) })
    .returning();
  const project = created!;
  try {
    const quiet = { ...ctx, requestId: undefined };
    await writeTx(db, project, { ...quiet, tool: "create_company_project" }, async (_tx, emit) => {
      await emit("project.created", null, { slug, title: name, key_prefix: project.keyPrefix });
    });
    await setProject(db, { project: slug, version: 1, title: name, body: COMPANY_BODY }, { ...quiet, tool: "set_project" });
    await setAgent(db, {
      slug: ownerSlug,
      name: ownerName,
      role: "product-owner",
      title: "Product owner",
      kind: "bot",
      ...(coo ? { reports_to: "plania" } : {}),
      capabilities: ["product-owner"],
      adapter: "http",
      adapter_config: {},
      heartbeat_minutes: 60,
      note: skills,
    });
    await attachDoc(db, { project: slug, title: PLAYBOOK_TITLE, markdown: playbook }, { ...quiet, tool: "attach_doc" });
    const [fresh] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1);
    return shapeOf(db, fresh!, true);
  } catch (err) {
    await db.delete(agents).where(eq(agents.slug, ownerSlug));
    await db.delete(projects).where(eq(projects.id, project.id));
    throw err;
  }
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
        "Create a project, a product-owner bot and a Playbook doc from the company template.",
        "slug, name and owner_bot_name. The same slug again is a no-op.",
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
