// PLA-I72-5: Máquinas, el cuarto de máquinas (pass 10 of the approved canvas). For whoever looks after the project's
// services on this Mac: a summary on top with the «Entrar a tu app» strip (the test user and its kept password, the
// eye, copy, Cambiarla), the shared machines on the left (Esta Mac, Motor de bases, Llaves de la app), one row per
// copy (the start copy and one per open initiative: name and state, its Servidor switch, Borrar la copia, its server,
// its base and its app), the leftovers full width below, and each machine's detail in a drawer (Esc closes it). No
// still of the app, no Tomar captura, no Pruebas and no test walk here: the app opens in its own tab. Rules and words
// in lib/cuarto.ts and lib/maquinas-words.ts (CUARTO_WORDS), tested without a browser.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Database, Eye, EyeOff, Folder, KeyRound, Laptop, Server, X } from "lucide-react";
import { ApiError, api, type OrgProject } from "@/lib/api";
import type { LlavesRead, MaquinasRead, RowsRead, TablesRead } from "@/lib/maquinas";
import {
  appUrl,
  basesList,
  copyName,
  copySub,
  cpuText,
  dayOf,
  diskBars,
  errorLine,
  focusKey,
  focusOf,
  isOn,
  leftLine,
  missingKey,
  pct,
  pillTone,
  pillWord,
  rowState,
  since,
  size,
  sizeText,
  spark,
  summaryOf,
  switchOf,
  type Copia,
  type CopiasRead,
  type EntrarRead,
  type Focus,
  type Numeros,
  type Sobrante,
  type SobrantesRead,
} from "@/lib/cuarto";
import { CUARTO_WORDS } from "@/lib/maquinas-words";
import { words } from "@/lib/i18n";
import { Btn, Logo, ReadError } from "./parts";
import { Revision } from "./revision";

const W = () => words(CUARTO_WORDS);
const errText = (e: unknown, what: string) => (e instanceof ApiError ? (typeof e.detail.hint === "string" && e.detail.hint ? `${what}: ${e.detail.hint}` : W().errAct(what, e.code)) : W().errAsleep(what));
const copyText = async (text: string, said: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* the browser refused: nothing to do */
  }
  toast.success(said);
};
const failedTail = (x: { ok: boolean; steps: { tail: string[] }[] }) => x.steps.at(-1)?.tail.at(-1) ?? null;

type Tone = "ok" | "bad" | "live" | "";
const Dot = ({ tone }: { tone: Tone | "warn" }) => <span className={`cq-dot ${tone}`} aria-hidden />;
const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={`cq-pill ${tone}`}>
    <Dot tone={tone} />
    {children}
  </span>
);
const Num = ({ n, unit }: { n: string; unit?: string }) => (
  <b className="cq-num">
    {n}
    {unit ? <small>{unit}</small> : null}
  </b>
);
const Spark = ({ values, h = 14 }: { values: number[]; h?: number }) => {
  const p = spark(values, h);
  if (!p) return null;
  return (
    <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden>
      <path className="cq-spa" d={p.area} />
      <path className="cq-spk" d={p.line} />
    </svg>
  );
};
const Gauge = ({ label, value, share, warn }: { label: string; value: string; share: number | null; warn?: boolean }) => (
  <span className="cq-gauge">
    <span className="cq-gt">
      <span>{label}</span>
      <b>{value}</b>
    </span>
    <span className="cq-gb" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share ?? 0}>
      <i className={warn ? "warn" : ""} style={{ width: `${share ?? 0}%` }} />
    </span>
  </span>
);
const num = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString());

// ---- the login strip

