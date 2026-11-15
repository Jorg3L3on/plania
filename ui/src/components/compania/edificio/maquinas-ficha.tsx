// PLA-I48-5/6: La ficha's Máquinas kinds (Design frames 5, 8, 9). Servidor, Base de datos, one table, Llaves, Pruebas
// and Cómo probarla. Depth behind a click, in the card that already exists. Hook-free: the page passes the reads in
// as loads and holds the clicks (maquinas-live.tsx), so the tests render each kind and walk its handlers.
import type { ReactNode } from "react";
import type { Load } from "./ficha";
import { bytes, filas, type LlavesRead, type MaquinasRead, type Paso, type PruebasRead, type RecorridoRead, type Table, type TablesRead } from "@/lib/maquinas";

export type MaqFichaActs = {
  onServer?: (a: "encender" | "apagar" | "reiniciar") => void;
  onAplicar?: () => void;
  onSembrar?: () => void;
  onVaciarPedir?: () => void; // shows the confirmation
  onVaciar?: (rows: number) => void; // confirmed, with the count the screen showed
  onVaciarCancelar?: () => void;
  onPruebas?: () => void;
  onIr?: (p: Paso) => void; // moves the window to the step's page
  onTick?: (n: number, done: boolean) => void;
  onFallo?: (p: Paso) => void; // fills Pedir
  onContrasena?: () => void;
  onTabla?: (name: string) => void;
  onLlaves?: () => void;
  busy?: string | null;
};

const Sec = ({ title, children, data }: { title: string; children: ReactNode; data?: string }) => (
  <section className="edi-fi-sec" data-fi-sec={data}>
    <h4 className="edi-eyebrow">{title}</h4>
    {children}
  </section>
);
const Title = ({ eyebrow, title, state }: { eyebrow: string; title: string; state?: string }) => (
  <header className="edi-fi-head">
    <p className="edi-eyebrow">{eyebrow}</p>
    <h3 className="edi-fi-title" title={title}>
      {title}
    </h3>
    {state && <p className="edi-fi-state-line">{state}</p>}
  </header>
);
const Kv = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="edi-maq-kv">
    {rows.map(([k, v]) => (
      <div key={k}>
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ))}
  </dl>
);
function loaded<T>(load: Load<T> | undefined, what: string, draw: (d: T) => ReactNode, empty?: (d: T) => ReactNode | null): ReactNode {
  if (!load || load.status === "error")
    return (
      <div className="edi-fi-state" data-state="error">
        <p>No se pudo leer {what}.</p>
        {load?.retry && (
          <button type="button" className="edi-btn" onClick={load.retry} data-control="maq-ficha-reintentar">
            Reintentar
          </button>
        )}
      </div>
    );
  if (load.status !== "ok" || load.data === undefined)
    return (
      <div className="edi-fi-state" data-state="loading" aria-busy="true">
        <span className="edi-sk" />
        <span className="edi-sk" />
      </div>
    );
  const e = empty?.(load.data);
  if (e)
    return (
      <div className="edi-fi-empty" data-state="empty">
        {e}
      </div>
    );
  return draw(load.data);
}

// ---- Servidor

