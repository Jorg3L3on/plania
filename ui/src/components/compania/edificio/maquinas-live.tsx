// PLA-I48-4/5/6: Máquinas with its reads and clicks. useMaquinasRoom is called once by /ceo for the open floor and
// returns the room (the level), the level switch with its two lights, and what La ficha shows for a Máquinas kind.
// Each read loads only when its view is on screen: the room read always (it feeds the switch's lights, slowly on
// Trabajo), the tables only with the base on, the rows only with a drawer open, the rest only in their ficha.
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { FichaRef } from "@/lib/ficha";
import { maqView, NO_LIGHTS, pedirFallo, tickKey, type Light, type MaquinasRead, type Nivel, type Paso } from "@/lib/maquinas";
import type { CapturesRead } from "@/lib/ventana";
import type { Load } from "./ficha";
import { Maquinas, type MaqOpen } from "./maquinas";
import { FichaBase, FichaLlaves, FichaProbar, FichaPruebas, FichaServidor, FichaTabla } from "./maquinas-ficha";

export const NivelSwitch = ({ nivel, lights, onNivel }: { nivel: Nivel; lights: { server: Light; base: Light }; onNivel?: (n: Nivel) => void }) => (
  <div className="edi-maq-lift" role="tablist" aria-label="Nivel del piso" data-nivel={nivel}>
    <button type="button" role="tab" aria-selected={nivel === "trabajo"} onClick={() => onNivel?.("trabajo")} data-control="nivel-trabajo">
      Trabajo
    </button>
    <button type="button" role="tab" aria-selected={nivel === "maquinas"} onClick={() => onNivel?.("maquinas")} aria-keyshortcuts="M" data-control="nivel-maquinas">
      Máquinas
      <span className="edi-maq-lamps" aria-label={`Servidor ${LIGHT_WORD[lights.server]}, base ${LIGHT_WORD[lights.base]}`} role="img">
        <i className="edi-maq-lamp" data-s={lights.server} data-light="server" />
        <i className="edi-maq-lamp" data-s={lights.base} data-light="base" />
      </span>
    </button>
  </div>
);
const LIGHT_WORD: Record<Light, string> = { on: "encendido", off: "apagado", starting: "encendiendo", error: "con error", none: "sin configurar" };

const ERR = (e: unknown, what: string) => {
  if (e instanceof ApiError) {
    const hint = typeof e.detail.hint === "string" ? e.detail.hint : null;
    return hint ? `${what}: ${hint}` : `${what} (${e.code}).`;
  }
  return "No se pudo. Si la Mac está dormida, intenta al despertar.";
};
const loadOf = <T,>(q: { isError: boolean; data?: T; refetch: () => unknown }, on: boolean): Load<T> => ({
  status: !on ? "idle" : q.isError ? "error" : q.data !== undefined ? "ok" : "loading",
  data: q.data,
  retry: () => void q.refetch(),
});