const Login = ({ slug, read, copias }: { slug: string; read: EntrarRead | undefined; copias: Copia[] }) => {
  const w = W();
  const client = useQueryClient();
  const [show, setShow] = useState(false);
  const [ask, setAsk] = useState(false);
  const change = useMutation({
    mutationFn: () => api.cambiarContrasena(slug),
    onSuccess: (r) => {
      client.setQueryData(["maq-entrar", slug], r);
      setAsk(false);
      setShow(true);
      toast.success(w.changed(r.set_in.length), r.stale.length ? { description: w.staleCopies(r.stale.length) } : undefined);
    },
    onError: (e) => toast.error(errText(e, w.errPassword)),
  });
  if (!read?.user) return null;
  const pw = read.password;
  const stale = read.stale.filter((id) => copias.some((c) => c.id === id));
  return (
    <div className="cq-login" role="group" aria-label={w.login} data-entrar>
      <span className="cq-lt">{w.login}</span>
      <span className="cq-f">
        <span>{w.user}</span>
        <b className="cor-mono cor-ellipsis" data-usuario>
          {read.user}
        </b>
        <button type="button" className="cq-ico" aria-label={w.copyUser} onClick={() => void copyText(read.user!, w.copied)} data-control="copiar-usuario">
          <Copy size={15} aria-hidden />
        </button>
      </span>
      {read.can_password && (
        <span className="cq-f">
          <span>{w.password}</span>
          <b className={`cor-mono ${!pw ? "unset" : !show ? "masked" : ""}`} data-contrasena={show && pw ? "visible" : "oculta"} title={stale.length ? w.staleCopies(stale.length) : undefined}>
            {pw ? (show ? pw : "••••••••••") : w.noPassword}
          </b>
          {pw && (
            <>
              <button type="button" className="cq-ico" aria-pressed={show} aria-label={show ? w.hide : w.show} onClick={() => setShow(!show)} data-control="ojo">
                {show ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
              </button>
              <button type="button" className="cq-ico" aria-label={w.copyPassword} onClick={() => void copyText(pw, w.copied)} data-control="copiar-contrasena">
                <Copy size={15} aria-hidden />
              </button>
            </>
          )}
        </span>
      )}
      {read.can_password &&
        (!pw ? (
          <Btn kind="quiet" small disabled={change.isPending} onClick={() => change.mutate()} data-control="poner-contrasena">
            {w.setOne}
          </Btn>
        ) : ask ? (
          <span className="cq-ask">
            <Btn kind="danger" small disabled={change.isPending} onClick={() => change.mutate()} data-control="cambiar-si">
              {w.changeAll}
            </Btn>
            <Btn kind="quiet" small onClick={() => setAsk(false)} data-control="cambiar-no">
              {w.no}
            </Btn>
          </span>
        ) : (
          <Btn kind="quiet" small onClick={() => setAsk(true)} data-control="cambiarla">
            {w.change}
          </Btn>
        ))}
    </div>
  );
};

// ---- one row per copy

type Act = (key: string, call: () => Promise<unknown>, ok?: () => void) => void;
type RowProps = { slug: string; p: OrgProject; c: Copia; n: Numeros | undefined; ownBases: boolean; open: Focus | null; busy: string | null; onOpen: (f: Focus) => void; act: Act };

const Line = ({ slug, p, c, n, ownBases, open, busy, onOpen, act }: RowProps) => {
  const w = W();
  const [askDel, setAskDel] = useState(false);
  const st = rowState(c);
  const sw = switchOf(c);
  const sn = n?.servers[c.id];
  const bn = n?.bases[c.id];
  const name = copyName(c);
  const url = appUrl(c);
  const copySize = (sn?.disk?.total ?? 0) + (bn?.size_bytes ?? 0);
  const live = st === "on";
  const mem = size(sn?.mem_bytes ?? null);
  const dsk = size(sn?.disk?.total ?? null);
  const bsize = size(bn?.size_bytes ?? null);
  const baseSub = c.kind === "inicio" ? (ownBases ? w.baseCopyOfApp : w.baseOfApp) : w.baseOfStart(dayOf(bn?.origin.at ?? null));
  const pending = bn?.migrations?.pending ?? 0;
  return (
    <div className={`cq-ln ${st === "failed" ? "bad" : ""} ${open?.who === c.id ? "focus" : ""}`} data-copia={c.id} data-estado={st}>
      <div className="cq-idc">
        <div className="cq-idt">
          <div className="cq-nm cor-ellipsis" title={name}>
            {name}
          </div>
          <div className="cq-stage cor-ellipsis">{copySub(c)}</div>
        </div>
        <div className="cq-meta">
          <Pill tone={pillTone(st)}>{pillWord(st)}</Pill>
          {copySize > 0 && <span className="cor-ellipsis">{w.onDisk(sizeText(copySize))}</span>}
        </div>
        <div className="cq-meta">
          <button
            type="button"
            role="switch"
            aria-checked={sw.on}
            className="cq-sw"
            disabled={!sw.can || !!busy || st === "unavailable" || st === "outside"}
            aria-label={w.serverSwitch(name, sw.on)}
            onClick={() => act(`sw:${c.id}`, () => api.copiaAct(slug, c.id, sw.on ? "apagar" : "encender"))}
            data-control="servidor"
          >
            <span className="cq-tr" aria-hidden />
            {w.server}
          </button>
          {c.kind === "iniciativa" && c.made && (
            <Btn kind="quiet" small className="cq-del" onClick={() => setAskDel(true)} data-control="borrar-copia">
              {w.deleteCopy}
            </Btn>
          )}
        </div>
      </div>
      <button type="button" className={`cq-cell ${st === "failed" ? "bad" : ""}`} onClick={() => onOpen({ who: c.id, part: "servidor" })} aria-label={`${w.server} · ${name}`} data-abre="servidor">
        <span className="cq-ch">
          {w.server}
          <span className="cq-sub cor-mono">{c.port ? `localhost:${c.port}` : ""}</span>
          <span className="cq-go">{w.detail}</span>
        </span>
        <span className="cq-tiles t4">
          <span className={`cq-tile ${live ? "" : "dim"}`}>
            <span>{w.cpu}</span>
            <Num n={live ? cpuText(sn?.cpu ?? null) : "—"} unit="%" />
            {live && <Spark values={sn?.cpu_samples ?? []} />}
          </span>
          <span className={`cq-tile ${live ? "" : "dim"}`}>
            <span>{w.mem}</span>
            <Num n={live && mem ? mem.v : "—"} unit={live && mem ? mem.u : "MB"} />
            {live && <Spark values={sn?.mem_samples ?? []} />}
          </span>
          <span className={`cq-tile ${dsk ? "" : "dim"}`}>
            <span>{w.disk}</span>
            <Num n={dsk?.v ?? "—"} unit={dsk?.u ?? ""} />
          </span>
          <span className={`cq-tile ${live ? "" : "dim"}`}>
            <span>{w.up}</span>
            <Num n={live ? since(sn?.uptime_s ?? null) : "—"} />
          </span>
        </span>
        <span className={`cq-foot cor-mono ${st === "failed" ? "err" : ""}`}>{st === "failed" ? (sn?.line ?? c.error ?? "") : st === "never" ? w.noCopyYet : (sn?.line ?? "")}</span>
      </button>
      <button type="button" className="cq-cell" onClick={() => onOpen({ who: c.id, part: "base" })} aria-label={`${w.base} · ${name}`} data-abre="base" disabled={!c.database}>
        <span className="cq-ch">
          {w.base}
          <span className="cq-sub cor-mono">{c.database ? baseSub : ""}</span>
          {c.database && <span className="cq-go">{w.detail}</span>}
        </span>
        {c.database ? (
          <>
            <span className="cq-tiles t3">
              <span className={`cq-tile ${bsize ? "" : "dim"}`}>
                <span>{w.size}</span>
                <Num n={bsize?.v ?? "—"} unit={bsize?.u ?? ""} />
              </span>
              <span className={`cq-tile ${bn?.rows !== null && bn?.rows !== undefined ? "" : "dim"}`}>
                <span>{w.rows}</span>
                <Num n={num(bn?.rows)} />
              </span>
              <span className={`cq-tile ${bn?.connections ? "" : "dim"}`}>
                <span>{w.connections}</span>
                <Num n={num(bn?.connections)} />
              </span>
            </span>
            <span className={`cq-foot cor-mono ${pending ? "warn" : ""}`}>
              {bn && !bn.reachable ? w.baseUnreachable : bn ? [bn.tables !== null ? w.tables(bn.tables) : null, bn.migrations ? (pending ? w.migrationsPending(pending) : w.migrationsOk) : null].filter(Boolean).join(" · ") : ""}
            </span>
          </>
        ) : (
          <span className="cq-foot">{c.kind === "inicio" ? w.noBase : st === "never" ? w.noCopyYet : ""}</span>
        )}
      </button>
      <div className="cq-cell cq-appc">
        <span className="cq-ar">
          <span className={`cq-ring ${live ? "on" : st === "failed" ? "bad" : ""}`} aria-hidden>
            <Logo slug={p.slug} title={p.title} size="sm" />
          </span>
          <span className="cq-arw">
            <span className="cq-yl">{live || st === "outside" ? w.yourAppAnswers : w.yourApp}</span>
            <span className="cq-v">{live || st === "outside" ? w.answersIn(sn?.response_ms ?? null) : st === "starting" ? w.startingApp : w.noServer}</span>
          </span>
        </span>
        {url ? (
          <a className="cor-btn secondary small" href={url} target="_blank" rel="noreferrer" aria-label={w.openAppOf(name)} data-control="abrir-app">
            {w.openApp}
          </a>
        ) : (
          <Btn small disabled aria-label={w.openAppOf(name)} data-control="abrir-app">
            {w.openApp}
          </Btn>
        )}
      </div>
      {askDel && (
        <div className="cq-confirm" role="alertdialog" aria-label={w.deleteCopy}>
          <span>{w.deleteAsk(name, sizeText(copySize))}</span>
          <Btn
            kind="danger"
            small
            disabled={!!busy}
            onClick={() =>
              act(`del:${c.id}`, () => api.copiaAct(slug, c.id, "borrar"), () => {
                setAskDel(false);
                toast.success(w.freed(name));
              })
            }
            data-control="borrar-copia-si"
          >
            {w.deleteYes}
          </Btn>
          <Btn kind="quiet" small onClick={() => setAskDel(false)} data-control="borrar-copia-no">
            {w.no}
          </Btn>
        </div>
      )}
    </div>
  );
};

// ---- the leftovers

const LeftIcon = ({ kind }: { kind: "db" | "server" | "folder" }) => (kind === "db" ? <Database size={14} aria-hidden /> : kind === "server" ? <Server size={14} aria-hidden /> : <Folder size={14} aria-hidden />);
const Leftovers = ({ slug, read, busy, act }: { slug: string; read: SobrantesRead | undefined; busy: string | null; act: Act }) => {
  const w = W();
  const [askAll, setAskAll] = useState(false);
  const list = read?.sobrantes ?? [];
  const total = sizeText(read?.total_bytes ?? 0);
  return (
    <section className={`cq-left ${list.length ? "" : "clean"}`} aria-label={w.leftTitle} id="cq-sobrantes" data-sobrantes={list.length}>
      <div className="cq-lh">
        <span className="cq-lhead">
          <Dot tone={list.length ? "warn" : "ok"} />
          <b>{w.leftTitle}</b>
        </span>
        <span className="cq-hint">{list.length ? w.leftHint : w.leftNone}</span>
      </div>
      {list.length > 0 && (
        <div className="cq-lrows">
          {list.map((s: Sobrante) => {
            const l = leftLine(s);
            return (
              <div className="cq-lr" key={s.id} data-sobrante={s.id}>
                <span className="cq-lmain">
                  <span className="cq-lgl">
                    <LeftIcon kind={l.icon} />
                    <span className="cor-ellipsis">{l.kind}</span>
                    {l.amount && <em>{l.amount}</em>}
                  </span>
                  <b className="cor-mono" title={s.name}>
                    {l.name}
                  </b>
                  <span title={l.from}>{l.from}</span>
                </span>
                <Btn kind="danger" small disabled={!!busy} onClick={() => act(`sob:${s.id}`, () => api.borrarSobrante(slug, s.id), () => toast.success(w.freed(l.name)))} data-control="borrar-sobrante">
                  {l.button}
                </Btn>
              </div>
            );
          })}
        </div>
      )}
      {list.length > 0 && (
        <div className="cq-lall">
          {askAll ? (
            <>
              <span className="cq-hint">{w.delAllAsk(list.length, total)}</span>
              <span className="cq-ask">
                <Btn
                  kind="danger"
                  small
                  disabled={!!busy}
                  onClick={() =>
                    act("sob:todo", () => api.borrarSobrantes(slug, list.length), () => {
                      setAskAll(false);
                      toast.success(w.freed(w.leftTitle));
                    })
                  }
                  data-control="borrar-todo-si"
                >
                  {w.delAllYes}
                </Btn>
                <Btn kind="quiet" small onClick={() => setAskAll(false)} data-control="borrar-todo-no">
                  {w.no}
                </Btn>
              </span>
            </>
          ) : (
            <Btn kind="danger" small onClick={() => setAskAll(true)} data-control="borrar-todo">
              {w.delAll(total)}
            </Btn>
          )}
        </div>
      )}
    </section>
  );
};

// ---- the drawer

const Sec = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => (
  <div className="cq-sec">
    <h3>
      {title}
      {aside ? <em>{aside}</em> : null}
    </h3>
    {children}
  </div>
);

const KeyRow = ({ slug, name, set, only, editing, onEdit, onSaved }: { slug: string; name: string; set: boolean; only?: string[]; editing: boolean; onEdit: (on: boolean) => void; onSaved: (r: LlavesRead) => void }) => {
  const w = W();
  const [value, setValue] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);
  const save = useMutation({
    mutationFn: () => api.ponerLlave(slug, name, value),
    onSuccess: (r) => {
      setValue("");
      onEdit(false);
      onSaved(r);
      toast.success(w.keySaved(name));
    },
    onError: (e) => toast.error(errText(e, w.keyErr)),
  });
  return (
    <div className={`cq-row ${set ? "" : "bad"}`} data-llave={name}>
      <span className="cq-rt">
        <b className="cor-mono">{name}</b>
        {only?.length ? <span>{w.keyOnly(only.join(", "))}</span> : null}
      </span>
      <span className={`cq-rv ${set ? "ok" : "bad"}`}>{set ? w.keySetWord : w.keyMissingWord}</span>
      {!editing ? (
        <Btn small kind={set ? "secondary" : "primary"} onClick={() => onEdit(true)} data-control="llave-poner" aria-label={`${set ? w.keyChangeBtn : w.keyPutBtn} ${name}`}>
          {set ? w.keyChangeBtn : w.keyPutBtn}
        </Btn>
      ) : (
        <span />
      )}
      {editing && (
        <form
          className="cq-field"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() && !save.isPending) save.mutate();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onEdit(false);
            }
          }}
        >
          <input ref={field} type="password" className="cor-input cor-mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder={w.keyPlaceholder(name)} aria-label={w.keyValue(name)} autoComplete="new-password" spellCheck={false} data-campo="llave-valor" />
          <Btn kind="primary" small type="submit" disabled={!value.trim() || save.isPending} data-control="llave-guardar">
            {w.keySave}
          </Btn>
          <Btn kind="quiet" small onClick={() => onEdit(false)} data-control="llave-cancelar">
            {w.keyCancel}
          </Btn>
        </form>
      )}
    </div>
  );
};

