-- PLA-I46-6: stills of a project's running app, and Mianovia's capture settings (the first user). Idempotent.
-- The PNG files live in the local capture store (PLANIA_CAPTURES_DIR, default ~/plania-captures); this table
-- keeps one row per page and viewport per run. Nothing is written to any app repo.

CREATE TABLE IF NOT EXISTS "capture_stills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "task_id" uuid REFERENCES "tasks"("id") ON DELETE set null,
  "run_id" uuid NOT NULL,
  "page_key" text NOT NULL,
  "page_label" text NOT NULL,
  "path" text NOT NULL,
  "viewport" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer,
  "status" text NOT NULL,
  "error" text,
  "file" text,
  "bytes" integer,
  "url" text,
  "commit" text,
  "branch" text,
  "actor" jsonb NOT NULL,
  "taken_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "capture_stills_status_check" CHECK ("status" in ('ok', 'error')),
  CONSTRAINT "capture_stills_viewport_check" CHECK ("viewport" in ('desktop', 'phone')),
  CONSTRAINT "capture_stills_file_check" CHECK (("status" = 'ok') = ("file" is not null))
);
CREATE INDEX IF NOT EXISTS "capture_stills_latest_idx" ON "capture_stills" USING btree ("project_id","page_key","viewport","taken_at");
CREATE INDEX IF NOT EXISTS "capture_stills_task_idx" ON "capture_stills" USING btree ("task_id","taken_at");

-- Mianovia: the welcome form, a bride's ficha and the team's panel, the panel pages with the seed's test
-- user (asesora@example.com). Only written when Mianovia exists and has no capture settings yet.
UPDATE "projects" SET
  "settings" = "settings" || jsonb_build_object('capture', '{
    "start_command": "npm run dev -- --port {port}",
    "port": 3000,
    "ready_path": "/registro/ejemplo",
    "pages": [
      {"key": "formulario", "path": "/registro/ejemplo", "label": "Formulario de bienvenida"},
      {"key": "ficha", "path": "/panel", "label": "Ficha de la novia", "session": true, "follow": "a[href^=\"/panel/novias/\"]"},
      {"key": "panel", "path": "/panel", "label": "Panel del equipo", "session": true}
    ],
    "session": {
      "login_path": "/panel/entrar",
      "user": "asesora@example.com",
      "user_field": "correo",
      "password_field": "contrasena",
      "password_command": "npm run --silent panel:usuario -- contrasena {user}",
      "after_login_prefix": "/panel"
    }
  }'::jsonb),
  "version" = "version" + 1,
  "updated_at" = now()
WHERE "slug" = 'mianovia' AND NOT ("settings" ? 'capture');
