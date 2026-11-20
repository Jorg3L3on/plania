// PLA-I62-8: Máquinas (board D2), the project's services, the building's lower level redrawn with the same reads and
// calls (lib/maquinas.ts maqView). The app (its last capture or live, Computadora / Teléfono, its pages, Tomar
// captura, Abrir); Servidor (state in words, Encender / Apagar / Reiniciar / Reintentar, address, last log line and
// the log); Base de datos (Encender / Apagar; Más: Aplicar migraciones, Sembrar, and Vaciar y sembrar apart, with its
// consequence and a confirmation that names the rows); its tables (rows of one, the map); Llaves; Pruebas (Correr);
// the test walk (Cómo probarla, ticks, Copiar una contraseña nueva, Algo falló → Pedir). States: sin configurar,
// apagada, encendiendo, encendida, no arrancó. The state is always said in words, never by colour alone.
// PLA-I2-10: its words in lib/maquinas-words.ts, in both languages.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, type OrgProject } from "@/lib/api";
import { bytes, filas, maqView, pedirFallo, serverUp, setupLine, tickKey, type MaquinasRead, type Paso } from "@/lib/maquinas";
import type { CapturesRead } from "@/lib/ventana";
import { Btn, Label, Opt, ReadError } from "./parts";
import { noDisponible } from "@/lib/sistema";
import { words } from "@/lib/i18n";
import { MAQUINAS_WORDS } from "@/lib/maquinas-words";

const ERR = (e: unknown, what: string) => (e instanceof ApiError ? `${what} (${e.code}).` : words(MAQUINAS_WORDS).errAsleep(what));
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

// PLA-116: one key of Llaves. Falta offers Poner, Puesta offers Cambiar; the field is a password field (Mostrar
// toggles it) and the value leaves the browser once, in the save. Nothing reads it back.
const LlaveRow = ({ slug, name, set, file, serverUp: up }: { slug: string; name: string; set: boolean; file: string | null; serverUp: boolean }) => {
  const w = words(MAQUINAS_WORDS);
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    setValue("");
    setShow(false);
  };
  const save = useMutation({
    mutationFn: () => api.ponerLlave(slug, name, value),
    onSuccess: (read) => {
      client.setQueryData(["maq-llaves", slug], read);
      close();
      toast.success(w.keySaved(name), up ? { description: w.keyRestart, duration: 8000 } : undefined);
    },
    onError: (e) => toast.error(e instanceof ApiError && typeof e.detail.hint === "string" ? `${w.keyErr}: ${e.detail.hint}` : ERR(e, w.keyErr)),
  });
  return (
    <li className="cor-row cor-llave" data-llave={name} data-open={open ? "1" : undefined}>
      <div className="cor-llave-line">
        <span className="cor-mono cor-ellipsis" style={{ flex: 1 }}>
          {name}
        </span>
        <span className={`cor-state ${set ? "ok" : "bad"}`}>{set ? w.keySet : w.keyMissing}</span>
        {!open && (
          <Btn kind="link" small onClick={() => setOpen(true)} data-control="llave-poner" aria-label={`${set ? w.keyChange : w.keyPut} ${name}`}>
            {set ? w.keyChange : w.keyPut}
          </Btn>
        )}
      </div>
      {open && (
        <form
          className="cor-llave-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() && !save.isPending) save.mutate();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className="cor-llave-field">
            <input
              ref={field}
              className="cor-input cor-mono"
              type={show ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              aria-label={w.keyField(name)}
              data-campo="llave-valor"
            />
            <Btn kind="link" small onClick={() => setShow(!show)} aria-pressed={show} data-control="llave-mostrar">
              {show ? w.keyHide : w.keyShow}
            </Btn>
          </div>
          <span className="cor-cap">{w.keyWhere(file)}</span>
          <div className="cor-llave-actions">
            <Btn kind="primary" small type="submit" disabled={!value.trim() || save.isPending} data-control="llave-guardar">
              {w.keySave}
            </Btn>
            <Btn small onClick={close} data-control="llave-cancelar">
              {w.keyCancel}
            </Btn>
          </div>
        </form>
      )}
    </li>
  );
};