type DrawerProps = {
  slug: string;
  f: Focus;
  r: CopiasRead;
  n: Numeros | undefined;
  left: SobrantesRead | undefined;
  llaves: LlavesRead | undefined;
  maq: MaquinasRead | undefined;
  busy: string | null;
  editKey: string | null;
  setEditKey: (k: string | null) => void;
  onOpen: (f: Focus | null) => void;
  onPedir: (text: string) => void;
  act: Act;
};

const MacBody = ({ slug, r, n, left, busy, onOpen, act }: DrawerProps) => {
  const w = W();
  const m = n?.mac;
  const dFree = size(m?.disk_free ?? null);
  const mFree = size(m?.mem_free ?? null);
  const on = r.copias.filter(isOn);
  return (
    <>
      <div className="cq-stat s2">
        <div>
          <span>{w.freeDiskT}</span>
          <Num n={dFree?.v ?? "—"} unit={dFree ? `${dFree.u} ${w.ofT(sizeText(m?.disk_total ?? null))}` : ""} />
        </div>
        <div>
          <span>{w.freeMemT}</span>
          <Num n={mFree?.v ?? "—"} unit={mFree ? `${mFree.u} ${w.ofT(sizeText(m?.mem_total ?? null))}` : ""} />
        </div>
      </div>
      <Sec title={w.usesMemory}>
        <div className="cq-rows">
          {on.length === 0 && <p className="cq-note cq-pad">{w.nothingOn}</p>}
          {on.map((x) => (
            <div className="cq-row" key={x.id}>
              <span className="cq-rt">
                <b>{copyName(x)}</b>
                <span>{w.serverOf}</span>
              </span>
              <span className="cq-rv">{sizeText(n?.servers[x.id]?.mem_bytes ?? null) || "—"}</span>
              <Btn small disabled={!!busy || !x.managed} onClick={() => act(`sw:${x.id}`, () => api.copiaAct(slug, x.id, "apagar"))} data-control="mac-apagar">
                {w.turnOff}
              </Btn>
            </div>
          ))}
        </div>
      </Sec>
      <Sec title={w.usesDisk}>
        <div className="cq-rows">
          {r.copias
            .filter((x) => x.made || x.kind === "inicio")
            .map((x) => (
              <div className="cq-row" key={x.id}>
                <span className="cq-rt">
                  <b>{copyName(x)}</b>
                  <span>{w.folderAndBase}</span>
                </span>
                <span className="cq-rv">{sizeText((n?.servers[x.id]?.disk?.total ?? 0) + (n?.bases[x.id]?.size_bytes ?? 0)) || "—"}</span>
                <Btn small onClick={() => onOpen({ who: x.id, part: "servidor" })} data-control="mac-ver-copia">
                  {w.see}
                </Btn>
              </div>
            ))}
          {(left?.total ?? 0) > 0 && (
            <div className="cq-row warn">
              <span className="cq-rt">
                <b>{w.leftTitle}</b>
                <span>{w.leftRow}</span>
              </span>
              <span className="cq-rv">{sizeText(left!.total_bytes)}</span>
              <Btn
                small
                onClick={() => {
                  onOpen(null);
                  setTimeout(() => document.getElementById("cq-sobrantes")?.scrollIntoView({ block: "center" }), 50);
                }}
                data-control="mac-ver-sobrantes"
              >
                {w.see}
              </Btn>
            </div>
          )}
        </div>
      </Sec>
      <p className="cq-note">{w.macNote}</p>
    </>
  );
};

