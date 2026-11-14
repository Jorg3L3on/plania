// PLA-I48-4/5/6: Máquinas, the floor's second level (Design frames 2-7, 12). Left, the window: the app itself, one tab
// per capture page, computer or phone size, its address bar with Captura and Abrir, and blinds with the one button
// that starts it while it is off. Right, the machine room: Servidor and Base de datos with levers that name the next
// action, the pipes between them (lit, dark, red when the app cannot reach its base), one drawer per table, and the
// shelf (Llaves, Pruebas). Under both, Pedir. A drawer lays its rows over the window; «Ver el mapa» lays the tables
// and their relations there. Presentational and hook-free: maquinas-live.tsx holds the reads and the clicks.
import type { ReactNode } from "react";
import type { Load } from "./ficha";
import { bytes, filas, maqView, type MaqView, type MaquinasRead, type RowsRead, type ServerAct, type TablesRead, type LlavesRead, type PruebasRead } from "@/lib/maquinas";
import type { Still } from "@/lib/ventana";

export type MaqOpen = "servidor" | "base" | "llaves" | "pruebas" | "probar" | { tabla: string };
export type MaqActs = {
  onServer?: (a: ServerAct) => void;
  onBase?: (a: "encender" | "apagar") => void;
  onConfigurar?: () => void;
  onCaptura?: () => void;
  onOpen?: (what: MaqOpen, el: HTMLElement) => void; // La ficha
  onPage?: (key: string) => void;
  onSize?: (s: "desktop" | "phone") => void;
  onDrawer?: (name: string | null) => void;
  onMapa?: (open: boolean) => void;
  onRows?: (offset: number) => void;
  busy?: string | null; // "server:encender", "base:apagar", "configurar", "captura"
};

const Lamp = ({ s, label }: { s: string; label?: string }) => <i className="edi-maq-lamp" data-s={s} aria-label={label} role={label ? "img" : undefined} aria-hidden={label ? undefined : true} />;

// ---- the window

const Blinds = ({ v, r, acts }: { v: MaqView; r: MaquinasRead; acts: MaqActs }) => {
  const busy = acts.busy;
  if (v.window === "setup") {
    const f = r.found;
    return (
      <div className="edi-maq-blinds" data-blinds="setup">
        <h3>Este piso no sabe cómo encenderse</h3>
        {f?.dev ? (
          <>
            <p>Encontré estos comandos en su package.json:</p>
            <ul className="edi-maq-found" data-found>
              <li>
                <span>Encender</span>
                <code>{f.dev.replace("{port}", String(f.port ?? 3000))}</code>
              </li>
              {f.migrate && (
                <li>
                  <span>Migrar</span>
                  <code>{f.migrate}</code>
                </li>
              )}
              {f.seed && (
                <li>
                  <span>Sembrar</span>
                  <code>{f.seed}</code>
                </li>
              )}
              {f.test && (
                <li>
                  <span>Pruebas</span>
                  <code>{f.test}</code>
                </li>
              )}
            </ul>
            <div className="edi-maq-brow">
              <button type="button" className="edi-btn edi-btn-primary" onClick={acts.onConfigurar} disabled={busy === "configurar"} data-control="maq-configurar">
                {busy === "configurar" ? "…" : "Usar estos comandos"}
              </button>
            </div>
          </>
        ) : (
          <p data-missing>Falta {f?.missing.join(", ") || "un package.json con un script dev"}. Pídele al equipo que lo deje listo.</p>
        )}
      </div>
    );
  }
  if (v.window === "starting")
    return (
      <div className="edi-maq-blinds" data-blinds="starting" aria-busy="true">
        <h3>Encendiendo…</h3>
        <ol className="edi-maq-steps">
          <li>Trae sandbox</li>
          <li>Instala lo que falte</li>
          <li>Arranca y espera que responda</li>
        </ol>
      </div>
    );
  if (v.window === "failed")
    return (
      <div className="edi-maq-blinds" data-blinds="failed">
        <h3>No arrancó</h3>
        <p data-reason>{r.server.error ?? "La copia de prueba se cerró al arrancar."}</p>
        <div className="edi-maq-brow">
          <button type="button" className="edi-btn edi-btn-primary" onClick={() => acts.onServer?.("encender")} disabled={!!busy} data-control="maq-reintentar">
            {busy === "server:encender" ? "…" : "Reintentar"}
          </button>
          <button type="button" className="edi-btn" onClick={(e) => acts.onOpen?.("llaves", e.currentTarget)} data-control="maq-ver-llaves">
            Ver las llaves
          </button>
          <button type="button" className="edi-btn" onClick={(e) => acts.onOpen?.("servidor", e.currentTarget)} data-control="maq-ver-bitacora">
            Ver la bitácora
          </button>
        </div>
      </div>
    );
  return (
    <div className="edi-maq-blinds" data-blinds="off">
      <h3>La app está apagada</h3>
      <p>Se enciende la copia de prueba (sandbox) en tu Mac. Nada arranca sin tu clic.</p>
      <div className="edi-maq-brow">
        <button type="button" className="edi-btn edi-btn-primary" onClick={() => acts.onServer?.("encender")} disabled={!!busy} data-control="maq-encender-app">
          {busy === "server:encender" ? "…" : "Encender la app"}
        </button>
      </div>
    </div>
  );
};

