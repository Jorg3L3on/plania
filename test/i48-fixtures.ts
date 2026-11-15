// PLA-I48: fake F1 and F2 reads shared by the Máquinas UI tests (fictional project «Lumen»). Not a test file.
type Json = Record<string, any>;

export const server = (patch: Json = {}): Json => ({ phase: "off", managed: false, port: null, url: null, started_at: null, error: null, detail: null, command: "npm run dev -- --port 3000", commit: null, branch: "sandbox", worktree: null, started_by: null, frameable: false, ...patch });
export const base = (patch: Json = {}): Json => ({
  state: "on",
  engine: "postgres",
  version: "17.2",
  host: "127.0.0.1",
  port: 5433,
  databases: [{ name: "lumen_dev", size_bytes: 9_500_000, app: true }],
  size_bytes: 9_500_000,
  service: "postgresql@17",
  shared_with: ["faro"],
  lever: { can: true, reason: null },
  env_file: ".env.local",
  ...patch,
});
export const read = (patch: Json = {}): Json => ({
  project: "lumen",
  configured: true,
  server: server(),
  base: base(),
  found: null,
  pages: [
    { key: "formulario", path: "/registro", label: "Formulario de bienvenida" },
    { key: "panel", path: "/panel", label: "Panel del equipo", session: true },
  ],
  test_user: "prueba@example.com",
  ...patch,
});
export const tables: Json = {
  connection: { host: "127.0.0.1", port: 5433, database: "lumen_dev" },
  total_rows: 15,
  sample: true,
  tables: [
    { name: "registro", rows: 12, columns: [{ name: "id", type: "integer", not_null: true, key: true, unique: false, default: null, references: null, hidden: false }], indexes: [], relations: [] },
    { name: "sucursal", rows: 3, columns: [], indexes: [], relations: [] },
  ],
  migrations: { dir: "drizzle", files: [{ name: "0000_init", applied: true }, { name: "0001_promociones", applied: false }], applied: 1, pending: 1, table: "drizzle.__drizzle_migrations" },
};
