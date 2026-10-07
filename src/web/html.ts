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
dl.resume{display:grid;grid-template-columns:max-content 1fr;gap:10px 20px;margin:0 0 8px}
dl.resume dt{font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;color:var(--muted);padding-top:3px}
dl.resume dd{margin:0;white-space:pre-wrap;color:var(--bright)}
dl.resume dd.empty{color:var(--muted)}
.group{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:4px 18px;margin-bottom:12px}
.item{display:flex;gap:16px;justify-content:space-between;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line)}
.item:first-child{border-top:0}
.item.child{padding-left:18px}
.item .text{min-width:0}
.item .title{font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;font-weight:600;color:var(--bright)}
.item.child .title{font-weight:500}
.item .line{color:#cfcabe;font-size:16px;margin:2px 0 0}
.item .note{color:#e08a7a;font-size:15px;margin:4px 0 0}
.item .side{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px}
.side .row{display:flex;align-items:center;gap:10px}
.status{color:var(--accent);white-space:nowrap}
.prio{color:var(--muted);font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px}
.side a{color:var(--muted)}
.empty-list{color:var(--muted);font-size:15px}
@media (max-width:560px){dl.resume{grid-template-columns:1fr;gap:2px}dl.resume dd{margin-bottom:10px}.item{flex-direction:column;gap:8px}.item .side{flex-direction:row;align-items:center;gap:12px}}
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
