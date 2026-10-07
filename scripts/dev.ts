// Local dev server only. Production runs api/index.ts on Vercel.
import { serve } from "@hono/node-server";
import { app } from "../src/app.js";

const port = 3000;
serve({ fetch: app.fetch, port }, () => console.log(`plania dev on http://localhost:${port}`));
