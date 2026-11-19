// PLA-I62-8: Máquinas (board D2), the project's services, the building's lower level redrawn with the same reads and
// calls (lib/maquinas.ts maqView). The app (its last capture or live, Computadora / Teléfono, its pages, Tomar
// captura, Abrir); Servidor (state in words, Encender / Apagar / Reiniciar / Reintentar, address, last log line and
// the log); Base de datos (Encender / Apagar; Más: Aplicar migraciones, Sembrar, and Vaciar y sembrar apart, with its
// consequence and a confirmation that names the rows); its tables (rows of one, the map); Llaves; Pruebas (Correr);
// the test walk (Cómo probarla, ticks, Copiar una contraseña nueva, Algo falló → Pedir). States: sin configurar,
// apagada, encendiendo, encendida, no arrancó. The state is always said in words, never by colour alone.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, type OrgProject } from "@/lib/api";
import { bytes, filas, maqView, pedirFallo, setupLine, tickKey, type MaquinasRead, type Paso } from "@/lib/maquinas";
import type { CapturesRead } from "@/lib/ventana";
import { Btn, Label, Opt, ReadError } from "./parts";

const ERR = (e: unknown, what: string) => (e instanceof ApiError ? `${what} (${e.code}).` : `${what}. Si la Mac está dormida, intenta al despertar.`);
const readTicks = (k: string): number[] => {
  try {
    const v = JSON.parse(window.localStorage.getItem(k) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
};

const Light = ({ on, word, tone }: { on: boolean; word: string; tone: "ok" | "bad" | "live" | undefined }) => (
  <span className={`cor-state ${tone ?? ""}`} data-light={on ? "on" : "off"}>
    {on ? "● " : "○ "}
    {word}
  </span>
);

export const Maquinas = ({ p, onPedir, focus, onFocus }: { p: OrgProject; onPedir: (text: string) => void; focus: string | null; onFocus: (what: string | null) => void }) => {
  const client = useQueryClient();
  const s = p.slug;
  const [page, setPage] = useState<string | null>(null);
  const [size, setSize] = useState<"desktop" | "phone">("desktop");
  const [more, setMore] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const menu = useRef<HTMLDivElement>(null);
  const read = useQuery<MaquinasRead>({
    queryKey: ["maquinas", s],
    queryFn: () => api.maquinas(s),
    refetchInterval: (x) => (x.state.data?.server.phase === "starting" || x.state.data?.server.phase === "capturing" ? 1500 : 15_000),
    retry: 1,
  });
  const r = read.data;
  const v = r ? maqView(r) : null;
  const baseOn = r?.base.state === "on";
  const tables = useQuery({ queryKey: ["maq-tablas", s], queryFn: () => api.tablas(s), enabled: !!baseOn, staleTime: 10_000, retry: 0 });
  const tabla = focus?.startsWith("tabla:") ? focus.slice(6) : null;
  const rows = useQuery({ queryKey: ["maq-filas", s, tabla, offset], queryFn: () => api.filas(s, tabla!, offset), enabled: !!tabla && !!baseOn, retry: 0 });
  const captures = useQuery<CapturesRead>({ queryKey: ["captures", s], queryFn: () => api.captures(s), enabled: !!r?.configured, retry: 0 });
  const llaves = useQuery({ queryKey: ["maq-llaves", s], queryFn: () => api.llaves(s), staleTime: 30_000, retry: 0 });
  const pruebas = useQuery({ queryKey: ["maq-pruebas", s], queryFn: () => api.pruebas(s), refetchInterval: (x) => (x.state.data?.running ? 2000 : false), retry: 0 });
  const log = useQuery({ queryKey: ["maq-bitacora", s], queryFn: () => api.bitacora(s), enabled: !!r?.configured, refetchInterval: 5000, retry: 0 });
  const recorrido = useQuery({ queryKey: ["maq-recorrido", s], queryFn: () => api.recorrido(s), retry: 0 });
  const tk = tickKey(s, recorrido.data?.doc_id ?? null);
  const [ticks, setTicks] = useState<number[]>([]);
  useEffect(() => setTicks(readTicks(tk)), [tk]);
  useEffect(() => {
    if (!more) return;
    const onDown = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && (setMore(false), setConfirming(false));
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [more]);
  const refresh = () => {
    for (const k of ["maquinas", "captures", "maq-tablas", "maquinas-tablero", "maq-pruebas"]) void client.invalidateQueries({ queryKey: [k, s] });
    void client.invalidateQueries({ queryKey: ["maquinas-tablero"] });
  };
  const run = useMutation({
    mutationFn: async (x: { key: string; call: () => Promise<unknown>; what: string; then?: (o: unknown) => void }) => {
      const out = await x.call();
      x.then?.(out);
    },
    onMutate: (x) => setBusy(x.key),
    onError: (e, x) => toast.error(ERR(e, x.what)),
    onSettled: () => {
      setBusy(null);
      refresh();
    },
  });
  const act = (key: string, what: string, call: () => Promise<unknown>, then?: (o: unknown) => void) => run.mutate({ key, what, call, then });

  if (read.isError && !r) return <ReadError what="las máquinas del proyecto" onRetry={() => void read.refetch()} />;
  if (!r || !v) return <div className="cor-skel" style={{ height: 400 }} role="status" aria-busy="true" aria-label="Leyendo las máquinas" />;

  const pages = captures.data?.pages ?? [];
  const pg = pages.find((x) => x.key === (page ?? r.pages[0]?.key)) ?? pages[0] ?? null;
  const still = pg ? pg[size].still : null;
  const url = r.server.url ? `${r.server.url.replace(/\/$/, "")}${pg?.path ?? ""}` : null;
  const live = v.window === "live";
  const tbl = tables.data;
  const lastLine = log.data?.lines.at(-1) ?? null;
  const steps = recorrido.data?.steps ?? [];
  const tick = (n: number, done: boolean) => {
    const next = done ? [...new Set([...ticks, n])] : ticks.filter((x) => x !== n);
    setTicks(next);
    try {
      window.localStorage.setItem(tk, JSON.stringify(next));
    } catch {
      /* nothing kept */
    }
  };
  const firstOpen: Paso | undefined = steps.find((x) => !ticks.includes(x.n));
  const sideFocus = focus === "registro" || focus === "llaves" || focus === "pruebas" || focus === "probar" || focus === "mapa" || !!tabla;

  return (
    <div className="cor-maq" data-maquinas={v.state}>
      <div className="cor-maq-main">
        <div className="cor-pedidos-head" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <h2 className="cor-h3" style={{ fontSize: 22 }}>
            {v.state === "on" ? "La app está encendida" : v.state === "unconfigured" ? "La app no sabe cómo encenderse" : v.state === "no-code" ? "Todavía no hay app" : v.state === "starting" ? "La app está encendiendo" : v.state === "failed" ? "La app no arrancó" : v.state === "base-down" ? "La app no llega a su base" : "La app está apagada"}{" "}
            <span className="cor-cap">COPIA DE PRUEBA · EN TU MAC</span>
          </h2>
          <span className="cor-segbox" role="group" aria-label="Tamaño">
            <Opt on={size === "desktop"} onClick={() => setSize("desktop")} data-size="desktop">
              Computadora
            </Opt>
            <Opt on={size === "phone"} onClick={() => setSize("phone")} data-size="phone">
              Teléfono
            </Opt>
          </span>
        </div>
        <div className="cor-card cor-appwin" data-window={v.window}>
          <div className="cor-appbar">
            <Light on={live} word={live ? "En vivo" : v.word} tone={live ? "ok" : v.state === "failed" ? "bad" : undefined} />
            <span className="cor-urlbox cor-mono cor-ellipsis">{url ?? v.say}</span>
            <Btn kind="secondary" disabled={!live || busy === "captura"} onClick={() => act("captura", "No se pudo tomar la captura", () => api.prueba(s, "tomar"))} data-control="maq-captura">
              {busy === "captura" ? "Tomando…" : "Tomar captura"}
            </Btn>
            {url && live ? (
              <a className="cor-btn primary" href={url} target="_blank" rel="noreferrer" data-control="maq-abrir">
                Abrir ↗
              </a>
            ) : v.state === "unconfigured" ? (
              <Btn kind="primary" disabled={busy === "configurar"} onClick={() => act("configurar", "No se pudo configurar", () => api.configurar(s))} data-control="maq-configurar">
                Configurar
              </Btn>
            ) : (
              v.server.lever &&
              !v.server.lever.on && (
                <Btn kind="primary" disabled={!!busy} onClick={() => act(`server:${v.server.lever!.act}`, "No se pudo encender", () => api.prueba(s, "encender"))} data-control="maq-encender">
                  {v.server.lever.label}
                </Btn>
              )
            )}
          </div>
          {r.pages.length > 0 && (
            <div className="cor-seg cor-appages" role="group" aria-label="Páginas">
              {r.pages.slice(0, 5).map((x) => (
                <Opt key={x.key} on={(pg?.key ?? r.pages[0]?.key) === x.key} onClick={() => setPage(x.key)} data-page={x.key}>
                  {x.label}
                </Opt>
              ))}
            </div>
          )}
          <div className={`cor-appview ${size}`}>
            {still ? (
              <img src={still.image_url} alt={`${pg?.label ?? "La app"}, ${size === "desktop" ? "computadora" : "teléfono"}`} />
            ) : (
              <div className="cor-noshot">
                <b>{v.word}</b>
                <span className="cor-text">{v.state === "unconfigured" || v.state === "no-code" ? setupLine(r) : v.state === "failed" ? (r.server.error ?? v.say) : live ? "Toma una captura para verla aquí, o ábrela." : v.say}</span>
              </div>
            )}
          </div>
        </div>
        <div className="cor-card cor-recorrido" data-recorrido>
          <span className="cor-text">
            <b>Recorrido de prueba</b> · {`${ticks.length} de ${steps.length} pasos hechos`}
            {(recorrido.data?.user ?? r.test_user) && (
              <>
                {" "}
                · usuario <span className="cor-mono">{recorrido.data?.user ?? r.test_user}</span>
              </>
            )}
            {password && (
              <>
                {" "}
                · contraseña <span className="cor-mono" data-password>{password}</span>
              </>
            )}
          </span>
          {recorrido.data?.can_password && (
            <Btn kind="quiet" disabled={busy === "contrasena"} onClick={() => act("contrasena", "No se pudo cambiar la contraseña", () => api.contrasena(s), (o) => setPassword((o as { password: string }).password))} data-control="maq-contrasena">
              Copiar una contraseña nueva
            </Btn>
          )}
          {firstOpen && (
            <Btn kind="quiet" onClick={() => onPedir(pedirFallo(firstOpen))} data-control="maq-fallo">
              Algo falló
            </Btn>
          )}
          <Btn kind="secondary" aria-expanded={focus === "probar"} onClick={() => onFocus(focus === "probar" ? null : "probar")} data-control="maq-probar">
            Cómo probarla
          </Btn>
        </div>
      </div>
      <aside className="cor-maq-side">
        {sideFocus ? (
          <section className="cor-card cor-maq-panel" data-panel={focus}>
            <div className="cor-side-head">
              <Label as="h2">{tabla ? `Tabla ${tabla}` : focus === "registro" ? "Registro del servidor" : focus === "llaves" ? "Llaves" : focus === "pruebas" ? "Pruebas" : focus === "mapa" ? "Tablas y mapa" : "Cómo probarla"}</Label>
              <Btn kind="quiet" onClick={() => onFocus(null)} data-control="maq-cerrar">
                Cerrar
              </Btn>
            </div>
            <div className="cor-maq-scroll" tabIndex={0} aria-label="Detalle">
              {focus === "registro" && <pre className="cor-code">{(log.data?.lines ?? []).slice(-40).join("\n") || "Sin líneas todavía."}</pre>}
              {focus === "llaves" && (
                <ul>
                  {(llaves.data?.llaves ?? []).map((l) => (
                    <li key={l.name} className="cor-row">
                      <span className="cor-mono cor-ellipsis" style={{ flex: 1 }}>
                        {l.name}
                      </span>
                      <span className={`cor-state ${l.set ? "ok" : "bad"}`}>{l.set ? "Puesta" : "Falta"}</span>
                    </li>
                  ))}
                  {llaves.data && !llaves.data.llaves.length && <li className="cor-text">No pide llaves.</li>}
                </ul>
              )}
              {focus === "pruebas" && (
                <>
                  {pruebas.data?.running ? <p className="cor-state live">Corriendo{pruebas.data.running.step ? ` · ${pruebas.data.running.step}` : ""}…</p> : null}
                  {(pruebas.data?.last?.steps ?? []).map((st) => (
                    <div key={st.name} className="cor-row">
                      <span className={`cor-state ${st.ok ? "ok" : "bad"}`}>{st.ok ? "Pasa" : "Falla"}</span>
                      <span className="cor-ellipsis">{st.name}</span>
                      <span className="cor-cap">{st.passed !== null ? `${st.passed} ok${st.failed ? ` · ${st.failed} mal` : ""}` : ""}</span>
                    </div>
                  ))}
                  {!pruebas.data?.last && !pruebas.data?.running && <p className="cor-text">Todavía sin correr.</p>}
                </>
              )}
              {focus === "probar" && (
                <ol className="cor-steps">
                  {steps.map((x) => (
                    <li key={x.n}>
                      <label className="cor-check" data-inline-ok>
                        <input type="checkbox" checked={ticks.includes(x.n)} onChange={(e) => tick(x.n, e.target.checked)} />
                        <span>{x.text}</span>
                      </label>
                      {x.page && (
                        <Btn kind="link" onClick={() => setPage(x.page)}>
                          Ir
                        </Btn>
                      )}
                    </li>
                  ))}
                  {!steps.length && <li className="cor-text">No hay recorrido escrito: prueba sus páginas.</li>}
                </ol>
              )}
              {focus === "mapa" && tbl && (
                <ul>
                  {tbl.tables.map((t) => (
                    <li key={t.name}>
                      <button type="button" className="cor-row" onClick={() => onFocus(`tabla:${t.name}`)} data-tabla={t.name}>
                        <span className="cor-mono" style={{ flex: 1 }}>
                          {t.name}
                        </span>
                        <span className="cor-cap">{filas(t.rows)}</span>
                        {t.relations.length > 0 && <span className="cor-cap">{`→ ${t.relations.map((x) => x.table).join(", ")}`}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {tabla &&
                (rows.data ? (
                  <>
                    <div className="cor-rows" role="table" aria-label={`Filas de ${tabla}`}>
                      <div role="row" className="cor-rows-head">
                        {rows.data.columns.slice(0, 4).map((c) => (
                          <span key={c} role="columnheader" className="cor-label">
                            {c}
                          </span>
                        ))}
                      </div>
                      {rows.data.rows.map((row, i) => (
                        <div role="row" key={i}>
                          {rows.data.columns.slice(0, 4).map((c) => (
                            <span key={c} role="cell" className="cor-ellipsis cor-mono">
                              {row[c] ?? "—"}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="cor-acts">
                      <Btn kind="quiet" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - rows.data.limit))}>
                        Anteriores
                      </Btn>
                      <span className="cor-cap">{`${offset + 1}–${Math.min(offset + rows.data.limit, rows.data.total)} de ${rows.data.total}`}</span>
                      <Btn kind="quiet" disabled={offset + rows.data.limit >= rows.data.total} onClick={() => setOffset(offset + rows.data.limit)}>
                        Siguientes
                      </Btn>
                    </div>
                  </>
                ) : (
                  <p className="cor-text">{baseOn ? "Leyendo las filas…" : "La base está apagada."}</p>
                ))}
            </div>
          </section>
        ) : (
          <>
            <section className="cor-card cor-maq-card" data-card="servidor">
              <div className="cor-maq-head">
                <span>
                  <b>Servidor</b>
                  <Light on={v.server.light === "on"} word={v.server.word} tone={v.server.light === "on" ? "ok" : v.server.light === "error" ? "bad" : v.server.light === "starting" ? "live" : undefined} />
                </span>
                {v.server.lever?.on && (
                  <Btn kind="quiet" disabled={!!busy} onClick={() => act("server:reiniciar", "No se pudo reiniciar", () => api.reiniciar(s))} data-control="maq-reiniciar">
                    Reiniciar
                  </Btn>
                )}
                {v.server.lever && (
                  <Btn kind="secondary" disabled={!!busy} onClick={() => act(`server:${v.server.lever!.act}`, v.server.lever!.act === "apagar" ? "No se pudo apagar" : "No se pudo encender", () => api.prueba(s, v.server.lever!.act === "apagar" ? "apagar" : "encender"))} data-control={`maq-${v.server.lever.act}`}>
                    {v.server.lever.label}
                  </Btn>
                )}
              </div>
              <dl className="cor-kv">
                <div>
                  <dt>Dirección</dt>
                  <dd className="cor-mono cor-ellipsis">{v.server.sub || "—"}</dd>
                </div>
                <div>
                  <dt>Última línea</dt>
                  <dd className="cor-mono cor-ellipsis" title={lastLine ?? undefined}>
                    {lastLine ?? "—"}
                  </dd>
                </div>
              </dl>
              <div className="cor-maq-foot">
                <span className="cor-cap">{v.server.outside ? "Se encendió fuera de aquí: aquí solo se mira." : "Se apaga sola a los 20 min sin que mires"}</span>
                <Btn kind="link" onClick={() => onFocus("registro")} data-control="maq-registro">
                  Ver el registro
                </Btn>
              </div>
            </section>
            <section className="cor-card cor-maq-card" data-card="base">
              <div className="cor-maq-head">
                <span>
                  <b>Base de datos</b>
                  <Light on={baseOn} word={`${v.base.word}${tbl ? (tbl.migrations.pending ? ` · ${tbl.migrations.pending} migraciones pendientes` : " · al día") : ""}`} tone={baseOn ? "ok" : undefined} />
                </span>
                {v.base.lever && (
                  <Btn kind="secondary" disabled={!!busy} onClick={() => act(`base:${v.base.lever!.act}`, v.base.lever!.act === "apagar" ? "No se pudo apagar la base" : "No se pudo encender la base", () => api.baseLever(s, v.base.lever!.act))} title={v.base.warn ?? undefined} data-control={`maq-base-${v.base.lever.act}`}>
                    {v.base.lever.label}
                  </Btn>
                )}
                <div className="cor-menu" ref={menu}>
                  <Btn kind="secondary" aria-haspopup="menu" aria-expanded={more} disabled={!baseOn} onClick={() => (setMore((x) => !x), setConfirming(false))} data-control="maq-mas">
                    Más
                  </Btn>
                  {more && (
                    <div className="cor-menu-list down right" role="menu">
                      <Btn kind="quiet" role="menuitem" disabled={!!busy} onClick={() => (setMore(false), act("aplicar", "No se pudo aplicar", () => api.migrar(s)))} data-control="maq-migrar">
                        Aplicar migraciones pendientes
                      </Btn>
                      <Btn kind="quiet" role="menuitem" disabled={!!busy} onClick={() => (setMore(false), act("sembrar", "No se pudo sembrar", () => api.sembrar(s)))} data-control="maq-sembrar">
                        Sembrar datos de muestra
                      </Btn>
                      <div className="cor-danger" data-vaciar>
                        <span className="cor-label" style={{ color: "var(--cor-red)" }}>
                          Borra datos
                        </span>
                        <p className="cor-cap">Borra todas las filas de esta base local y siembra los datos de muestra otra vez. No se puede deshacer.</p>
                        {confirming ? (
                          <>
                            <p className="cor-text" role="alert">{`Se borran ${tbl ? filas(tbl.total_rows) : "todas las filas"} de ${tbl?.connection.database ?? "la base"}.`}</p>
                            <span className="cor-acts">
                              <Btn kind="danger" disabled={!!busy} onClick={() => act("vaciar", "No se pudo vaciar", () => api.vaciarYSembrar(s, tbl?.total_rows ?? 0), () => (setConfirming(false), setMore(false), toast.success("La base tiene otra vez los datos de muestra.")))} data-control="maq-vaciar-si">
                                Sí, borrar y sembrar
                              </Btn>
                              <Btn kind="quiet" onClick={() => setConfirming(false)}>
                                Cancelar
                              </Btn>
                            </span>
                          </>
                        ) : (
                          <Btn kind="danger" onClick={() => setConfirming(true)} data-control="maq-vaciar">
                            Vaciar y sembrar de nuevo
                          </Btn>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {v.base.reason && <p className="cor-cap">{v.base.reason}</p>}
              <dl className="cor-kv">
                <div>
                  <dt>Migraciones</dt>
                  <dd className="cor-mono">{tbl ? `${tbl.migrations.applied} · ${tbl.migrations.pending} pendientes` : "—"}</dd>
                </div>
                <div>
                  <dt>Tamaño</dt>
                  <dd className="cor-mono">{baseOn ? `${bytes(r.base.size_bytes) || "—"}${tbl ? ` · ${filas(tbl.total_rows)}` : ""}` : "—"}</dd>
                </div>
              </dl>
              {tbl && tbl.tables.length > 0 && (
                <div className="cor-maq-foot">
                  <span className="cor-seg">
                    {tbl.tables.slice(0, 1).map((t) => (
                      <Btn key={t.name} kind="secondary" small onClick={() => onFocus(`tabla:${t.name}`)} data-tabla={t.name}>
                        <span className="cor-mono">{`${t.name} · ${t.rows}`}</span>
                      </Btn>
                    ))}
                  </span>
                  <Btn kind="link" onClick={() => onFocus("mapa")} data-control="maq-mapa">
                    Ver todas y el mapa
                  </Btn>
                </div>
              )}
            </section>
            <section className="cor-card cor-maq-card" data-card="llaves-pruebas">
              <div className="cor-maq-head">
                <span className="cor-text cor-inline-head">
                  <b>Llaves</b> · {llaves.data ? `${llaves.data.set} de ${llaves.data.set + llaves.data.missing} puestas` : "—"}
                </span>
                <Btn kind="link" onClick={() => onFocus("llaves")} data-control="maq-llaves">
                  {llaves.data?.missing ? "Ver cuáles faltan" : "Ver las llaves"}
                </Btn>
              </div>
              <div className="cor-maq-head">
                <span className="cor-text cor-inline-head">
                  <b>Pruebas</b> ·{" "}
                  {pruebas.data?.running ? "corriendo…" : pruebas.data?.last ? (pruebas.data.last.ok ? `pasan${pruebas.data.last.passed !== null ? ` (${pruebas.data.last.passed})` : ""}` : `fallan${pruebas.data.last.failed ? ` (${pruebas.data.last.failed})` : ""}`) : "sin correr todavía"}
                </span>
                <Btn kind="secondary" disabled={!pruebas.data?.can || !!pruebas.data?.running || busy === "pruebas"} title={pruebas.data?.reason ?? undefined} onClick={() => act("pruebas", "No se pudieron correr", () => api.correrPruebas(s))} data-control="maq-correr">
                  Correr
                </Btn>
                {pruebas.data?.last && (
                  <Btn kind="link" onClick={() => onFocus("pruebas")}>
                    Ver
                  </Btn>
                )}
              </div>
            </section>
            <p className="cor-cap">Corre en tu Mac, sobre una copia de prueba. Si no enciende, el servidor dice «No arrancó» con el motivo y ofrece «Reintentar».</p>
          </>
        )}
      </aside>
    </div>
  );
};
