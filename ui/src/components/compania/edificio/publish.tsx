// PLA-23: publishing from the building. A floor whose finished changes wait to go out says so on its plate with a
// "Publicar" button (and its roof chip opens the same thing); this is what that button opens. It says what goes out
// (the changes by title, never a ticket key), from where to where in plain words, and publishes through the same
// route Bandeja uses (POST /api/projects/:slug/release/ship). PLA-24: no owner's code; this sheet is the confirm.
// Presentational: the page holds the sheet and the call, so test/edificio-ui.test.ts renders it with fake data.
import type { DecisionRelease } from "@/lib/api";
import { OWNER_CODE_WORDS } from "@/components/compania/sheets";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Why the server refused, in the floor's words.
export function publishError(code: string, detail: Record<string, unknown> = {}): string {
  if (OWNER_CODE_WORDS[code]) return OWNER_CODE_WORDS[code]!;
  if (code === "RELEASE_NOT_READY") {
    const why = String(detail.reason ?? "");
    if (why === "open_checks") return "Todavía hay puntos abiertos en esos cambios; ciérralos primero.";
    if (why === "before_steps") return "Antes hay un paso tuyo pendiente; hazlo primero.";
    if (why === "merged" || why === "nothing_to_ship") return "Ya no hay nada por publicar: alguien lo publicó.";
    if (why === "mode_command") return "Este proyecto se publica con un comando, no desde aquí. Está en Bandeja.";
    return "Ya no se puede publicar desde aquí; míralo en Bandeja.";
  }
  if (code === "RELEASE_MERGE_FAILED") return `GitHub no aceptó la publicación${detail.output ? `: ${String(detail.output)}` : "."}`;
  return `No se pudo publicar (${code}).`;
}

export const PublishBody = ({
  title,
  release,
  busy,
  error,
  onPublish,
  onCancel,
}: {
  title: string;
  release: DecisionRelease;
  busy?: boolean;
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
      {error && (
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
          {busy ? "Publicando…" : `Publicar ${plural(n, "cambio", "cambios")}`}
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
