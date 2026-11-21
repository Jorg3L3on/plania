// PLA-I62-1: La corriente's pieces (board D4, Piezas). Buttons 44px tall; one white primary per view; Pedir always
// secondary; amber only for what waits on the owner; the project's colour only in its logo. No pills, no clickable divs.
import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { ProjectMark } from "@/components/plania-mark";
import { PARTS } from "@/lib/corriente-parts-words";
import { words } from "@/lib/i18n";

export type BtnKind = "primary" | "secondary" | "quiet" | "amber" | "danger" | "link";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export const Btn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; small?: boolean }>(function Btn(
  { kind = "secondary", small, className, type = "button", ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={cls("cor-btn", kind, small && "small", className)} {...rest} />;
});

/** A link that looks like a button (navigation, never an action). */
export const BtnLink = ({ to, kind = "secondary", className, children, ...rest }: { to: string; kind?: BtnKind; className?: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) => (
  <Link to={to} className={cls("cor-btn", kind, className)} {...rest}>
    {children}
  </Link>
);

/** One option of a segmented choice: 44px, radius 10, violet when chosen. */
export const Opt = ({ on, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) => (
  <button type="button" aria-pressed={on} className={cls("cor-opt", className)} {...rest} />
);

export const Label = ({ children, tone, as: As = "span", className, ...rest }: { children: ReactNode; tone?: "amber" | "violet"; as?: "span" | "h2" | "h3" | "p" | "dt"; className?: string } & React.HTMLAttributes<HTMLElement>) => (
  <As className={cls("cor-label", tone, className)} {...rest}>
    {children}
  </As>
);

export const Key = ({ children }: { children: ReactNode }) => <span className="cor-key">{children}</span>;

export type StateTone = "live" | "amber" | "ok" | "bad" | undefined;
export const State = ({ children, tone }: { children: ReactNode; tone?: StateTone }) => <span className={cls("cor-state", tone)}>{children}</span>;

// ---- lights

/** Work waiting in its stage. Grey when it waits on a teammate or on publication. */
export const Dot = ({ grey }: { grey?: boolean }) => <span aria-hidden className={cls("cor-dot", grey && "grey")} />;
/** An agent working: white with a violet halo that breathes. */
export const Agent = ({ small }: { small?: boolean }) => <span aria-hidden className={cls("cor-agent", small && "small")} />;
/** Te toca: the amber rhombus, the only warm light. */
export const You = ({ small, flat }: { small?: boolean; flat?: boolean }) => <span aria-hidden className={cls("cor-you", small && "small", flat && "flat")} />;
/** The small live light (EN VIVO). */
export const Live = () => <span aria-hidden className="cor-live" />;

/** The project's logo, the one place its colour shows. */
/** The project's own mark, as on Inicio (PLA-59); a project with no logo yet gets its monogram. */
export const Logo = ({ slug, title, size }: { slug: string; title: string; size?: "sm" | "md" }) => (
  <ProjectMark slug={slug} name={title} fallback className={cls("cor-logo", size)} />
);

/** A section not drawn in La corriente yet: it says so and links to where it lives today. */
export const NotYet = ({ what, to }: { what: string; to: string }) => (
  <div className="cor-empty" data-not-yet={what}>
    <p className="cor-text">{words(PARTS).notYet(what)}</p>
    <BtnLink to={to} kind="secondary">
      {words(PARTS).openInBuilding(what.toLowerCase())}
    </BtnLink>
  </div>
);

/** What a part says when it cannot be read. */
export const ReadError = ({ what, onRetry }: { what: string; onRetry: () => void }) => (
  <div className="cor-empty" role="alert" data-error={what}>
    <p className="cor-text">{words(PARTS).readError(what)}</p>
    <Btn kind="secondary" onClick={onRetry}>
      {words(PARTS).retry}
    </Btn>
  </div>
);

/** A switch: 44px tall, the state said in words beside it (never by colour alone). */
export const Switch = ({ on, label, onChange, disabled, ...rest }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean } & Omit<React.HTMLAttributes<HTMLButtonElement>, "onChange">) => (
  <button type="button" role="switch" aria-checked={on} className="cor-switch" onClick={() => onChange(!on)} disabled={disabled} {...rest}>
    <i aria-hidden />
    <span>
      {label} · {on ? words(PARTS).on : words(PARTS).off}
    </span>
  </button>
);

/** PLA-136: one request per write, whoever calls it. Wraps a mutationFn: while a call is on its way, another call
 *  gets the same promise instead of sending a second request (a double click on Enseñar, Crear or Duplicar wrote
 *  twice). Use it where the button has no useOnce of its own. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useSingleFlight<F extends (...args: any[]) => Promise<unknown>>(fn: F): F {
  const flight = useRef<Promise<unknown> | null>(null);
  return ((...args: Parameters<F>) => {
    if (flight.current) return flight.current;
    const p: Promise<unknown> = fn(...args).finally(() => {
      if (flight.current === p) flight.current = null;
    });
    flight.current = p;
    return p;
  }) as F;
}

/** PLA-I71: one write per click. A second click while the first is on its way does nothing (a triple click on a save
 *  sent three writes before the button could disable). sticky: a one-time action (accept, add, retire, adopt, import)
 *  stays locked after it succeeded, until key changes (another role picked, another proposal); an error unlocks it.
 *  run returns the write's promise; its error stays the mutation's. */
export function useOnce(opts: { sticky?: boolean; key?: unknown } = {}): (run: () => Promise<unknown>) => void {
  const busy = useRef(false);
  const key = useRef(opts.key);
  if (key.current !== opts.key) {
    key.current = opts.key;
    busy.current = false;
  }
  return (run) => {
    if (busy.current) return;
    busy.current = true;
    void run().then(
      () => {
        if (!opts.sticky) busy.current = false;
      },
      () => {
        busy.current = false;
      },
    );
  };
}