const MotorBody = ({ slug, r, n, left, maq, busy, onOpen, act }: DrawerProps) => {
  const w = W();
  const [ask, setAsk] = useState(false);
  const e = n?.engine;
  const lever = maq?.base.lever;
  const off = (!!n && !e?.on) || maq?.base.state === "off";
  const bases = basesList(r, n);
  const leftBases = (left?.sobrantes ?? []).filter((x) => x.kind === "base");
  return (
    <>
      <div className="cq-stat s3">
        <div>
          <span>{w.basesOf}</span>
          <Num n={String(e?.project_bases ?? bases.length + leftBases.length)} />
        </div>
        <div>
          <span>{w.connections}</span>
          <Num n={off ? "0" : num(e?.connections)} unit={e?.max_connections ? w.ofT(String(e.max_connections)) : ""} />
        </div>
        <div>
          <span>{w.upT}</span>
          <Num n={off ? "—" : since(e?.uptime_s ?? null)} />
        </div>
      </div>
      <Sec title={w.theBases}>
        <div className="cq-rows">
          {bases.map((b) => (
            <div className="cq-row" key={b.id}>
              <span className="cq-rt">
                <b>{b.name}</b>
                <span className="cor-mono">
                  {b.db} · {w.liveCopy(b.conns)}
                </span>
              </span>
              <span className="cq-rv">{sizeText(b.size) || "—"}</span>
              <Btn small onClick={() => onOpen({ who: b.id, part: "base" })} data-control="motor-ver-base">
                {w.see}
              </Btn>
            </div>
          ))}
          {leftBases.map((s) => (
            <div className="cq-row warn" key={s.id}>
              <span className="cq-rt">
                <b className="cor-mono">{s.name}</b>
                <span>
                  {w.leftBase} · {leftLine(s).from}
                </span>
              </span>
              <span className="cq-rv">{sizeText(s.size_bytes)}</span>
              <Btn small kind="danger" disabled={!!busy} onClick={() => act(`sob:${s.id}`, () => api.borrarSobrante(slug, s.id), () => toast.success(w.freed(s.name)))} data-control="motor-borrar-sobrante">
                {w.del}
              </Btn>
            </div>
          ))}
          {!bases.length && !leftBases.length && <p className="cq-note cq-pad">—</p>}
        </div>
        <p className="cq-note">{w.engineNote}</p>
      </Sec>
      <div className="cq-danger">
        <h4>{w.allProjects}</h4>
        {!lever?.can ? (
          <p>{lever?.reason ?? w.engineCant}</p>
        ) : off ? (
          <>
            <p>{w.engineOffNow}</p>
            <span className="cq-acts">
              <Btn kind="primary" disabled={!!busy} onClick={() => act("motor:on", () => api.baseLever(slug, "encender"))} data-control="motor-encender">
                {w.engineOnBtn}
              </Btn>
            </span>
          </>
        ) : ask ? (
          <>
            <p>{w.engineConfirm(r.copias.filter((x) => x.database && (x.made || x.kind === "inicio")).length)}</p>
            <span className="cq-acts">
              <Btn kind="danger" disabled={!!busy} onClick={() => act("motor:off", () => api.baseLever(slug, "apagar"), () => setAsk(false))} data-control="motor-apagar-si">
                {w.engineOffBtn}
              </Btn>
              <Btn kind="quiet" onClick={() => setAsk(false)} data-control="motor-apagar-no">
                {w.no}
              </Btn>
            </span>
          </>
        ) : (
          <>
            <p>{w.engineAsk}</p>
            <span className="cq-acts">
              <Btn kind="danger" onClick={() => setAsk(true)} data-control="motor-apagar">
                {w.engineAskBtn}
              </Btn>
            </span>
          </>
        )}
      </div>
    </>
  );
};

