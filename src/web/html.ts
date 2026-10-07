import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

// Same look as the handoff page: serif body, dark ground, amber accent.
const CSS = `
:root{--bg:#0c0f14;--ink:#e8e6e1;--muted:#9a958c;--line:#2a2926;--card:#141820;--accent:#d6a15a;--bright:#f3f0ea}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 "Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif}
main{max-width:760px;margin:0 auto;padding:56px 24px 96px}
a{color:inherit}
h1{font-weight:500;font-size:40px;line-height:1.1;letter-spacing:-0.03em;margin:0 0 16px}
h2{font-weight:500;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:40px 0 12px}
p{margin:0 0 14px}
.sans,.meta,header,button,input,label{font-family:ui-sans-serif,system-ui,sans-serif}
.meta{color:var(--muted);font-size:14px}
.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.86em}
header{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--muted);margin-bottom:40px}
header a{text-decoration:none}
.list{display:grid;gap:12px}
.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;text-decoration:none}
.card:hover{border-color:#3a3833}
.card strong{display:block;font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;font-weight:600;color:var(--bright);margin-bottom:4px}
.card p{color:#cfcabe;font-size:16px;margin:0}
form.inline{display:inline;margin:0}
button{background:none;border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:4px 10px;font-size:13px;cursor:pointer}
button:hover{color:var(--ink);border-color:var(--muted)}
button.primary{background:var(--accent);border-color:var(--accent);color:#1a1408;font-weight:600;padding:8px 16px;font-size:15px}
input[type=password]{width:100%;background:var(--card);border:1px solid var(--line);border-radius:10px;color:var(--ink);padding:10px 12px;font-size:16px;margin:6px 0 14px}
label{font-size:13px;color:var(--muted)}
.error{color:#e08a7a;font-size:14px}
`;

export function layout(title: string, body: Html, opts: { nav?: boolean } = {}): Html {
  return html`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${raw(CSS)}</style>
</head>
<body>
<main>
${opts.nav
  ? html`<header><a href="/">Plania</a><form class="inline" method="post" action="/logout"><button type="submit">Salir</button></form></header>`
  : ""}
${body}
</main>
</body>
</html>`;
}
