// PLA-23: publishing from the building. A floor whose finished changes wait to go out says so on its plate with a
// "Publicar" button (and its roof chip opens the same thing); this is what that button opens. It says what goes out
// (the changes by title, never a ticket key), from where to where in plain words, and publishes through the same
// route Bandeja uses (POST /api/projects/:slug/release/ship). PLA-24: no owner's code; this sheet is the confirm.
// Presentational: the page holds the sheet and the call, so test/edificio-ui.test.ts renders it with fake data.
// The sheet never just closes: while it publishes it says so with a running clock, and when it is done it stays open
// and says what went out and where (the PR), until the owner closes it. A refusal stays in it with what to do.
import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { DecisionRelease } from "@/lib/api";
import type { ShipResult } from "@/lib/types";
import { OWNER_CODE_WORDS } from "@/components/compania/sheets";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Why the server refused, in the floor's words.
export function publishError(code: string, detail: Record<string, unknown> = {}): string {
  if (OWNER_CODE_WORDS[code]) return OWNER_CODE_WORDS[code]!;
  if (code === "RELEASE_NOT_READY") {
    const why = String(detail.reason ?? "");
    if (why === "open_checks") return "Todavía hay puntos abiertos en esos cambios; ciérralos primero.";
    if (why === "before_steps") return "Antes hay un paso tuyo pendiente; hazlo primero.";
    if (why === "merged") return "Ya está publicado: estos cambios ya están en la versión principal. Puedes cerrar esto.";
    if (why === "nothing_to_ship") return "Ya no hay nada por publicar: estos cambios ya están en la versión principal.";
    if (why === "mode_command") return "Este proyecto se publica con un comando, no desde aquí. Está en Bandeja.";
    return "Ya no se puede publicar desde aquí; míralo en Bandeja.";
  }
  if (code === "RELEASE_MERGE_FAILED") return `GitHub no aceptó la publicación${detail.output ? `: ${String(detail.output)}` : "."}`;
  return `No se pudo publicar (${code}).`;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// While the ship call runs: what is happening, from where to where, and for how long.
export const PublishWorking = ({ release, since, now }: { release: DecisionRelease; since: number; now?: number }) => {
  const [t, setT] = useState(() => now ?? Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    const id = window.setInterval(() => setT(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [now]);
  return (
    <div role="status" aria-live="polite" className="grid gap-1.5 rounded-xl bg-muted/60 px-4 py-3" data-publish-working>
      <p className="flex items-center gap-2 font-semibold">
        <Loader2Icon className="size-4 shrink-0 animate-spin" aria-hidden />
        Publicando en GitHub…
        <span className="ml-auto font-mono text-xs font-normal tabular-nums text-muted-foreground" data-publish-clock>
          {clock(t - since)}
        </span>
      </p>
      <p className="text-muted-foreground">
        Se abre la propuesta {release.from} → {release.into} y se fusiona. Suele tardar menos de un minuto; no hace falta que hagas nada.
      </p>
    </div>
  );
};

// Done: it stays open and says what went out.
export const PublishDone = ({ title, release, result, onClose }: { title: string; release: DecisionRelease; result: ShipResult; onClose: () => void }) => {
  const n = release.tickets.length;
  return (
    <div className="grid gap-4 text-sm" data-publish-done>
      <div role="status" className="grid gap-1 rounded-xl bg-muted/60 px-4 py-3">
        <p className="font-semibold">
          <span aria-hidden className="text-ink-done">
            ✓{" "}
          </span>
          Publicado. {plural(n, "cambio", "cambios")} de {title} ya {n === 1 ? "está" : "están"} en la versión principal.
        </p>
        <p className="text-muted-foreground">
          {release.from} → {release.into} fusionado ({result.merge_sha.slice(0, 7)}).{" "}
          <a href={result.pr.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Ver en GitHub (#{result.pr.number})
          </a>
        </p>
        <p className="text-muted-foreground">El piso ya no lo pide y queda en Lo último.</p>
      </div>
      <ul className="grid gap-1.5" aria-label="Lo que se publicó">
        {release.tickets.map((t) => (
          <li key={t.key} className="flex items-baseline gap-2">
            <span aria-hidden className="text-ink-done">
              ✓
            </span>
            <span>{t.title}</span>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-sm font-semibold text-background hover:opacity-90" onClick={onClose} data-control="publicar-listo">
          Listo
        </button>
      </div>
    </div>
  );
};

export const PublishBody = ({
  title,
  release,
  busy,
  since,
  error,
  onPublish,
  onCancel,
}: {
  title: string;
  release: DecisionRelease;
  busy?: boolean;
  since?: number | null;
  error?: string | null;
  onPublish: () => void;
  onCancel: () => void;
}) => {
  const n = release.tickets.length;
  const blocked = release.open_checks > 0 || release.before > 0;
  return (
    <div className="grid gap-4 text-sm" data-publish={title}>
      <p>
        {plural(n, "cambio terminado", "cambios terminados")} de {title} {n === 1 ? "pasa" : "pasan"} de la copia de prueba a la versión principal
        <span className="text-muted-foreground">
          {" "}
          ({release.from} → {release.into}
          {release.ahead != null ? `, ${plural(release.ahead, "commit", "commits")}` : ""})
        </span>
        .
      </p>
      <ul className="grid gap-1.5" aria-label="Lo que se publica" data-publish-list={n}>
        {release.tickets.map((t) => (
          <li key={t.key} className="flex items-baseline gap-2">
            <span aria-hidden className="text-ink-done">
              ✓
            </span>
            <span>{t.title}</span>
          </li>
        ))}
      </ul>
      {blocked && (
        <p className="font-medium text-ink-now" data-publish-blocked>
          {release.open_checks > 0 ? `${plural(release.open_checks, "punto abierto", "puntos abiertos")} en estos cambios` : `${plural(release.before, "paso tuyo", "pasos tuyos")} antes de publicar`}: GitHub lo
          rechazará hasta que se resuelva.
        </p>
      )}
      {busy && since != null && <PublishWorking release={release} since={since} />}
      {error && !busy && (
        <p role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-destructive" data-publish-error>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-40"
          disabled={busy}
          onClick={onPublish}
          data-control="publicar-confirmar"
        >
          {busy ? "Publicando…" : error ? "Intentar de nuevo" : `Publicar ${plural(n, "cambio", "cambios")}`}
        </button>
        <button type="button" className="inline-flex min-h-11 items-center rounded-full px-5 text-sm ring-1 ring-foreground/15 hover:bg-muted" onClick={onCancel} disabled={busy}>
          Ahora no
        </button>
      </div>
    </div>
  );
};

// Brings the question hanging on a floor into view and marks it for a moment, so the click visibly lands.
// With no bubble on that floor, the roof (Tu oficina) is where the decision is.
export function revealQuestion(slug: string): void {
  const el = document.getElementById(`pregunta-${slug}`) ?? document.querySelector<HTMLElement>("[data-roof]");
  if (!el) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  el.setAttribute("data-flash", "1");
  window.setTimeout(() => el.removeAttribute("data-flash"), 1600);
  el.querySelector<HTMLElement>("button, a, summary")?.focus({ preventScroll: true });
}
