// The Pedir palette: one field, from any screen, to ask a project for something or go somewhere (ADR 0008). Its keys,
// rows and starting project are pure and tested in ui/src/lib/paleta.ts; this file draws them and sends.
//
// Motion. On a computer it opens with ⌘K many times a day, so it opens and closes with no animation at all, and the
// chosen row moves with no transition: anything else would make the key feel slow. On a phone it opens from a tap, so
// it rises as a sheet from the bottom edge (300ms on the drawer curve, 200ms down); reduced motion keeps the fade only.
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon, Loader2Icon, SendIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { ProjectMark } from "@/components/plania-mark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { ASK_MAX, modesOf, nextMode, type AskMode } from "@/lib/corriente";
import { askedLine } from "@/lib/edificio";
import { agrupar, atajo, atajoTexto, esMac, filasDe, mover, paletaWords, proyectoDeRuta, proyectoInicial, type Fila, type Lugar, type ProyectoLista } from "@/lib/paleta";
import { cn } from "@/lib/utils";

// PLA-I2-10: the ask modes in the screen's language (fixed for the page load).
const MODES = modesOf();
// The project asked last on this device; the same key Inicio's field used, so nobody loses their choice.
const ULTIMO = "plania.pedir.project";
// The field grows with the words up to this height, then scrolls.
const MAX_CAMPO_PX = 160;

const mac = typeof navigator !== "undefined" && esMac(navigator.platform || navigator.userAgent);

function leerUltimo(): string | null {
  try {
    return localStorage.getItem(ULTIMO);
  } catch {
    return null;
  }
}

function guardarUltimo(slug: string) {
  try {
    localStorage.setItem(ULTIMO, slug);
  } catch {
    // Private mode: the palette starts on the screen's project or the first one.
  }
}

/** ⌘K / Ctrl+K anywhere in the app: opens the palette, or closes it; never over another dialog. */
export function useAtajoPaleta(abierta: boolean, setAbierta: (v: boolean) => void, activo: boolean) {
  useEffect(() => {
    if (!activo) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const otroDialogo = !!document.querySelector('[role="dialog"]:not([data-paleta]), [role="alertdialog"]');
      const que = atajo({ key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey }, mac, { abierta, otroDialogo });
      if (!que) return;
      e.preventDefault();
      setAbierta(que === "abrir");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [abierta, setAbierta, activo]);
}

/** The header's way in: «Pedir ⌘K» on a computer, the icon alone on a phone. */
export function PaletaBoton({ onAbrir }: { onAbrir: () => void }) {
  const w = paletaWords();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9 gap-2 px-2.5 transition-[background-color,color,scale] active:scale-[0.97] motion-reduce:transition-none max-sm:size-9 max-sm:px-0"
      onClick={onAbrir}
      aria-label={w.abrir}
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      data-control="paleta-abrir"
    >
      <SendIcon aria-hidden />
      <span className="max-sm:sr-only">{w.abrir}</span>
      <kbd className="hidden rounded border bg-muted px-1.5 font-sans text-[11px] text-muted-foreground sm:inline" aria-hidden>
        {atajoTexto(mac)}
      </kbd>
    </Button>
  );
}