export const FichaServidor = ({ read, log, acts }: { read: Load<MaquinasRead>; log: Load<{ lines: string[] }>; acts: MaqFichaActs }) => (
  <>
    <Title eyebrow="Máquinas · Servidor" title="Copia de prueba" state={read.data ? stateOf(read.data) : undefined} />
    {loaded(read, "el servidor", (r) => {
      const s = r.server;
      const on = s.phase === "live" || s.phase === "running" || s.phase === "capturing";
      return (
        <>
          <Kv
            rows={[
              ["Dirección", s.url ? <code>{s.url}</code> : "Sin encender"],
              ["Comando", s.command ? <code>{s.command}</code> : "Sin configurar"],
              ["Rama y commit", s.branch ? <code>{[s.branch, s.commit?.slice(0, 7)].filter(Boolean).join(" @ ")}</code> : "—"],
              ["Carpeta", s.worktree ? <code title={s.worktree}>{s.worktree}</code> : "La copia de prueba de Plania"],
              ["Quién la encendió", s.started_by ?? "Nadie todavía"],
              ["Se apaga sola", "A los 20 min sin que nadie mire el piso"],
            ]}
          />
          {s.phase === "running" && !s.managed && <p className="edi-maq-note">La encendiste fuera de Plania: aquí solo se mira. Apágala donde la encendiste.</p>}
          {s.error && (
            <p className="edi-maq-note" data-bad>
              {s.error}
            </p>
          )}
          <div className="edi-fi-acts">
            {s.managed && on && (
              <button type="button" className="edi-btn" onClick={() => acts.onServer?.("reiniciar")} disabled={!!acts.busy} data-control="maq-reiniciar">
                {acts.busy === "server:reiniciar" ? "…" : "Reiniciar"}
              </button>
            )}
            {s.managed && on && (
              <button type="button" className="edi-btn" onClick={() => acts.onServer?.("apagar")} disabled={!!acts.busy} data-control="maq-ficha-apagar">
                Apagar
              </button>
            )}
            {r.configured && !on && s.phase !== "starting" && (
              <button type="button" className="edi-btn edi-btn-primary" onClick={() => acts.onServer?.("encender")} disabled={!!acts.busy} data-control="maq-ficha-encender">
                {s.phase === "failed" ? "Reintentar" : "Encender la app"}
              </button>
            )}
          </div>
          <Sec title="Bitácora" data="bitacora">
            {loaded(
              log,
              "la bitácora",
              (l) => (
                <pre className="edi-vdetail edi-maq-log-full" data-bitacora>
                  {l.lines.join("\n")}
                </pre>
              ),
              (l) => (l.lines.length ? null : "Sin salida todavía: aparece cuando Plania la enciende."),
            )}
          </Sec>
        </>
      );
    })}
  </>
);
const stateOf = (r: MaquinasRead) => ({ live: "Encendida", running: "Encendida fuera de Plania", capturing: "Tomando la captura", starting: "Encendiendo", failed: "No arrancó", off: "Apagada" })[r.server.phase] ?? "";

// ---- Base de datos

export const FichaBase = ({ read, tables, confirming, acts }: { read: Load<MaquinasRead>; tables: Load<TablesRead>; confirming?: boolean; acts: MaqFichaActs }) => (
  <>
    <Title eyebrow="Máquinas · Base de datos" title={read.data?.base.databases.find((d) => d.app)?.name ?? "Base de datos"} state={read.data ? { on: "Encendida", off: "Apagada", none: "Sin base" }[read.data.base.state] : undefined} />
    {loaded(
      read,
      "la base",
      (r) => {
        const b = r.base;
        return (
          <>
            <Sec title="Bases en este servidor" data="bases">
              <ul className="edi-maq-list">
                {b.databases.map((d) => (
                  <li key={d.name} data-db={d.name}>
                    <code title={d.name}>{d.name}</code>
                    {d.app && <em>la de la app</em>}
                    <small>{bytes(d.size_bytes)}</small>
                  </li>
                ))}
              </ul>
            </Sec>
            <Kv
              rows={[
                ["Conexión", <code key="c">{`${b.host}:${b.port}`}</code>],
                ["Motor", `${b.engine ?? "—"} ${b.version ?? ""}`.trim()],
                ["Servicio", b.service ?? "No es un servicio de brew"],
                ["La lee de", b.env_file ? <code key="e">{b.env_file}</code> : "—"],
              ]}
            />
            <p className="edi-maq-note">Sin contraseña: Plania la usa en memoria y nunca la guarda ni la muestra.</p>
            {b.shared_with.length > 0 && <p className="edi-maq-note">Este Postgres también lo usan {b.shared_with.join(", ")}: apagarlo los apaga.</p>}
            {b.state !== "on" ? (
              <p className="edi-maq-note" data-base-off>
                La base está apagada: enciéndela para ver sus tablas y migraciones.
              </p>
            ) : (
              loaded(tables, "las tablas", (t) => <BaseDatos t={t} confirming={confirming} acts={acts} />)
            )}
          </>
        );
      },
      (r) => (r.base.state === "none" ? "Este piso no tiene una base que Plania encuentre. Su env no nombra una de Postgres en esta Mac." : null),
    )}
  </>
);