export const Glass = ({ v, r, size, still, frame, path, acts }: { v: MaqView; r: MaquinasRead; size: "desktop" | "phone"; still: Still | null; frame: boolean; path: string; acts: MaqActs }) => {
  const url = r.server.url ? `${r.server.url}${path}` : null;
  return (
    <div className="edi-maq-glass" data-dev={size} data-window={v.window}>
      {v.window === "live" &&
        (frame && url ? (
          <iframe className="edi-maq-frame" src={url} title={`La app de ${r.project}`} data-frame />
        ) : still ? (
          <img className="edi-maq-shot" src={still.image_url} alt={`Captura de ${path}`} data-shot />
        ) : (
          <p className="edi-maq-noshot" data-noshot>
            Todavía no hay captura de esta página. <button type="button" className="edi-vlink" onClick={acts.onCaptura} data-control="maq-captura-vacia">Tomarla</button>
          </p>
        ))}
      {v.state === "base-down" && (
        <div className="edi-maq-warn" role="status" data-warn>
          La app está encendida, pero no llega a su base.
          {v.base.lever?.act === "encender" && (
            <button type="button" className="edi-btn" onClick={() => acts.onBase?.("encender")} disabled={!!acts.busy} data-control="maq-warn-base">
              Encender la base
            </button>
          )}
        </div>
      )}
      {v.window !== "live" && <Blinds v={v} r={r} acts={acts} />}
    </div>
  );
};

// ---- the overlays: a drawer's rows, the map

