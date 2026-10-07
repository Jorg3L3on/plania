import { Hono } from "hono";
import { web } from "./web/routes.js";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", web);