const LlavesBody = ({ slug, r, llaves, busy, editKey, setEditKey, act }: DrawerProps) => {
  const w = W();
  const client = useQueryClient();
  const [restart, setRestart] = useState<{ id: string; title: string }[]>([]);
  const list = llaves?.llaves ?? [];
  return (
    <>
      <div className="cq-rows">
        {list.length === 0 && <p className="cq-note cq-pad">{w.keysNone}</p>}
        {list.map((l) => (
          <KeyRow
            key={l.name}
            slug={slug}
            name={l.name}
            set={l.set}
            only={l.iniciativas?.map((k) => r.copias.find((c) => c.key === k)?.title ?? "")?.filter(Boolean)}
            editing={editKey === l.name}
            onEdit={(on) => setEditKey(on ? l.name : null)}
            onSaved={(rr) => {
              client.setQueryData(["maq-llaves", slug], rr);
              setRestart(rr.reiniciar ?? []);
            }}
          />
        ))}
      </div>
      {restart.length > 0 && (
        <div className="cq-callout info">
          <span>{w.keyRestartAsk}</span>
          <span className="cq-acts">
            <Btn
              kind="primary"
              disabled={!!busy}
              onClick={() =>
                act("reiniciar-todas", () => api.reiniciarEncendidas(slug), () => {
                  toast.success(w.restarted(restart.length));
                  setRestart([]);
                })
              }
              data-control="reiniciar-encendidas"
            >
              {w.keyRestartBtn(restart.length)}
            </Btn>
          </span>
        </div>
      )}
      <p className="cq-note">{w.keysNote}</p>
    </>
  );
};

const ServerBody = ({ slug, c, n, llaves, busy, setEditKey, onOpen, onPedir, act }: DrawerProps & { c: Copia }) => {
  const w = W();
  const st = rowState(c);
  const sn = n?.servers[c.id];
  const live = st === "on";
  const log = useQuery({ queryKey: ["maq-bitacora", slug, c.id], queryFn: () => api.bitacoraDe(slug, c.id), refetchInterval: 5000, retry: 0 });
  const lines = log.data?.lines ?? [];
  const failText = errorLine(lines, sn?.line ?? c.error);
  const key = st === "failed" ? missingKey([c.error, ...lines].join("\n"), (llaves?.llaves ?? []).filter((l) => !l.set).map((l) => l.name)) : null;
  const bars = diskBars(sn?.disk ?? null);
  const cache = sn?.disk?.cache ?? 0;
  const mem = size(sn?.mem_bytes ?? null);
  const url = appUrl(c);
  return (
    <>
      <div className="cq-acts">
        {switchOf(c).on ? (
          <Btn disabled={!!busy || !c.managed} onClick={() => act(`sw:${c.id}`, () => api.copiaAct(slug, c.id, "apagar"))} data-control="drawer-apagar">
            {w.turnOff}
          </Btn>
        ) : (
          <Btn kind="primary" disabled={!!busy || st === "unavailable" || st === "outside"} onClick={() => act(`sw:${c.id}`, () => api.copiaAct(slug, c.id, "encender"))} data-control="drawer-encender">
            {st === "failed" ? w.retry : w.turnOn}
          </Btn>
        )}
        {live && (
          <Btn disabled={!!busy || !c.managed} onClick={() => act(`re:${c.id}`, () => api.copiaAct(slug, c.id, "reiniciar"))} data-control="drawer-reiniciar">
            {w.restart}
          </Btn>
        )}
        {url ? (
          <a className="cor-btn secondary" href={url} target="_blank" rel="noreferrer" data-control="drawer-abrir-app">
            {w.openApp}
          </a>
        ) : (
          <Btn disabled data-control="drawer-abrir-app">
            {w.openApp}
          </Btn>
        )}
      </div>
      <label className="cq-chk">
        <input
          type="checkbox"
          checked={c.keep}
          disabled={!!busy || (c.kind === "iniciativa" && !c.made) || (c.kind === "inicio" && !c.managed)}
          onChange={(e) => {
            const keep = e.target.checked;
            act(`keep:${c.id}`, () => api.copiaAct(slug, c.id, "quedarse", { keep }), () => toast.success(keep ? w.keepOn(copyName(c)) : w.keepOff(copyName(c))));
          }}
          data-control="no-apagarla-sola"
        />
        {w.keep}
      </label>
      {st === "failed" && (
        <div className="cq-callout bad">
          <span>
            <b>{w.failedT}</b> {key ? w.failedKey(key) : w.failedLog}
          </span>
          <span className="cq-acts">
            {key && (
              <Btn
                kind="primary"
                onClick={() => {
                  setEditKey(key);
                  onOpen({ who: "shared", part: "llaves" });
                }}
                data-control="poner-la-llave"
              >
                {w.putKey}
              </Btn>
            )}
            <Btn onClick={() => onPedir(w.askFixText(copyName(c), failText ?? c.error ?? ""))} data-control="pedir-arreglo">
              {w.askFix}
            </Btn>
          </span>
        </div>
      )}
      <div className="cq-stat">
        <div>
          <span>{w.cpu}</span>
          <Num n={live ? cpuText(sn?.cpu ?? null) : "—"} unit="%" />
          {live && <Spark values={sn?.cpu_samples ?? []} h={20} />}
        </div>
        <div>
          <span>{w.mem}</span>
          <Num n={live && mem ? mem.v : "—"} unit={live && mem ? mem.u : "MB"} />
          {live && <Spark values={sn?.mem_samples ?? []} h={20} />}
        </div>
        <div>
          <span>{w.up}</span>
          <Num n={live ? since(sn?.uptime_s ?? null) : "—"} />
        </div>
        <div>
          <span>{w.respondsIn}</span>
          <Num n={live && sn?.response_ms !== null && sn?.response_ms !== undefined ? String(sn.response_ms) : "—"} unit="ms" />
        </div>
      </div>
      <Sec title={w.diskWhat} aside={sizeText(sn?.disk?.total ?? null)}>
        {bars.length ? (
          <div className="cq-bars">
            {bars.map((b) => (
              <div className="cq-bar" key={b.key}>
                <span>{b.label}</span>
                <i style={{ width: `${b.share}%` }} />
                <em>{b.text}</em>
              </div>
            ))}
          </div>
        ) : (
          <p className="cq-note">{w.noFolderYet}</p>
        )}
        {cache > 0 ? (
          <span className="cq-acts">
            <Btn small disabled={!!busy} onClick={() => act(`cache:${c.id}`, () => api.borrarCache(slug, c.id).then((x) => void toast.success(w.cacheCleared(sizeText(x.freed_bytes)))))} data-control="borrar-cache">
              {w.clearCache(sizeText(cache))}
            </Btn>
          </span>
        ) : bars.length ? (
          <p className="cq-note">{w.cacheEmpty}</p>
        ) : null}
      </Sec>
      <Sec
        title={w.log}
        aside={
          <button type="button" className="cor-btn link" onClick={() => void copyText(lines.join("\n"), w.logCopied)} disabled={!lines.length} data-control="copiar-registro">
            {w.copyLog}
          </button>
        }
      >
        <pre className="cq-log" tabIndex={0} aria-label={w.log}>
          {lines.length
            ? lines.slice(-12).map((l, i) => (
                <span key={i} className={/\b(error|missing|exited|fatal)\b/i.test(l) ? "e" : undefined}>
                  {l}
                  {"\n"}
                </span>
              ))
            : w.noLines}
        </pre>
      </Sec>
    </>
  );
};