export const RowsSheet = ({ table, rows, sample, acts }: { table: string; rows: Load<RowsRead>; sample: boolean; acts: MaqActs }) => {
  const d = rows.data;
  return (
    <div className="edi-maq-sheet" role="region" aria-label={`Filas de ${table}`} data-sheet="rows">
      <div className="edi-maq-shead">
        <h3>
          <code title={table}>{table}</code>
        </h3>
        {d && <small>{filas(d.total)}</small>}
        {sample && <span className="edi-maq-tag" data-sample>datos de muestra</span>}
        <button type="button" className="edi-fi-x" onClick={() => acts.onDrawer?.(null)} aria-label="Cerrar el cajón" data-control="maq-cajon-cerrar">
          ✕
        </button>
      </div>
      <div className="edi-maq-sbody">
        {rows.status === "error" ? (
          <div className="edi-fi-state" data-state="error">
            <p>No se pudo leer la tabla.</p>
            {rows.retry && (
              <button type="button" className="edi-btn" onClick={rows.retry} data-control="maq-filas-reintentar">
                Reintentar
              </button>
            )}
          </div>
        ) : !d ? (
          <div className="edi-fi-state" data-state="loading" aria-busy="true">
            <span className="edi-sk" />
            <span className="edi-sk" />
          </div>
        ) : d.total === 0 ? (
          <p className="edi-fi-empty" data-state="empty">
            La tabla está vacía.
          </p>
        ) : (
          <table className="edi-maq-rows">
            <thead>
              <tr>
                {d.columns.map((c) => (
                  <th key={c} scope="col" title={c}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((row, i) => (
                <tr key={i}>
                  {d.columns.map((c) => (
                    <td key={c} data-hidden={d.hidden.includes(c) || undefined} title={row[c] ?? ""}>
                      {row[c] ?? <span className="edi-maq-null">vacío</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {d && d.total > d.limit && (
        <div className="edi-maq-sfoot" data-paging>
          <span>
            {d.offset + 1}–{Math.min(d.offset + d.limit, d.total)} de {d.total.toLocaleString("es-MX")}
          </span>
          <button type="button" className="edi-vlink" disabled={d.offset === 0} onClick={() => acts.onRows?.(Math.max(0, d.offset - d.limit))} data-control="maq-filas-antes">
            Anteriores
          </button>
          <button type="button" className="edi-vlink" disabled={d.offset + d.limit >= d.total} onClick={() => acts.onRows?.(d.offset + d.limit)} data-control="maq-filas-despues">
            Siguientes
          </button>
        </div>
      )}
    </div>
  );
};

export const MapSheet = ({ tables, acts }: { tables: TablesRead; acts: MaqActs }) => (
  <div className="edi-maq-sheet" role="region" aria-label="Mapa de la base" data-sheet="map">
    <div className="edi-maq-shead">
      <h3>Mapa de la base</h3>
      <small>
        {tables.tables.length} tablas · {tables.tables.reduce((n, t) => n + t.relations.length, 0)} relaciones
      </small>
      <button type="button" className="edi-fi-x" onClick={() => acts.onMapa?.(false)} aria-label="Cerrar el mapa" data-control="maq-mapa-cerrar">
        ✕
      </button>
    </div>
    <div className="edi-maq-sbody edi-maq-map">
      {tables.tables.map((t) => (
        <button key={t.name} type="button" className="edi-maq-box" onClick={(e) => acts.onOpen?.({ tabla: t.name }, e.currentTarget)} data-map-box={t.name}>
          <b title={t.name}>{t.name}</b>
          <small>{filas(t.rows)}</small>
          <ul>
            {t.columns.map((c) => (
              <li key={c.name} data-key={c.key || undefined} data-ref={c.references ? `${c.references.table}.${c.references.column}` : undefined}>
                <span title={c.name}>{c.name}</span>
                {c.key && <em>llave</em>}
                {c.references && <em>→ {c.references.table}</em>}
              </li>
            ))}
          </ul>
        </button>
      ))}
    </div>
  </div>
);

// ---- the room

const Lever = ({ label, on, s, next, onClick, disabled, control }: { label: string; on: boolean; s: string; next: string; onClick?: () => void; disabled?: boolean; control: string }) => (
  <button type="button" className="edi-maq-lever" role="switch" aria-checked={on} aria-label={`${label}: ${next}`} data-next={next} data-s={s} onClick={onClick} disabled={disabled} data-control={control}>
    <i aria-hidden />
  </button>
);

export const Maquinas = ({
  read,
  captures,
  tables,
  rows,
  llaves,
  pruebas,
  page,
  size = "desktop",
  frame,
  drawer,
  mapa,
  acts,
  ask,
}: {
  read: Load<MaquinasRead>;
  // The still of the page on show (from the capture read), for the window when the live frame is not allowed.
  captures?: { desktop: Still | null; phone: Still | null } | null;
  tables?: Load<TablesRead>;
  rows?: Load<RowsRead>;
  llaves?: LlavesRead | null;
  pruebas?: PruebasRead | null;
  page?: string | null;
  size?: "desktop" | "phone";
  frame?: boolean;
  drawer?: string | null;
  mapa?: boolean;
  acts: MaqActs;
  ask?: ReactNode;
}) => {
  if (read.status !== "ok" || !read.data)
    return (
      <div className="edi-maq" data-maq={read.status === "error" ? "error" : "loading"}>
        {read.status === "error" ? (
          <div className="edi-fi-state" data-state="error">
            <p>No se pudo leer el cuarto de máquinas.</p>
            {read.retry && (
              <button type="button" className="edi-btn" onClick={read.retry} data-control="maq-reintentar-leer">
                Reintentar
              </button>
            )}
          </div>
        ) : (
          <div className="edi-fi-state" data-state="loading" aria-busy="true">
            <span className="edi-sk" />
            <span className="edi-sk" />
            <span className="edi-sk" />
          </div>
        )}
      </div>
    );
  const r = read.data;
  const v = maqView(r);
  const pg = r.pages.find((p) => p.key === page) ?? r.pages[0] ?? null;
  const still = size === "phone" ? (captures?.phone ?? null) : (captures?.desktop ?? null);
  const busy = acts.busy ?? null;
  const t = tables?.status === "ok" ? tables.data : undefined;
  const sv = v.server;
  const bv = v.base;
  const overlay = drawer && rows ? <RowsSheet table={drawer} rows={rows} sample={!!t?.sample} acts={acts} /> : mapa && t ? <MapSheet tables={t} acts={acts} /> : null;
  const logLine = r.server.detail?.split("\n").filter(Boolean).pop() ?? null;
  const keys = llaves ? `${llaves.set} de ${llaves.llaves.length} puestas` : "";
  const tests = pruebas?.running ? "Corriendo…" : pruebas?.last ? (pruebas.last.ok ? `En verde${pruebas.last.passed !== null ? ` · ${pruebas.last.passed}` : ""}` : `Fallan${pruebas.last.failed !== null ? ` · ${pruebas.last.failed}` : ""}`) : "Sin correr";
  return (
    <div className="edi-maq" data-maq={v.state}>
      <section className="edi-maq-viewer" aria-label="Ventana a la app">
        <div className="edi-maq-win" data-lit={v.window === "live" || undefined}>
          <div className="edi-maq-transom">
            <div className="edi-maq-tabs" role="group" aria-label="Páginas de la app" data-off={v.window !== "live" || undefined}>
              {r.pages.map((p) => (
                <button key={p.key} type="button" aria-pressed={p.key === pg?.key} onClick={() => acts.onPage?.(p.key)} title={p.label} data-page={p.key}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="edi-maq-seg" role="group" aria-label="Tamaño">
              <button type="button" aria-pressed={size === "desktop"} onClick={() => acts.onSize?.("desktop")} data-control="maq-computadora">
                Computadora
              </button>
              <button type="button" aria-pressed={size === "phone"} onClick={() => acts.onSize?.("phone")} data-control="maq-telefono">
                Teléfono
              </button>
            </div>
            {r.configured && (
              <button type="button" className="edi-btn edi-maq-sm" onClick={(e) => acts.onOpen?.("probar", e.currentTarget)} data-control="maq-probar">
                Cómo probarla
              </button>
            )}
          </div>
          <div className="edi-maq-url">
            <span className="edi-maq-live" data-s={sv.light}>
              <Lamp s={sv.light} />
              {v.window === "live" ? "En vivo" : sv.word}
            </span>
            <code title={r.server.url ? `${r.server.url}${pg?.path ?? "/"}` : undefined}>{r.server.url ? `${r.server.url.replace(/^https?:\/\//, "")}${pg?.path ?? "/"}` : (pg?.path ?? "")}</code>
            <button type="button" className="edi-btn edi-maq-sm" onClick={acts.onCaptura} disabled={v.window !== "live" || busy === "captura"} data-control="maq-captura">
              {busy === "captura" ? "…" : "Captura"}
            </button>
            {r.server.url && v.window === "live" ? (
              <a className="edi-btn edi-maq-sm edi-btn-primary" href={`${r.server.url}${pg?.path ?? "/"}`} target="_blank" rel="noreferrer" data-control="maq-abrir">
                Abrir ↗
              </a>
            ) : (
              <button type="button" className="edi-btn edi-maq-sm" disabled data-control="maq-abrir">
                Abrir ↗
              </button>
            )}
          </div>
          <Glass v={v} r={r} size={size} still={still} frame={frame ?? !!r.server.frameable} path={pg?.path ?? "/"} acts={acts} />
        </div>
        {overlay}
      </section>

      <section className="edi-maq-room" aria-label="Cuarto de máquinas">
        <p className="edi-eyebrow edi-maq-eye">
          Cuarto de máquinas<small>todo corre en tu Mac</small>
        </p>
        <article className="edi-maq-mach" data-mach="servidor">
          <i className="edi-maq-pipe edi-maq-pipe-h" data-s={v.pipes.window} aria-hidden />
          <button type="button" className="edi-maq-main" onClick={(e) => acts.onOpen?.("servidor", e.currentTarget)} aria-label="Abrir la ficha del servidor" data-control="maq-servidor">
            <Lamp s={sv.light} />
            <span className="edi-maq-name">
              Servidor<span>copia de prueba</span>
            </span>
            <span className="edi-maq-state" data-state-word>
              {sv.word}
            </span>
            <span className="edi-maq-sub" title={sv.sub}>
              {sv.sub}
            </span>
            {logLine && (
              <span className="edi-maq-log" data-bad={v.state === "failed" || undefined} title={logLine}>
                {logLine}
              </span>
            )}
          </button>
          {sv.lever ? (
            <Lever label="Servidor" on={sv.lever.on} s={sv.light} next={sv.lever.label} onClick={() => acts.onServer?.(sv.lever!.act)} disabled={!!busy} control="maq-palanca-servidor" />
          ) : (
            <Lever label="Servidor" on={sv.light === "on" || sv.light === "starting"} s={sv.light} next={sv.outside ? "Fuera" : sv.light === "starting" ? "…" : "—"} disabled control="maq-palanca-servidor" />
          )}
        </article>
        <article className="edi-maq-mach" data-mach="base">
          <i className="edi-maq-pipe edi-maq-pipe-v" data-s={v.pipes.base} aria-hidden />
          <button type="button" className="edi-maq-main" onClick={(e) => acts.onOpen?.("base", e.currentTarget)} aria-label="Abrir la ficha de la base de datos" data-control="maq-base">
            <Lamp s={bv.light === "none" ? "off" : bv.light} />
            <span className="edi-maq-name">
              Base de datos<span>{r.base.engine === "postgres" ? `Postgres${r.base.version ? ` ${r.base.version.split(".")[0]}` : ""}` : ""}</span>
            </span>
            <span className="edi-maq-state" data-state-word>
              {bv.word}
            </span>
            <span className="edi-maq-sub" title={bv.sub}>
              {bv.sub}
              {t && t.migrations.files.length > 0 && <> · {t.migrations.pending ? `${t.migrations.pending} migración pendiente` : "migraciones al día"}</>}
              {r.base.size_bytes !== null && <> · {bytes(r.base.size_bytes)}</>}
            </span>
          </button>
          {bv.lever ? (
            <Lever label="Base de datos" on={bv.lever.on} s={bv.light} next={bv.lever.label} onClick={() => acts.onBase?.(bv.lever!.act)} disabled={!!busy} control="maq-palanca-base" />
          ) : (
            <Lever label="Base de datos" on={bv.light === "on"} s={bv.light} next="—" disabled control="maq-palanca-base" />
          )}
          <div className="edi-maq-drawers" role="group" aria-label="Tablas" data-drawers={t ? t.tables.length : 0}>
            {!v.drawers ? (
              <p className="edi-maq-dnote" data-dnote>
                {r.base.state === "none" ? "Sin base, sin cajones." : "Enciende la base para abrir sus tablas."}
              </p>
            ) : tables?.status === "error" ? (
              <p className="edi-maq-dnote" data-dnote="error">
                No se pudieron leer las tablas.{" "}
                {tables.retry && (
                  <button type="button" className="edi-vlink" onClick={tables.retry} data-control="maq-tablas-reintentar">
                    Reintentar
                  </button>
                )}
              </p>
            ) : !t ? (
              <span className="edi-sk" aria-busy="true" />
            ) : (
              <>
                {t.tables.map((x) => (
                  <button key={x.name} type="button" className="edi-maq-drawer" aria-pressed={drawer === x.name} onClick={() => acts.onDrawer?.(drawer === x.name ? null : x.name)} title={`${x.name} · ${filas(x.rows)}`} data-drawer={x.name}>
                    <code>{x.name}</code>
                    <span>{x.rows.toLocaleString("es-MX")}</span>
                  </button>
                ))}
                {t.tables.length > 1 && (
                  <button type="button" className="edi-maq-drawer edi-maq-ghost" aria-pressed={!!mapa} onClick={() => acts.onMapa?.(!mapa)} data-control="maq-mapa">
                    <code>Ver el mapa</code>
                  </button>
                )}
              </>
            )}
          </div>
        </article>
        {(bv.warn || bv.reason) && (
          <p className="edi-maq-note" data-base-note>
            {bv.warn ?? bv.reason}
          </p>
        )}
        <div className="edi-maq-shelf">
          <button type="button" className="edi-maq-inst" onClick={(e) => acts.onOpen?.("llaves", e.currentTarget)} data-control="maq-llaves">
            <b>
              Llaves<small>{keys}</small>
            </b>
            <small data-keys-missing={llaves?.missing || undefined}>{llaves ? (llaves.missing ? `Faltan ${llaves.missing}` : "Todas puestas") : "Ver cuáles faltan"}</small>
          </button>
          <button type="button" className="edi-maq-inst" onClick={(e) => acts.onOpen?.("pruebas", e.currentTarget)} data-control="maq-pruebas">
            <b>
              Pruebas<small>{pruebas?.last ? `${Math.round(pruebas.last.duration_ms / 1000)} s` : ""}</small>
            </b>
            <small data-tests={pruebas?.running ? "running" : pruebas?.last ? (pruebas.last.ok ? "pass" : "fail") : "none"}>{tests}</small>
          </button>
        </div>
      </section>
      {ask && <div className="edi-maq-ask">{ask}</div>}
    </div>
  );
};