function FilaVista({ f, modo, texto, enviando, nombre }: { f: Fila; modo: AskMode; texto: string; enviando: boolean; nombre: (slug: string) => string }) {
  const w = paletaWords();
  if (f.kind === "pedir") {
    return (
      <>
        {enviando ? <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : <SendIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="grid min-w-0 flex-1">
          <span className="font-medium">{enviando ? w.enviando : modo === "pregunta" ? w.preguntarEn(nombre(f.slug)) : w.pedirEn(nombre(f.slug))}</span>
          <span className={cn("truncate text-xs", f.listo ? "text-foreground/80" : "text-muted-foreground")}>{f.listo ? texto.trim() : w.escribe}</span>
        </span>
      </>
    );
  }
  if (f.kind === "pantalla") {
    return (
      <>
        <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{f.label}</span>
      </>
    );
  }
  return (
    <>
      <ProjectMark slug={f.slug} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{f.title}</span>
      {f.kind === "destino" ? <span className="shrink-0 text-xs text-muted-foreground">{w.usar}</span> : null}
    </>
  );
}

export function Paleta({ abierta, onAbierta, proyectos, pantallas }: { abierta: boolean; onAbierta: (v: boolean) => void; proyectos: ProyectoLista[]; pantallas: Lugar[] }) {
  const w = paletaWords();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const campo = useRef<HTMLTextAreaElement>(null);
  const listaId = useId();
  const [texto, setTexto] = useState("");
  const [modo, setModo] = useState<AskMode>("forma");
  const [destino, setDestino] = useState<string | null>(null);
  const [activa, setActiva] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(false);

  // Each opening starts on the screen's project (or the last one asked); an unsent draft stays.
  useEffect(() => {
    if (!abierta) return;
    setDestino(proyectoInicial(proyectos.map((p) => p.slug), proyectoDeRuta(location.pathname, location.search), leerUltimo()));
    setActiva(0);
    setFallo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierta]);

  // The field grows with the words, as Inicio's did.
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_CAMPO_PX)}px`;
  }, [texto, abierta]);

  const filas = filasDe(texto, proyectos, pantallas, destino);
  const i = Math.min(activa, Math.max(filas.length - 1, 0));
  const nombre = (slug: string) => proyectos.find((p) => p.slug === slug)?.title ?? slug;
  const linea = MODES.find((m) => m.id === modo)?.line ?? "";

  async function enviar(slug: string) {
    const dicho = texto.trim();
    if (!dicho || enviando) return;
    setEnviando(true);
    setFallo(false);
    try {
      const r = await api.askProject(slug, { text: dicho, mode: modo });
      toast(askedLine({ ...r, mode: r.mode ?? modo }, nombre(slug)));
      guardarUltimo(slug);
      setTexto("");
      setModo("forma");
      onAbierta(false);
      void queryClient.invalidateQueries({ queryKey: ["project", slug] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch {
      // It stays open with the words, so nothing typed is lost.
      setFallo(true);
    } finally {
      setEnviando(false);
    }
  }

  function activar(f: Fila | undefined) {
    if (!f) return;
    if (f.kind === "pedir") return void enviar(f.slug);
    if (f.kind === "destino") {
      setDestino(f.slug);
      setTexto("");
      setActiva(0);
      campo.current?.focus();
      return;
    }
    onAbierta(false);
    navigate(f.to);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      setModo((m) => nextMode(m));
      return;
    }
    // Arrows choose a row while the words are one line; inside a longer text they move the caret.
    if (!texto.includes("\n")) {
      const j = mover(i, filas.length, e.key);
      if (j !== null) {
        e.preventDefault();
        setActiva(j);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      activar(filas[i]);
    }
  }

  const filaId = (n: number) => `${listaId}-${n}`;
  // The chosen row stays in view as the arrows move it (instantly: the key must feel immediate).
  useEffect(() => {
    if (abierta) document.getElementById(filaId(i))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, abierta]);
  const enArroba = texto.startsWith("@");

  return (
    <Dialog open={abierta} onOpenChange={(v) => !enviando && onAbierta(v)}>
      <DialogPortal>
        <DialogOverlay className="data-open:animate-none data-closed:animate-none max-sm:data-open:animate-in max-sm:data-open:fade-in-0 max-sm:data-closed:animate-out max-sm:data-closed:fade-out-0 max-sm:duration-200" />
        <DialogPrimitive.Content
          data-paleta
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            campo.current?.focus();
          }}
          className={cn(
            "fixed top-[14vh] left-1/2 z-50 grid w-[min(640px,calc(100%-2rem))] -translate-x-1/2 gap-0 overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 outline-none",
            // A phone: a sheet on the bottom edge, full width, clear of the home indicator.
            "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:translate-x-0 max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]",
            "max-sm:data-open:animate-in max-sm:data-open:slide-in-from-bottom max-sm:data-open:duration-300 max-sm:data-closed:animate-out max-sm:data-closed:slide-out-to-bottom max-sm:data-closed:duration-200 max-sm:ease-[cubic-bezier(0.32,0.72,0,1)]",
            "motion-reduce:max-sm:data-open:slide-in-from-bottom-0 motion-reduce:max-sm:data-closed:slide-out-to-bottom-0 motion-reduce:max-sm:data-open:fade-in-0 motion-reduce:max-sm:data-closed:fade-out-0",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{w.titulo}</DialogPrimitive.Title>

          <div className="flex items-start gap-2 border-b p-2">
            {/* Where the words go. A press (or typing @) lists the projects in the rows. */}
            {destino && !enArroba ? (
              <button
                type="button"
                className="flex h-11 max-w-[40%] shrink-0 items-center gap-1.5 rounded-lg bg-muted px-2.5 text-sm font-medium transition-[background-color,scale] active:scale-[0.97] motion-reduce:transition-none sm:h-9 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/70"
                aria-label={w.cambiarProyecto(nombre(destino))}
                onClick={() => {
                  setTexto("@");
                  setActiva(0);
                  campo.current?.focus();
                }}
                data-control="paleta-proyecto"
              >
                <ProjectMark slug={destino} className="size-4 shrink-0" />
                <span className="truncate">{nombre(destino)}</span>
              </button>
            ) : null}
            <textarea
              ref={campo}
              rows={1}
              value={texto}
              maxLength={ASK_MAX}
              onChange={(e) => {
                setTexto(e.target.value);
                setActiva(0);
                setFallo(false);
              }}
              onKeyDown={onKey}
              placeholder={enArroba ? w.placeholderDestino : w.placeholder}
              aria-label={w.campo}
              role="combobox"
              aria-expanded={filas.length > 0}
              aria-controls={listaId}
              aria-activedescendant={filas.length ? filaId(i) : undefined}
              aria-autocomplete="list"
              enterKeyHint={filas[i]?.kind === "pedir" ? "send" : "go"}
              className="min-h-11 flex-1 resize-none bg-transparent px-1.5 py-2.5 text-base outline-none placeholder:text-muted-foreground sm:min-h-9 sm:py-1.5 sm:text-sm"
              data-campo="paleta"
            />
          </div>

          {/* How: the three modes, as La corriente's bar has them. Shift+Tab steps through them from the field. */}
          {!enArroba ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2 text-xs text-muted-foreground">
              <span role="group" aria-label={w.como} className="inline-flex rounded-lg border p-0.5">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={modo === m.id}
                    data-mode={m.id}
                    onClick={() => {
                      setModo(m.id);
                      campo.current?.focus();
                    }}
                    className={cn("min-h-8 rounded-md px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60", modo === m.id ? "bg-secondary text-secondary-foreground" : "[@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground")}
                  >
                    {m.name}
                  </button>
                ))}
              </span>
              <span className="min-w-0 flex-1">{linea}</span>
              {texto.length > ASK_MAX * 0.9 ? (
                <span aria-live="polite" className="tabular-nums">
                  {texto.length} / {ASK_MAX}
                </span>
              ) : null}
            </div>
          ) : null}

          {fallo ? (
            <p role="alert" className="border-b bg-destructive/5 px-3 py-2 text-sm text-destructive" data-paleta-fallo>
              {w.fallo}
            </p>
          ) : null}

          {/* One listbox; each section (projects, pages) is a group under its own title. Pedir heads it, untitled. */}
          <div id={listaId} role="listbox" aria-label={w.titulo} className="grid max-h-[min(50svh,360px)] content-start gap-1 overflow-y-auto overscroll-contain p-1.5">
            {filas.length === 0 ? (
              <p className="px-2.5 py-3 text-muted-foreground">{w.nada}</p>
            ) : (
              agrupar(filas).map((g) => {
                const tituloId = g.seccion ? `${listaId}-${g.seccion}` : undefined;
                return (
                  <div key={`${g.seccion ?? "pedir"}-${g.filas[0]!.n}`} role="group" aria-labelledby={tituloId} className="grid" data-seccion-paleta={g.seccion ?? "pedir"}>
                    {g.seccion ? (
                      <p id={tituloId} className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                        {g.seccion === "paginas" ? w.paginas : w.proyectos}
                      </p>
                    ) : null}
                    {g.filas.map(({ fila: f, n }) => (
                      <div
                        key={`${f.kind}-${"slug" in f ? f.slug : f.to}`}
                        id={filaId(n)}
                        role="option"
                        aria-selected={n === i}
                        aria-disabled={f.kind === "pedir" && (!f.listo || enviando) ? true : undefined}
                        onMouseMove={() => n !== i && setActiva(n)}
                        onClick={() => activar(f)}
                        className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 sm:min-h-9", n === i && "bg-foreground/[0.07]")}
                        data-fila={f.kind}
                      >
                        <FilaVista f={f} modo={modo} texto={texto} enviando={enviando} nombre={nombre} />
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>

          {/* The keys, on a computer only. */}
          <p className="hidden flex-wrap gap-x-3 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground sm:flex" aria-hidden>
            <span>{w.teclas.enter}</span>
            <span>{w.teclas.flechas}</span>
            {!enArroba ? <span>{w.teclas.modo}</span> : null}
            <span>{w.teclas.arroba}</span>
            <span>{w.teclas.esc}</span>
          </p>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