const BaseBody = ({ slug, c, n, busy, act }: DrawerProps & { c: Copia }) => {
  const w = W();
  const [askWipe, setAskWipe] = useState(false);
  const [openTb, setOpenTb] = useState<string | null>(null);
  // While the copy starts its base may be being made (Rehacer, a first start): read it once it is up.
  // Nor while Rehacer or Vaciar y sembrar is remaking it.
  const starting = rowState(c) === "starting" || busy === `wipe:${c.id}`;
  const tablas = useQuery<TablesRead>({ queryKey: ["maq-tablas", slug, c.id, starting], queryFn: () => api.tablas(slug, c.id), enabled: !!c.database && !starting, retry: 0, staleTime: 5000 });
  const filas = useQuery<RowsRead>({ queryKey: ["maq-filas", slug, c.id, openTb], queryFn: () => api.filas(slug, openTb!, 0, c.id), enabled: !!openTb, retry: 0 });
  const bn = n?.bases[c.id];
  const t = tablas.data;
  const pending = t?.migrations.pending ?? bn?.migrations?.pending ?? 0;
  const applied = t?.migrations.applied ?? bn?.migrations?.applied ?? 0;
  const heavy = [...(t?.tables ?? [])].sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0) || b.rows - a.rows).slice(0, 6);
  const max = Math.max(1, ...heavy.map((x) => x.size_bytes ?? x.rows));
  const rows = t?.total_rows ?? bn?.rows ?? 0;
  const bsize = size(bn?.size_bytes ?? null);
  const after = (ok: string, fail: string) => (x: { ok: boolean; steps: { tail: string[] }[] }) => void (x.ok ? toast.success(ok) : toast.error(failedTail(x) ?? fail));
  return (
    <>
      <div className="cq-stat">
        <div>
          <span>{w.size}</span>
          <Num n={bsize?.v ?? "—"} unit={bsize?.u ?? ""} />
        </div>
        <div>
          <span>{w.tablesT}</span>
          <Num n={num(t?.tables.length ?? bn?.tables)} />
        </div>
        <div>
          <span>{w.rows}</span>
          <Num n={num(rows)} />
        </div>
        <div>
          <span>{w.connections}</span>
          <Num n={num(bn?.connections)} />
        </div>
      </div>
      {tablas.isError && <p className="cq-note">{errText(tablas.error, w.baseUnreachable)}</p>}
      {pending > 0 ? (
        <div className="cq-callout warn">
          <span>
            <b>{w.pendingT(pending)}</b> {w.pendingWhy}
          </span>
          <span className="cq-acts">
            <Btn kind="primary" disabled={!!busy} onClick={() => act(`mig:${c.id}`, () => api.migrar(slug, c.id).then(after(w.applied, w.errDo)))} data-control="aplicar-migracion">
              {w.applyBtn(pending)}
            </Btn>
          </span>
        </div>
      ) : t && t.migrations.table && t.migrations.files.length ? (
        <p className="cq-note">{w.migOk(applied)}</p>
      ) : null}
      <Sec title={w.heavy} aside={heavy.length ? w.heavyHint : undefined}>
        {t && !heavy.length && <p className="cq-note">{w.noTables}</p>}
        <div className="cq-bars">
          {heavy.map((x) => (
            <div key={x.name}>
              <button type="button" className="cq-bar" aria-expanded={openTb === x.name} onClick={() => setOpenTb(openTb === x.name ? null : x.name)} data-tabla={x.name}>
                <span>{x.name}</span>
                <i style={{ width: `${Math.round(((x.size_bytes ?? x.rows) / max) * 100)}%` }} />
                <em>{x.size_bytes !== null && x.size_bytes !== undefined ? sizeText(x.size_bytes) : num(x.rows)}</em>
              </button>
              {openTb === x.name && (
                <pre className="cq-log" tabIndex={0} aria-label={x.name}>
                  {filas.data
                    ? [...filas.data.rows.slice(0, 3).map((row) => filas.data!.columns.slice(0, 4).map((col) => row[col] ?? "—").join(" · ")), filas.data.total > 3 ? w.moreRows(filas.data.total - 3) : ""].filter(Boolean).join("\n") || w.noLines
                    : filas.isError
                      ? errText(filas.error, w.baseUnreachable)
                      : "…"}
                </pre>
              )}
            </div>
          ))}
        </div>
      </Sec>
      <Sec title={w.testData}>
        <span className="cq-acts">
          <Btn disabled={!!busy} onClick={() => act(`seed:${c.id}`, () => api.sembrar(slug, c.id).then(after(w.seeded, w.seedFail)))} data-control="sembrar">
            {w.seedBtn}
          </Btn>
        </span>
      </Sec>
      <div className="cq-danger">
        <h4>{w.wipeT}</h4>
        <p>{c.kind === "inicio" ? w.wipeStart : w.wipeIni}</p>
        {askWipe ? (
          <span className="cq-acts">
            <Btn
              kind="danger"
              disabled={!!busy}
              onClick={() =>
                c.kind === "inicio"
                  ? act(`wipe:${c.id}`, () => api.vaciarYSembrar(slug, rows, c.id).then(after(w.wiped, w.errDo)), () => setAskWipe(false))
                  : act(`wipe:${c.id}`, () => api.copiaAct(slug, c.id, "rehacer"), () => {
                      setAskWipe(false);
                      toast.success(w.remade);
                    })
              }
              data-control="vaciar-si"
            >
              {c.kind === "inicio" ? w.wipeYesStart(num(rows)) : w.wipeYesIni}
            </Btn>
            <Btn kind="quiet" onClick={() => setAskWipe(false)} data-control="vaciar-no">
              {w.no}
            </Btn>
          </span>
        ) : (
          <span className="cq-acts">
            <Btn kind="danger" onClick={() => setAskWipe(true)} disabled={c.kind === "iniciativa" && !c.made} data-control="vaciar">
              {c.kind === "inicio" ? w.wipeAskStart : w.wipeAskIni}
            </Btn>
          </span>
        )}
      </div>
    </>
  );
};

