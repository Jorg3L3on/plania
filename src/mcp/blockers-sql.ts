import { sql } from "drizzle-orm";

// Legacy SQL for the one caller not yet on the store port (src/api/routes.ts). blockers.ts holds the same
// rule over store rows (isGating); this file goes away when that caller moves.

// SQL: the blocker row (alias) holds, isGating's rule. Parsed lines from other fields only reach the inbox.
export const gatingSql = (alias: string) => sql.raw(`not (coalesce(${alias}.spec->>'source', '') = 'parsed' and coalesce(${alias}.spec->>'field', '') <> 'blocked_note')`);