const BaseDatos = ({ t, confirming, acts }: { t: TablesRead; confirming?: boolean; acts: MaqFichaActs }) => (
  <>
    <Sec title={`Migraciones${t.migrations.dir ? ` · ${t.migrations.dir}` : ""}`} data="migraciones">
      {t.migrations.files.length ? (
        <ul className="edi-maq-list" data-migrations>
          {t.migrations.files.map((m) => (
            <li key={m.name} data-applied={String(m.applied)}>
              <code title={m.name}>{m.name}</code>
              <small>{m.applied === null ? "sin saber" : m.applied ? "aplicada" : "pendiente"}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="edi-fi-empty">No encontré la carpeta de migraciones.</p>
      )}
      {t.migrations.pending > 0 && (
        <button type="button" className="edi-btn" onClick={acts.onAplicar} disabled={!!acts.busy} data-control="maq-aplicar">
          {acts.busy === "aplicar" ? "…" : `Aplicar ${t.migrations.pending === 1 ? "la pendiente" : `las ${t.migrations.pending} pendientes`}`}
        </button>
      )}
    </Sec>
    <Sec title="Datos" data="datos">
      <p className="edi-fi-p">
        {filas(t.total_rows)} en {t.tables.length} tablas{t.sample ? " · datos de muestra" : ""}.
      </p>
      <ul className="edi-maq-list">
        {t.tables.map((x) => (
          <li key={x.name}>
            <button type="button" className="edi-vlink" onClick={() => acts.onTabla?.(x.name)} title={x.name} data-control="maq-ficha-tabla">
              {x.name}
            </button>
            <small>{filas(x.rows)}</small>
          </li>
        ))}
      </ul>
      {t.total_rows === 0 && (
        <button type="button" className="edi-btn" onClick={acts.onSembrar} disabled={!!acts.busy} data-control="maq-sembrar">
          {acts.busy === "sembrar" ? "…" : "Sembrar datos de muestra"}
        </button>
      )}
    </Sec>
    <Sec title="Vaciar y sembrar de nuevo" data="vaciar">
      {confirming ? (
        <div className="edi-maq-confirm" role="alertdialog" aria-label="Confirmar vaciar y sembrar" data-confirm>
          <p>
            Se borran las {filas(t.total_rows)} de <code>{t.connection.database}</code> y se siembran los datos de muestra otra vez. No se puede deshacer.
          </p>
          <div className="edi-fi-acts">
            <button type="button" className="edi-btn edi-maq-danger" onClick={() => acts.onVaciar?.(t.total_rows)} disabled={!!acts.busy} data-control="maq-vaciar-si">
              {acts.busy === "vaciar" ? "…" : `Vaciar ${filas(t.total_rows)} y sembrar`}
            </button>
            <button type="button" className="edi-btn" onClick={acts.onVaciarCancelar} data-control="maq-vaciar-no">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="edi-fi-p">Solo en esta base local. Es lo único que Plania escribe en ella.</p>
          <button type="button" className="edi-btn" onClick={acts.onVaciarPedir} disabled={!!acts.busy} data-control="maq-vaciar">
            Vaciar y sembrar de nuevo
          </button>
        </>
      )}
    </Sec>
  </>
);

// ---- one table

export const FichaTabla = ({ name, tables, acts }: { name: string; tables: Load<TablesRead>; acts: MaqFichaActs }) => {
  const t: Table | undefined = tables.data?.tables.find((x) => x.name === name);
  return (
    <>
      <Title eyebrow="Máquinas · Tabla" title={name} state={t ? filas(t.rows) : undefined} />
      {loaded(
        tables,
        "la tabla",
        (d) => {
          const x = d.tables.find((y) => y.name === name)!;
          const from = d.migrations.files.find((m) => m.applied)?.name ?? null;
          return (
            <>
              <Sec title="Columnas" data="columnas">
                <ul className="edi-maq-cols" data-cols>
                  {x.columns.map((c) => (
                    <li key={c.name} data-col={c.name}>
                      <code className="edi-maq-cname" title={c.name}>
                        {c.name}
                      </code>
                      <span className="edi-maq-ctype" data-type>
                        {c.type}
                        {c.not_null ? "" : " · opcional"}
                      </span>
                      <span className="edi-maq-ctags">
                        {c.key && <em>llave</em>}
                        {c.unique && <em>única</em>}
                        {c.references && (
                          <button type="button" className="edi-vlink" onClick={() => acts.onTabla?.(c.references!.table)} data-control="maq-ref">
                            → {c.references.table}.{c.references.column}
                          </button>
                        )}
                        {c.hidden && <em>se muestra (oculto)</em>}
                      </span>
                    </li>
                  ))}
                </ul>
              </Sec>
              <Sec title="Relaciones" data="relaciones">
                {x.relations.length ? (
                  <ul className="edi-maq-list">
                    {x.relations.map((rel) => (
                      <li key={rel.column}>
                        <code>{rel.column}</code>
                        <small>
                          → {rel.table}.{rel.foreign}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="edi-fi-empty">Ninguna columna apunta a otra tabla.</p>
                )}
              </Sec>
              <Sec title="Índices" data="indices">
                <ul className="edi-maq-list">
                  {x.indexes.map((i) => (
                    <li key={i.name}>
                      <code title={i.definition}>{i.name}</code>
                    </li>
                  ))}
                </ul>
              </Sec>
              {from && <p className="edi-maq-note">Viene de las migraciones en {d.migrations.dir ?? "el repo"} (la primera aplicada es {from}).</p>}
            </>
          );
        },
        (d) => (d.tables.some((y) => y.name === name) ? null : `No hay una tabla ${name} en esta base.`),
      )}
    </>
  );
};

// ---- Llaves

export const FichaLlaves = ({ llaves }: { llaves: Load<LlavesRead> }) => (
  <>
    <Title eyebrow="Máquinas · Llaves" title="Variables de la app" state={llaves.data ? `${llaves.data.set} de ${llaves.data.llaves.length} puestas` : undefined} />
    {loaded(
      llaves,
      "las llaves",
      (l) => (
        <>
          <p className="edi-maq-note">
            Solo nombres. Plania nunca muestra ni guarda un valor. {l.env_file ? <>La app las lee de <code>{l.env_file}</code>{l.where === "repo" ? " en tu repo" : " en la copia de prueba"}.</> : "No encontré el archivo de variables de la app."}
          </p>
          <ul className="edi-maq-keys" data-llaves>
            {l.llaves.map((k) => (
              <li key={k.name} data-set={String(k.set)}>
                <span className="edi-maq-key" aria-hidden />
                <code title={k.name}>{k.name}</code>
                <small>{k.set ? "puesta" : "falta"}</small>
              </li>
            ))}
          </ul>
          {l.example_file && <p className="edi-maq-note">Lista sacada de {l.example_file} y del código.</p>}
        </>
      ),
      (l) => (l.llaves.length ? null : "La app no pide variables (no hay archivo de ejemplo ni lecturas de process.env)."),
    )}
  </>
);

// ---- Pruebas

export const FichaPruebas = ({ pruebas, acts }: { pruebas: Load<PruebasRead>; acts: MaqFichaActs }) => (
  <>
    <Title eyebrow="Máquinas · Pruebas" title="Pruebas" state={pruebas.data?.running ? "Corriendo…" : pruebas.data?.last ? (pruebas.data.last.ok ? "En verde" : "Fallan") : undefined} />
    {loaded(pruebas, "las pruebas", (p) => (
      <>
        <ul className="edi-maq-list">
          {p.commands.map((c) => (
            <li key={c.name}>
              <b>{c.name}</b>
              <code title={c.command}>{c.command}</code>
            </li>
          ))}
        </ul>
        {p.reason && <p className="edi-maq-note">{p.reason}</p>}
        <div className="edi-fi-acts">
          <button type="button" className="edi-btn edi-btn-primary" onClick={acts.onPruebas} disabled={!p.can || !!p.running || acts.busy === "pruebas"} data-control="maq-correr-pruebas">
            {p.running ? `Corriendo ${p.running.step ?? ""}…` : "Correr las pruebas"}
          </button>
        </div>
        {p.last ? (
          <Sec title="La última vez" data="ultima">
            <p className="edi-fi-p" data-last={p.last.ok ? "pass" : "fail"}>
              {p.last.ok ? "Pasaron" : "Fallaron"}
              {p.last.passed !== null && ` · ${p.last.passed} pasan`}
              {p.last.failed ? ` · ${p.last.failed} fallan` : ""} · {Math.round(p.last.duration_ms / 1000)} s
            </p>
            {p.last.steps.map((s) => (
              <div key={s.name} className="edi-maq-step" data-ok={String(s.ok)}>
                <b>
                  {s.name} · {s.ok ? "bien" : `falló (código ${s.code ?? "?"})`}
                </b>
                {!s.ok && s.tail.length > 0 && <pre className="edi-vdetail">{s.tail.join("\n")}</pre>}
              </div>
            ))}
          </Sec>
        ) : (
          <p className="edi-fi-empty" data-state="empty">
            Todavía no se han corrido desde aquí.
          </p>
        )}
      </>
    ))}
  </>
);

// ---- Cómo probarla

export const FichaProbar = ({ recorrido, ticks, password, page, acts }: { recorrido: Load<RecorridoRead>; ticks: number[]; password?: string | null; page?: string | null; acts: MaqFichaActs }) => (
  <>
    <Title eyebrow="Máquinas · Cómo probarla" title="Recorrido de prueba" state={recorrido.data ? `${ticks.length} de ${recorrido.data.steps.length} hechos` : undefined} />
    {loaded(
      recorrido,
      "el recorrido",
      (r) => (
        <>
          {r.user && (
            <Sec title="Usuario de prueba" data="usuario">
              <p className="edi-fi-p">
                <code>{r.user}</code>
              </p>
              {password && (
                <p className="edi-maq-note" data-password>
                  Contraseña nueva: <code>{password}</code> (solo se muestra esta vez)
                </p>
              )}
              {r.can_password && (
                <button type="button" className="edi-btn" onClick={acts.onContrasena} disabled={acts.busy === "contrasena"} data-control="maq-contrasena">
                  {acts.busy === "contrasena" ? "…" : "Copiar una nueva"}
                </button>
              )}
            </Sec>
          )}
          {r.from === "pages" && <p className="edi-maq-note">Todavía no hay un «Recorrido de prueba»: el PO lo escribe con lo aceptado. Mientras, una parada por página.</p>}
          <ol className="edi-maq-walk" data-walk={r.from}>
            {r.steps.map((s) => {
              const done = ticks.includes(s.n);
              return (
                <li key={s.n} data-done={done || undefined} data-here={(s.page && s.page === page) || undefined}>
                  <label>
                    <input type="checkbox" checked={done} onChange={() => acts.onTick?.(s.n, !done)} data-control="maq-paso" />
                    <span>{s.text}</span>
                  </label>
                  <span className="edi-maq-wacts">
                    {s.page && (
                      <button type="button" className="edi-vlink" onClick={() => acts.onIr?.(s)} data-control="maq-ir">
                        Ir
                      </button>
                    )}
                    <button type="button" className="edi-vlink" onClick={() => acts.onFallo?.(s)} data-control="maq-fallo">
                      Algo falló
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      ),
      (r) => (r.steps.length ? null : "No hay pasos: el piso no tiene páginas ni un «Recorrido de prueba»."),
    )}
  </>
);