const Drawer = (props: DrawerProps) => {
  const { f, r, llaves, onOpen } = props;
  const w = W();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, [f.who, f.part]);
  const c = f.who === "shared" ? null : (r.copias.find((x) => x.id === f.who) ?? null);
  let title = "";
  let pill: [Tone, string] | null = null;
  let sub = "";
  let body: ReactNode = null;
  if (f.who === "shared" && f.part === "mac") {
    title = w.mac;
    sub = w.macSub;
    body = <MacBody {...props} />;
  } else if (f.who === "shared" && f.part === "motor") {
    const off = (!!props.n && !props.n.engine.on) || props.maq?.base.state === "off";
    title = w.engine;
    pill = off ? ["bad", w.engineOff] : ["ok", w.engineOn];
    sub = w.engineSub(props.n?.engine.version ?? null);
    body = <MotorBody {...props} />;
  } else if (f.who === "shared") {
    const list = llaves?.llaves ?? [];
    const missing = list.filter((l) => !l.set).length;
    title = w.keys;
    pill = list.length ? (missing ? ["bad", w.keysMissing(missing)] : ["ok", w.keysAll(list.length)]) : null;
    sub = w.keysSub(llaves?.env_file ?? null);
    body = <LlavesBody {...props} />;
  } else if (c) {
    title = copyName(c);
    pill = [pillTone(rowState(c)), pillWord(rowState(c))];
    sub = f.part === "servidor" ? w.serverSub(c.port) : w.baseSub(c.database ?? "");
    body = f.part === "servidor" ? <ServerBody key={c.id} {...props} c={c} /> : <BaseBody key={c.id} {...props} c={c} />;
  }
  return (
    <aside className="cq-drawer" aria-label={title} data-drawer={focusKey(f)}>
      <div className="cq-dh">
        <span className="cq-dt">
          <b>{title}</b>
          <span>
            {pill && <Pill tone={pill[0]}>{pill[1]}</Pill>}
            {sub}
          </span>
        </span>
        <button ref={closeRef} type="button" className="cq-ico" aria-label={w.close} onClick={() => onOpen(null)} data-control="cerrar-cajon">
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className="cq-db">{body}</div>
    </aside>
  );
};

// ---- the door