export const Maquinas = ({ p, onPedir, focus, onFocus }: { p: OrgProject; onPedir: (text: string) => void; focus: string | null; onFocus: (what: string | null) => void }) => {
  const client = useQueryClient();
  const w = words(MAQUINAS_WORDS);
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

  if (read.isError && !r) return <ReadError what={w.readWhat} onRetry={() => void read.refetch()} />;
  if (!r || !v) return <div className="cor-skel" style={{ height: 400 }} role="status" aria-busy="true" aria-label={w.reading} />;

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
            {v.state === "on" ? w.head.on : v.state === "unavailable" ? noDisponible().unavailable : v.state === "unconfigured" ? w.head.unconfigured : v.state === "no-code" ? w.head.noCode : v.state === "starting" ? w.head.starting : v.state === "failed" ? w.head.failed : v.state === "base-down" ? w.head.baseDown : w.head.off}{" "}
            <span className="cor-cap">{w.tag}</span>
          </h2>
          <span className="cor-segbox" role="group" aria-label={w.size}>
            <Opt on={size === "desktop"} onClick={() => setSize("desktop")} data-size="desktop">
              {w.desktop}
            </Opt>
            <Opt on={size === "phone"} onClick={() => setSize("phone")} data-size="phone">
              {w.phone}
            </Opt>
          </span>
        </div>
        <div className="cor-card cor-appwin" data-window={v.window}>
          <div className="cor-appbar">
            <Light on={live} word={live ? w.live : v.word} tone={live ? "ok" : v.state === "failed" ? "bad" : undefined} />
            <span className="cor-urlbox cor-mono cor-ellipsis">{url ?? v.say}</span>
            <Btn kind="secondary" disabled={!live || busy === "captura"} onClick={() => act("captura", w.errCapture, () => api.prueba(s, "tomar"))} data-control="maq-captura">
              {busy === "captura" ? w.taking : w.take}
            </Btn>
            {url && live ? (
              <a className="cor-btn primary" href={url} target="_blank" rel="noreferrer" data-control="maq-abrir">
                {w.open}
              </a>
            ) : v.state === "unconfigured" ? (
              <Btn kind="primary" disabled={busy === "configurar"} onClick={() => act("configurar", w.errConfigure, () => api.configurar(s))} data-control="maq-configurar">
                {w.configure}
              </Btn>
            ) : (
              v.server.lever &&
              !v.server.lever.on && (
                <Btn kind="primary" disabled={!!busy} onClick={() => act(`server:${v.server.lever!.act}`, w.errTurnOn, () => api.prueba(s, "encender"))} data-control="maq-encender">
                  {v.server.lever.label}
                </Btn>
              )
            )}
          </div>
          {r.pages.length > 0 && (
            <div className="cor-seg cor-appages" role="group" aria-label={w.pages}>
              {r.pages.slice(0, 5).map((x) => (
                <Opt key={x.key} on={(pg?.key ?? r.pages[0]?.key) === x.key} onClick={() => setPage(x.key)} data-page={x.key}>
                  {x.label}
                </Opt>
              ))}
            </div>
          )}
          <div className={`cor-appview ${size}`}>
            {still ? (
              <img src={still.image_url} alt={w.stillAlt(pg?.label ?? null, size === "phone")} />
            ) : (
              <div className="cor-noshot">
                <b>{v.word}</b>
                <span className="cor-text">{v.state === "unconfigured" || v.state === "no-code" ? setupLine(r) : v.state === "failed" ? (r.server.error ?? v.say) : live ? w.takeToSee : v.say}</span>
              </div>
            )}
          </div>
        </div>
        <div className="cor-card cor-recorrido" data-recorrido>
          <span className="cor-text">
            <b>{w.walk}</b> · {w.stepsDone(ticks.length, steps.length)}
            {(recorrido.data?.user ?? r.test_user) && (
              <>
                {" "}
                · {w.user} <span className="cor-mono">{recorrido.data?.user ?? r.test_user}</span>
              </>
            )}
            {password && (
              <>
                {" "}
                · {w.password} <span className="cor-mono" data-password>{password}</span>
              </>
            )}
          </span>
          {recorrido.data?.can_password && (
            <Btn kind="quiet" disabled={busy === "contrasena"} onClick={() => act("contrasena", w.errPassword, () => api.contrasena(s), (o) => setPassword((o as { password: string }).password))} data-control="maq-contrasena">
              {w.newPassword}
            </Btn>
          )}
          {firstOpen && (
            <Btn kind="quiet" onClick={() => onPedir(pedirFallo(firstOpen))} data-control="maq-fallo">
              {w.failedStep}
            </Btn>
          )}
          <Btn kind="secondary" aria-expanded={focus === "probar"} onClick={() => onFocus(focus === "probar" ? null : "probar")} data-control="maq-probar">
            {w.howToTest}
          </Btn>
        </div>
      </div>
      <aside className="cor-maq-side">
        {sideFocus ? (
          <section className="cor-card cor-maq-panel" data-panel={focus}>
            <div className="cor-side-head">
              <Label as="h2">{tabla ? w.table(tabla) : focus === "registro" ? w.log : focus === "llaves" ? w.llaves : focus === "pruebas" ? w.pruebas : focus === "mapa" ? w.map : w.howToTest}</Label>
              <Btn kind="quiet" onClick={() => onFocus(null)} data-control="maq-cerrar">
                {w.close}
              </Btn>
            </div>
            <div className="cor-maq-scroll" tabIndex={0} aria-label={w.detail}>
              {focus === "registro" && <pre className="cor-code">{(log.data?.lines ?? []).slice(-40).join("\n") || w.noLines}</pre>}
              {focus === "llaves" && (
                <ul>
                  {(llaves.data?.llaves ?? []).map((l) => (
                    <LlaveRow key={l.name} slug={s} name={l.name} set={l.set} file={llaves.data?.env_file ?? null} serverUp={serverUp(r.server.phase)} />
                  ))}
                  {llaves.data && !llaves.data.llaves.length && <li className="cor-text">{w.noKeys}</li>}
                </ul>
              )}
              {focus === "pruebas" && (
                <>
                  {pruebas.data?.running ? <p className="cor-state live">{w.running(pruebas.data.running.step)}</p> : null}
                  {(pruebas.data?.last?.steps ?? []).map((st) => (
                    <div key={st.name} className="cor-row">
                      <span className={`cor-state ${st.ok ? "ok" : "bad"}`}>{st.ok ? w.passes : w.fails}</span>
                      <span className="cor-ellipsis">{st.name}</span>
                      <span className="cor-cap">{st.passed !== null ? w.okBad(st.passed, st.failed) : ""}</span>
                    </div>
                  ))}
                  {!pruebas.data?.last && !pruebas.data?.running && <p className="cor-text">{w.notRunYet}</p>}
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
                          {w.go}
                        </Btn>
                      )}
                    </li>
                  ))}
                  {!steps.length && <li className="cor-text">{w.noWalk}</li>}
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
                    <div className="cor-rows" role="table" aria-label={w.rowsOf(tabla)}>
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
                        {w.previous}
                      </Btn>
                      <span className="cor-cap">{w.range(offset + 1, Math.min(offset + rows.data.limit, rows.data.total), rows.data.total)}</span>
                      <Btn kind="quiet" disabled={offset + rows.data.limit >= rows.data.total} onClick={() => setOffset(offset + rows.data.limit)}>
                        {w.next}
                      </Btn>
                    </div>
                  </>
                ) : (
                  <p className="cor-text">{baseOn ? w.readingRows : w.baseOff}</p>
                ))}
            </div>
          </section>
        ) : (
          <>
            <section className="cor-card cor-maq-card" data-card="servidor">
              <div className="cor-maq-head">
                <span>
                  <b>{w.server}</b>
                  <Light on={v.server.light === "on"} word={v.server.word} tone={v.server.light === "on" ? "ok" : v.server.light === "error" ? "bad" : v.server.light === "starting" ? "live" : undefined} />
                </span>
                {v.server.lever?.on && (
                  <Btn kind="quiet" disabled={!!busy} onClick={() => act("server:reiniciar", w.errRestart, () => api.reiniciar(s))} data-control="maq-reiniciar">
                    {w.restart}
                  </Btn>
                )}
                {v.server.lever && (
                  <Btn kind="secondary" disabled={!!busy} onClick={() => act(`server:${v.server.lever!.act}`, v.server.lever!.act === "apagar" ? w.errTurnOff : w.errTurnOn, () => api.prueba(s, v.server.lever!.act === "apagar" ? "apagar" : "encender"))} data-control={`maq-${v.server.lever.act}`}>
                    {v.server.lever.label}
                  </Btn>
                )}
              </div>
              <dl className="cor-kv">
                <div>
                  <dt>{w.address}</dt>
                  <dd className="cor-mono cor-ellipsis">{v.server.sub || "—"}</dd>
                </div>
                <div>
                  <dt>{w.lastLine}</dt>
                  <dd className="cor-mono cor-ellipsis" title={lastLine ?? undefined}>
                    {lastLine ?? "—"}
                  </dd>
                </div>
              </dl>
              <div className="cor-maq-foot">
                <span className="cor-cap">{v.server.outside ? w.outside : w.idle}</span>
                <Btn kind="link" onClick={() => onFocus("registro")} data-control="maq-registro">
                  {w.seeLog}
                </Btn>
              </div>
            </section>
            <section className="cor-card cor-maq-card" data-card="base">
              <div className="cor-maq-head">
                <span>
                  <b>{w.base}</b>
                  <Light on={baseOn} word={`${v.base.word}${tbl ? (tbl.migrations.pending ? w.pendingSuffix(tbl.migrations.pending) : w.upToDate) : ""}`} tone={baseOn ? "ok" : undefined} />
                </span>
                {v.base.lever && (
                  <Btn kind="secondary" disabled={!!busy} onClick={() => act(`base:${v.base.lever!.act}`, v.base.lever!.act === "apagar" ? w.errBaseOff : w.errBaseOn, () => api.baseLever(s, v.base.lever!.act))} title={v.base.warn ?? undefined} data-control={`maq-base-${v.base.lever.act}`}>
                    {v.base.lever.label}
                  </Btn>
                )}
                <div className="cor-menu" ref={menu}>
                  <Btn kind="secondary" aria-haspopup="menu" aria-expanded={more} disabled={!baseOn} onClick={() => (setMore((x) => !x), setConfirming(false))} data-control="maq-mas">
                    {w.more}
                  </Btn>
                  {more && (
                    <div className="cor-menu-list down right" role="menu">
                      <Btn kind="quiet" role="menuitem" disabled={!!busy} onClick={() => (setMore(false), act("aplicar", w.errApply, () => api.migrar(s)))} data-control="maq-migrar">
                        {w.apply}
                      </Btn>
                      <Btn kind="quiet" role="menuitem" disabled={!!busy} onClick={() => (setMore(false), act("sembrar", w.errSeed, () => api.sembrar(s)))} data-control="maq-sembrar">
                        {w.seed}
                      </Btn>
                      <div className="cor-danger" data-vaciar>
                        <span className="cor-label" style={{ color: "var(--cor-red)" }}>
                          {w.erases}
                        </span>
                        <p className="cor-cap">{w.eraseWhat}</p>
                        {confirming ? (
                          <>
                            <p className="cor-text" role="alert">{w.erasing(tbl ? filas(tbl.total_rows) : null, tbl?.connection.database ?? null)}</p>
                            <span className="cor-acts">
                              <Btn kind="danger" disabled={!!busy} onClick={() => act("vaciar", w.errEmpty, () => api.vaciarYSembrar(s, tbl?.total_rows ?? 0), () => (setConfirming(false), setMore(false), toast.success(w.seededAgain)))} data-control="maq-vaciar-si">
                                {w.yesErase}
                              </Btn>
                              <Btn kind="quiet" onClick={() => setConfirming(false)}>
                                {w.cancel}
                              </Btn>
                            </span>
                          </>
                        ) : (
                          <Btn kind="danger" onClick={() => setConfirming(true)} data-control="maq-vaciar">
                            {w.emptyAndSeed}
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
                  <dt>{w.migrations}</dt>
                  <dd className="cor-mono">{tbl ? w.appliedPending(tbl.migrations.applied, tbl.migrations.pending) : "—"}</dd>
                </div>
                <div>
                  <dt>{w.dbSize}</dt>
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
                    {w.seeAll}
                  </Btn>
                </div>
              )}
            </section>
            <section className="cor-card cor-maq-card" data-card="llaves-pruebas">
              <div className="cor-maq-head">
                <span className="cor-text cor-inline-head">
                  <b>{w.llaves}</b> · {llaves.data ? w.keysSet(llaves.data.set, llaves.data.set + llaves.data.missing) : "—"}
                </span>
                <Btn kind="link" onClick={() => onFocus("llaves")} data-control="maq-llaves">
                  {llaves.data?.missing ? w.seeMissing : w.seeKeys}
                </Btn>
              </div>
              <div className="cor-maq-head">
                <span className="cor-text cor-inline-head">
                  <b>{w.pruebas}</b> ·{" "}
                  {pruebas.data?.running ? w.runningLower : pruebas.data?.last ? (pruebas.data.last.ok ? w.pass(pruebas.data.last.passed) : w.fail(pruebas.data.last.failed)) : w.neverRun}
                </span>
                <Btn kind="secondary" disabled={!pruebas.data?.can || !!pruebas.data?.running || busy === "pruebas"} title={pruebas.data?.reason ?? undefined} onClick={() => act("pruebas", w.errRun, () => api.correrPruebas(s))} data-control="maq-correr">
                  {w.run}
                </Btn>
                {pruebas.data?.last && (
                  <Btn kind="link" onClick={() => onFocus("pruebas")}>
                    {w.see}
                  </Btn>
                )}
              </div>
            </section>
            <p className="cor-cap">{w.foot}</p>
          </>
        )}
      </aside>
    </div>
  );
};