function readTicks(key: string): number[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

export function useMaquinasRoom({
  slug,
  nivel,
  fref,
  onFicha,
  onPedir,
}: {
  slug: string | null;
  nivel: Nivel;
  fref: FichaRef | null; // what La ficha shows now (null: closed)
  onFicha: (r: FichaRef, el?: HTMLElement | null) => void;
  onPedir: (slug: string, text: string) => void;
}) {
  const client = useQueryClient();
  const on = !!slug;
  const active = on && nivel === "maquinas";
  const s = slug ?? "";
  const [page, setPage] = useState<string | null>(null);
  const [size, setSize] = useState<"desktop" | "phone">("desktop");
  const [drawer, setDrawer] = useState<string | null>(null);
  const [mapa, setMapa] = useState(false);
  const [offset, setOffset] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setPage(null);
    setDrawer(null);
    setMapa(false);
    setOffset(0);
    setConfirming(false);
    setPassword(null);
  }, [slug]);

  const maqRef = fref && (fref.kind === "maq" || fref.kind === "maq-tabla") ? fref : null;
  const read = useQuery<MaquinasRead>({
    queryKey: ["maquinas", s],
    queryFn: () => api.maquinas(s),
    enabled: on,
    refetchInterval: (x) => {
      const ph = x.state.data?.server.phase;
      if (ph === "starting" || ph === "capturing") return 1500;
      return active || maqRef ? 15_000 : 60_000;
    },
    retry: 1,
  });
  const r = read.data;
  const v = r ? maqView(r) : null;
  const baseOn = r?.base.state === "on";
  const wantTables = baseOn && (active || maqRef?.kind === "maq-tabla" || maqRef?.what === "base");
  const tables = useQuery({ queryKey: ["maq-tablas", s], queryFn: () => api.tablas(s), enabled: on && !!wantTables, staleTime: 10_000, retry: 0 });
  const rows = useQuery({ queryKey: ["maq-filas", s, drawer, offset], queryFn: () => api.filas(s, drawer!, offset), enabled: active && !!drawer && baseOn, retry: 0 });
  const captures = useQuery<CapturesRead>({ queryKey: ["captures", s], queryFn: () => api.captures(s), enabled: active && !!r?.configured, retry: 0 });
  const llaves = useQuery({ queryKey: ["maq-llaves", s], queryFn: () => api.llaves(s), enabled: on && (active || maqRef?.kind === "maq"), staleTime: 30_000, retry: 0 });
  const pruebas = useQuery({
    queryKey: ["maq-pruebas", s],
    queryFn: () => api.pruebas(s),
    enabled: on && (active || maqRef?.kind === "maq"),
    refetchInterval: (x) => (x.state.data?.running ? 2000 : false),
    retry: 0,
  });
  const log = useQuery({ queryKey: ["maq-bitacora", s], queryFn: () => api.bitacora(s), enabled: on && maqRef?.kind === "maq" && maqRef.what === "servidor", refetchInterval: 5000, retry: 0 });
  const recorrido = useQuery({ queryKey: ["maq-recorrido", s], queryFn: () => api.recorrido(s), enabled: on && maqRef?.kind === "maq" && maqRef.what === "probar", retry: 0 });
  const tk = tickKey(s, recorrido.data?.doc_id ?? null);
  const [ticks, setTicks] = useState<number[]>([]);
  useEffect(() => setTicks(readTicks(tk)), [tk]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["maquinas", s] });
    void client.invalidateQueries({ queryKey: ["captures", s] });
    void client.invalidateQueries({ queryKey: ["maq-tablas", s] });
    void client.invalidateQueries({ queryKey: ["maquinas-tablero"] });
  };
  const run = useMutation({
    mutationFn: async (x: { key: string; call: () => Promise<unknown>; what: string }) => x.call(),
    onMutate: (x) => setBusy(x.key),
    onError: (e, x) => toast.error(ERR(e, x.what)),
    onSettled: () => {
      setBusy(null);
      refresh();
    },
  });
  const act = (key: string, what: string, call: () => Promise<unknown>, then?: (out: unknown) => void) => run.mutate({ key, what, call: async () => then ? then(await call()) : call() });

  const onServer = (a: "encender" | "apagar" | "reiniciar") =>
    act(`server:${a}`, a === "apagar" ? "No se pudo apagar" : "No se pudo encender", () => (a === "reiniciar" ? api.reiniciar(s) : api.prueba(s, a)));
  const onBase = (a: "encender" | "apagar") => act(`base:${a}`, a === "apagar" ? "No se pudo apagar la base" : "No se pudo encender la base", () => api.baseLever(s, a));
  const open = (what: MaqOpen, el?: HTMLElement | null) => onFicha(typeof what === "string" ? { kind: "maq", what } : { kind: "maq-tabla", name: what.tabla }, el);
  const shot = (() => {
    const c = captures.data;
    if (!c) return null;
    const p = c.pages.find((x) => x.key === (page ?? r?.pages[0]?.key)) ?? c.pages[0];
    return p ? { desktop: p.desktop.still, phone: p.phone.still } : null;
  })();

  const room = (ask?: ReactNode) => (
    <Maquinas
      read={loadOf(read, on)}
      captures={shot}
      tables={loadOf(tables, !!wantTables)}
      rows={drawer ? loadOf(rows, true) : undefined}
      llaves={llaves.data ?? null}
      pruebas={pruebas.data ?? null}
      page={page}
      size={size}
      drawer={drawer}
      mapa={mapa}
      ask={ask}
      acts={{
        busy,
        onServer,
        onBase,
        onConfigurar: () => act("configurar", "No se pudo configurar", () => api.configurar(s)),
        onCaptura: () => act("captura", "No se pudo tomar la captura", () => api.prueba(s, "tomar")),
        onOpen: open,
        onPage: setPage,
        onSize: setSize,
        onDrawer: (name) => {
          setDrawer(name);
          setOffset(0);
          setMapa(false);
          if (name) onFicha({ kind: "maq-tabla", name });
        },
        onMapa: (o) => {
          setMapa(o);
          if (o) setDrawer(null);
        },
        onRows: setOffset,
      }}
    />
  );

  const fichaActs = {
    busy,
    onServer,
    onAplicar: () => act("aplicar", "No se pudo aplicar", () => api.migrar(s)),
    onSembrar: () => act("sembrar", "No se pudo sembrar", () => api.sembrar(s)),
    onVaciarPedir: () => setConfirming(true),
    onVaciarCancelar: () => setConfirming(false),
    onVaciar: (n: number) =>
      act("vaciar", "No se pudo vaciar", () => api.vaciarYSembrar(s, n), () => {
        setConfirming(false);
        toast.success("La base tiene otra vez los datos de muestra.");
      }),
    onPruebas: () => act("pruebas", "No se pudieron correr", () => api.correrPruebas(s), () => void client.invalidateQueries({ queryKey: ["maq-pruebas", s] })),
    onIr: (p: Paso) => {
      if (p.page) setPage(p.page);
    },
    onTick: (n: number, done: boolean) => {
      const next = done ? [...new Set([...ticks, n])] : ticks.filter((x) => x !== n);
      setTicks(next);
      try {
        window.localStorage.setItem(tk, JSON.stringify(next));
      } catch {
        /* the browser keeps nothing */
      }
    },
    onFallo: (p: Paso) => onPedir(s, pedirFallo(p)),
    onContrasena: () => act("contrasena", "No se pudo cambiar la contraseña", () => api.contrasena(s), (out) => setPassword((out as { password: string }).password)),
    onTabla: (name: string) => onFicha({ kind: "maq-tabla", name }),
  };

  const ficha = (ref: FichaRef): ReactNode => {
    if (ref.kind === "maq-tabla") return <FichaTabla name={ref.name} tables={loadOf(tables, true)} acts={fichaActs} />;
    if (ref.kind !== "maq") return null;
    switch (ref.what) {
      case "servidor":
        return <FichaServidor read={loadOf(read, true)} log={loadOf(log, true)} acts={fichaActs} />;
      case "base":
        return <FichaBase read={loadOf(read, true)} tables={loadOf(tables, !!baseOn)} confirming={confirming} acts={fichaActs} />;
      case "llaves":
        return <FichaLlaves llaves={loadOf(llaves, true)} />;
      case "pruebas":
        return <FichaPruebas pruebas={loadOf(pruebas, true)} acts={fichaActs} />;
      case "probar":
        return <FichaProbar recorrido={loadOf(recorrido, true)} ticks={ticks} password={password} page={page} acts={fichaActs} />;
    }
  };

  return { room, ficha, lights: v?.lights ?? NO_LIGHTS, configured: r?.configured ?? null, setPage };
}