export const Maquinas = ({ p, onPedir, focus, onFocus }: { p: OrgProject; onPedir: (text: string) => void; focus: string | null; onFocus: (what: string | null) => void }) => {
  const w = W();
  const s = p.slug;
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const copias = useQuery<CopiasRead>({
    queryKey: ["maq-copias", s],
    queryFn: () => api.copias(s),
    refetchInterval: (x) => (x.state.data?.copias.some((c) => c.phase === "starting" || c.phase === "capturing") ? 1500 : 10_000),
    retry: 1,
  });
  // The numbers are read only while this door is open: the query lives as long as the component.
  const numeros = useQuery<Numeros>({ queryKey: ["maq-numeros", s], queryFn: () => api.numeros(s), refetchInterval: 5000, retry: 0 });
  const sobrantes = useQuery<SobrantesRead>({ queryKey: ["maq-sobrantes", s], queryFn: () => api.sobrantes(s), refetchInterval: 30_000, retry: 0 });
  const entrar = useQuery<EntrarRead>({ queryKey: ["maq-entrar", s], queryFn: () => api.entrar(s), retry: 0 });
  const llaves = useQuery<LlavesRead>({ queryKey: ["maq-llaves", s], queryFn: () => api.llaves(s), staleTime: 30_000, retry: 0 });
  const maq = useQuery<MaquinasRead>({ queryKey: ["maquinas", s], queryFn: () => api.maquinas(s), staleTime: 15_000, retry: 0 });
  const r = copias.data;
  const f = useMemo(() => focusOf(focus, r?.copias ?? []), [focus, r]);
  const open = (x: Focus | null) => onFocus(x ? focusKey(x) : null);

  useEffect(() => {
    if (!f) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onFocus(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [f, onFocus]);

  const refresh = () => {
    for (const k of ["maq-copias", "maq-numeros", "maq-sobrantes", "maq-entrar", "maq-llaves", "maquinas", "maq-tablas", "maq-bitacora"]) void client.invalidateQueries({ queryKey: [k, s] });
    void client.invalidateQueries({ queryKey: ["maquinas-tablero"] });
  };
  const run = useMutation({
    mutationFn: async (x: { key: string; call: () => Promise<unknown>; ok?: () => void }) => {
      const out = (await x.call()) as Partial<CopiasRead> | undefined;
      // A copy action answers with the copies: the screen knows at once which one is starting (its base may be being
      // made, so its tables are not read until it is up).
      if (out && Array.isArray(out.copias)) client.setQueryData(["maq-copias", s], out);
      x.ok?.();
    },
    onMutate: (x) => setBusy(x.key),
    // A leftover list that changed since it was shown is read again by the refresh below.
    onError: (e) => toast.error(e instanceof ApiError && e.code === "LEFTOVERS_CHANGED" ? w.leftChanged : errText(e, w.errDo)),
    onSettled: () => {
      setBusy(null);
      refresh();
    },
  });
  const act: Act = (key, call, ok) => {
    if (!run.isPending) run.mutate({ key, call, ok });
  };

  if (copias.isError && !r) return <ReadError what={w.readWhat} onRetry={() => void copias.refetch()} />;
  if (!r) return <div className="cor-skel" style={{ height: 480 }} role="status" aria-busy="true" aria-label={w.reading} />;

  const sum = summaryOf(r, sobrantes.data);
  const n = numeros.data;
  const mac = n?.mac;
  const diskUsed = mac?.disk_total && mac.disk_free !== null ? mac.disk_total - mac.disk_free : null;
  const memUsed = mac?.mem_total && mac.mem_free !== null ? mac.mem_total - mac.mem_free : null;
  const memShare = pct(memUsed, mac?.mem_total ?? null);
  const diskShare = pct(diskUsed, mac?.disk_total ?? null);
  const e = n?.engine;
  const engineOff = (!!n && !e?.on) || maq.data?.base.state === "off";
  const keyList = llaves.data?.llaves ?? [];
  const missing = keyList.filter((k) => !k.set);
  const leftBases = (sobrantes.data?.sobrantes ?? []).filter((x) => x.kind === "base").length;
  const free = size(mac?.disk_free ?? null);
  const sharedOpen = f?.who === "shared" ? f.part : null;
  // An open initiative with no copy yet is a chip that makes it; a row only once it exists (or is starting/failed).
  const unmade = r.copias.filter((c) => rowState(c) === "never");
  const rows = r.copias.filter((c) => rowState(c) !== "never");

  return (
    <div className={`cq ${f ? "open" : ""}`} data-maquinas="cuarto" data-cajon={f ? focusKey(f) : undefined}>
      <header className="cq-head">
        <div className="cq-tt">
          <h2>{w.title}</h2>
          <div className="cq-chips">
            <span className="cq-chip">
              <b>{sum.total}</b> {w.copies(sum.total)}
            </span>
            <span className="cq-chip">
              <Dot tone={sum.on ? "ok" : ""} />
              <b>{sum.on}</b> {w.onCount(sum.on)}
            </span>
            {sum.failed.map((x) => (
              <button key={x.id} type="button" className="cq-chip bad" onClick={() => open({ who: x.id, part: "servidor" })} data-control="chip-fallo">
                <Dot tone="bad" />
                {w.didNotStart(x.name)}
              </button>
            ))}
            {unmade.map((c) => (
              <button key={c.id} type="button" className="cq-chip add" disabled={!!busy} onClick={() => act(`sw:${c.id}`, () => api.copiaAct(s, c.id, "encender"))} aria-label={w.makeCopyOf(c.title)} title={w.makeCopyOf(c.title)} data-control="hacer-copia" data-copia-nueva={c.id}>
                + {c.title}
              </button>
            ))}
            {sum.leftovers > 0 && (
              <button type="button" className="cq-chip warn" onClick={() => document.getElementById("cq-sobrantes")?.scrollIntoView({ block: "center", behavior: "smooth" })} data-control="chip-sobrantes">
                <Dot tone="warn" />
                {w.leftovers(sum.leftovers, sizeText(sum.leftover_bytes))}
              </button>
            )}
          </div>
        </div>
        <Login slug={s} read={entrar.data} copias={r.copias} />
      </header>

      {!r.configured && (
        <div className="cq-setup" role="status">
          <span className="cor-text">{r.no_code ? w.noCode : w.unconfigured}</span>
          {!r.no_code && (
            <Btn kind="primary" disabled={!!busy} onClick={() => act("configurar", () => api.configurar(s))} data-control="configurar">
              {w.configure}
            </Btn>
          )}
        </div>
      )}

      {r.configured && <Revision slug={s} />}

      <div className="cq-body">
        <div className="cq-rail">
          <button type="button" className={`cq-mach ${sharedOpen === "mac" ? "focus" : ""}`} onClick={() => open({ who: "shared", part: "mac" })} data-abre="mac">
            <span className="cq-mh">
              <Laptop size={16} aria-hidden />
              <b>{w.mac}</b>
              <span className="cq-go">{w.macGo}</span>
            </span>
            <span className="cq-mval">
              {free ? `${free.v} ${free.u}` : "—"}
              <small>{w.freeDisk}</small>
            </span>
            <span className="cq-gauges">
              <Gauge label={w.disk} value={`${diskShare ?? "—"} %`} share={diskShare} warn={(diskShare ?? 0) > 90} />
              <Gauge label={w.memory} value={`${memShare ?? "—"} %`} share={memShare} warn={(memShare ?? 0) > 75} />
            </span>
          </button>
          <button type="button" className={`cq-mach ${engineOff ? "bad" : ""} ${sharedOpen === "motor" ? "focus" : ""}`} onClick={() => open({ who: "shared", part: "motor" })} data-abre="motor">
            <span className="cq-mh">
              <Database size={16} aria-hidden />
              <b>{w.engine}</b>
              <span className="cq-go">{w.engineGo}</span>
            </span>
            <span className={`cq-mval ${engineOff ? "bad" : ""}`}>
              {!n ? "—" : engineOff ? w.engineOff : w.engineOn}
              {!engineOff && e?.uptime_s ? <small>{w.engineSince(since(e.uptime_s))}</small> : null}
            </span>
            <Gauge label={w.connections} value={e?.max_connections ? w.connOf(engineOff ? 0 : (e.connections ?? 0), e.max_connections) : "—"} share={pct(engineOff ? 0 : (e?.connections ?? null), e?.max_connections ?? null)} />
            <span className="cq-msub">
              {w.liveBases(r.copias.filter((c) => c.database && (c.made || c.kind === "inicio")).length)}
              {leftBases > 0 && (
                <>
                  {" · "}
                  <span className="w">{w.leftBases(leftBases)}</span>
                </>
              )}
            </span>
          </button>
          <button type="button" className={`cq-mach ${missing.length ? "bad" : ""} ${sharedOpen === "llaves" ? "focus" : ""}`} onClick={() => open({ who: "shared", part: "llaves" })} data-abre="llaves">
            <span className="cq-mh">
              <KeyRound size={16} aria-hidden />
              <b>{w.keys}</b>
              <span className="cq-go">{missing.length ? w.keysPut : w.keysSee}</span>
            </span>
            <span className={`cq-mval ${missing.length ? "bad" : ""}`}>
              {keyList.length ? (missing.length ? w.keysMissing(missing.length) : w.keysAll(keyList.length)) : "—"}
              {missing.length > 0 && <small>{w.keysOf(keyList.length)}</small>}
            </span>
            <span className="cq-keyrow" aria-hidden>
              {keyList.slice(0, 24).map((k) => (
                <i key={k.name} className={k.set ? "" : "miss"} />
              ))}
            </span>
            <span className="cq-msub cor-ellipsis">
              {missing.length ? (
                <>
                  <span className="b cor-mono">{missing[0]!.name}</span>
                  {missing[0]!.iniciativas?.length ? ` · ${missing[0]!.iniciativas.map((k) => r.copias.find((c) => c.key === k)?.title ?? k).join(", ")}` : ""}
                </>
              ) : keyList.length ? (
                w.keysRead
              ) : (
                w.keysNone
              )}
            </span>
          </button>
        </div>
        <div className="cq-lines">
          {rows.map((c) => (
            <Line key={c.id} slug={s} p={p} c={c} n={n} ownBases={r.own_bases} open={f} busy={busy} onOpen={open} act={act} />
          ))}
        </div>
      </div>

      <Leftovers slug={s} read={sobrantes.data} busy={busy} act={act} />

      {f && <Drawer slug={s} f={f} r={r} n={n} left={sobrantes.data} llaves={llaves.data} maq={maq.data} busy={busy} editKey={editKey} setEditKey={setEditKey} onOpen={open} onPedir={onPedir} act={act} />}
    </div>
  );
};
