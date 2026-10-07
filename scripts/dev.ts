// Local server. Production on Vercel runs api/index.ts instead.
// Port 3737 stays clear of the 3000 that product repos use for their own dev servers.
// Bound to 127.0.0.1 so nothing outside this machine can reach it.
import { serve } from "@hono/node-server";
import { app } from "../src/app.js";

const port = 3737;
const hostname = "127.0.0.1";
serve({ fetch: app.fetch, port, hostname }, () => console.log(`plania on http://localhost:${port}`));
