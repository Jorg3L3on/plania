// PLA-I65-2: La corriente of one thing, on a canvas, in two sizes: ficha (the open row, 124 px tall) and fila (the
// closed row, 22 px). The geometry and the model are in rio-geo.ts. A still frame is drawn on mount and on every
// change; only a thing with work in progress moves (water in its bed, the dam breathing while it waits on the owner,
// the tip of the channel being built), and never with «reducir movimiento». The stops, states and buttons are HTML
// around it (components/corriente/ficha.tsx); the canvas is role="img" with a sentence that says the same.
import { useEffect, useRef } from "react";
import { CX0, FX0, FX1, PX, SX, VX, W, X0, XE, chanPoint, frontOf, isAlive, rioLabel, widthAt, widths, type Chan, type RioModel } from "./rio-geo";

export type RioSize = "ficha" | "fila";
const H: Record<RioSize, number> = { ficha: 124, fila: 22 };
const LOGICAL_H = 124;
const CY = 64;

// The tokens of .cor (ui/src/corriente.css), read from the page; these are the same values as fallbacks.
const FALLBACK = { violet: "#8b5cf6", violet2: "#a78bfa", amber: "#ffb454", green: "#6ee7a0", surface: "#0c0c10", text: "#f4f4f6" };
type Tokens = typeof FALLBACK;
function tokensOf(el: Element): Tokens {
  const cs = getComputedStyle(el);
  const v = (name: string, d: string) => cs.getPropertyValue(name).trim() || d;
  return { violet: v("--cor-violet", FALLBACK.violet), violet2: v("--cor-violet-2", FALLBACK.violet2), amber: v("--cor-amber", FALLBACK.amber), green: v("--cor-green", FALLBACK.green), surface: v("--cor-surface", FALLBACK.surface), text: v("--cor-text", FALLBACK.text) };
}
const rgba = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${a})`;
};

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

type Particle = { u: number; v: number; sp: number; r: number };
const particles = (n: number): Particle[] => Array.from({ length: n }, (_, i) => ({ u: (i * 0.6180339) % 1, v: (((i * 0.7548776) % 1) - 0.5) * 1, sp: 0.05 + ((i * 0.5698403) % 1) * 0.07, r: 0.7 + ((i * 0.4142135) % 1) * 0.9 }));

/** One frame. t: seconds (0 for the still frame); P: the moving particles (none when still). */
export function drawRio(g: CanvasRenderingContext2D, m: RioModel, size: RioSize, cssW: number, tok: Tokens, t: number, P: Particle[] | null) {
  const sx = cssW / W;
  const sy = H[size] / LOGICAL_H;
  const X = (x: number) => x * sx;
  const Y = (y: number) => H[size] / 2 + (y - CY) * sy;
  const small = size === "fila";
  const ws = widths(m.delivered);
  const wAt = (x: number) => Math.max(small ? 1 : 2, widthAt(x, ws) * sy);
  const front = frontOf(m);
  g.clearRect(0, 0, cssW, H[size]);
  const band = (xa: number, xb: number, fill: string | CanvasGradient, glow?: string) => {
    if (xb <= xa) return;
    g.beginPath();
    for (let x = xa; x <= xb; x += 3) g.lineTo(X(x), Y(CY) - wAt(x) / 2);
    g.lineTo(X(xb), Y(CY) - wAt(xb) / 2);
    for (let x = xb; x >= xa; x -= 3) g.lineTo(X(x), Y(CY) + wAt(x) / 2);
    g.closePath();
    g.fillStyle = fill;
    g.shadowColor = glow ?? "transparent";
    g.shadowBlur = glow && !small ? 20 : 0;
    g.fill();
    g.shadowBlur = 0;
  };
  const n = m.chans.length;
  const span = 92;
  const cp = (k: number, s: number) => {
    const [x, y] = chanPoint(k, n, s, CY, span);
    return [X(x), Y(y)] as const;
  };
  // The dry bed: the whole way, the delta's channels and the stretch to the end.
  band(X0, FX0, "rgba(255,255,255,.055)");
  g.lineCap = "round";
  for (let k = 0; k < n; k++) {
    // In the row size a dry delta keeps every other bed, so it reads as channels and not as a block.
    if (small && n > 6 && k % 2 === 1 && m.chans[k] === "todo") continue;
    g.beginPath();
    for (let s = 0; s <= 1.0001; s += 0.025) g.lineTo(...cp(k, s));
    g.strokeStyle = small ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.07)";
    g.lineWidth = small ? 1 : 2.5;
    g.stroke();
  }
  g.fillStyle = "rgba(255,255,255,.055)";
  g.fillRect(X(FX1), Y(CY) - (small ? 1 : 3), X(XE) - X(FX1), small ? 2 : 6);
  // The water, up to where it reached.
  const grad = g.createLinearGradient(X(X0), 0, X(FX0), 0);
  grad.addColorStop(0, rgba(tok.violet, 0.5));
  grad.addColorStop(1, rgba(tok.violet2, 0.85));
  // PLA-63: an initiative born without an idea has water from the dam on.
  const W0 = m.born ? VX : X0;
  band(W0, Math.min(front, FX0), grad, rgba(tok.violet, 0.9));
  // The dam.
  const wait = m.dam === "wait";
  const open = m.dam === "open";
  if (wait && !small) {
    const pul = P ? 0.65 + 0.35 * Math.sin(t * 2.2) : 0.8;
    const rg = g.createRadialGradient(X(VX - 10), Y(CY), 2, X(VX - 10), Y(CY), 70);
    rg.addColorStop(0, rgba(tok.amber, 0.42 * pul));
    rg.addColorStop(1, rgba(tok.amber, 0));
    g.fillStyle = rg;
    g.fillRect(X(VX - 90), 0, X(170), H[size]);
  }
  g.fillStyle = wait ? tok.amber : open ? tok.violet2 : "rgba(255,255,255,.22)";
  const half = small ? 9 : 36;
  const gap = open ? (small ? 3 : 13) : 0;
  for (const x of [VX - 5, VX + 3]) {
    const bw = small ? 1.5 : 2.5;
    if (open) {
      g.fillRect(X(x), Y(CY) - half, bw, half - gap);
      g.fillRect(X(x), Y(CY) + gap, bw, half - gap);
    } else g.fillRect(X(x), Y(CY) - half, bw, half * 2);
  }
  // The delta: one channel per step, coloured by its state; the one being built stops half way, at its tip.
  const COL: Record<Exclude<Chan, "todo">, string> = { done: tok.violet2, you: tok.amber, live: "#ffffff", fin: tok.green };
  if (m.here >= 6) {
    for (let k = 0; k < n; k++) {
      const c = m.chans[k]!;
      if (c === "todo") continue;
      const lim = c === "live" ? 0.52 : 1;
      g.beginPath();
      for (let s = 0; s <= lim + 0.0001; s += 0.02) g.lineTo(...cp(k, s));
      g.strokeStyle = rgba(COL[c], c === "done" ? 0.8 : 0.95);
      g.lineWidth = small ? 1.2 : c === "done" || c === "fin" ? 3 : 3.6;
      g.shadowColor = rgba(c === "done" ? tok.violet : COL[c], 0.9);
      g.shadowBlur = small ? 0 : c === "done" ? 8 : 16;
      g.stroke();
      g.shadowBlur = 0;
      if (c === "live" && !small) {
        const [x, y] = cp(k, lim);
        g.beginPath();
        g.arc(x, y, 4, 0, 7);
        g.fillStyle = "#fff";
        g.shadowColor = rgba(tok.violet, 1);
        g.shadowBlur = 22;
        g.fill();
        g.shadowBlur = 0;
      }
    }
    if (m.here === 7) {
      g.fillStyle = rgba(tok.green, 0.9);
      g.shadowColor = rgba(tok.green, 0.8);
      g.shadowBlur = small ? 0 : 14;
      g.fillRect(X(FX1), Y(CY) - (small ? 1 : 3), X(PX) - X(FX1), small ? 2 : 6);
      g.shadowBlur = 0;
    }
  }
  // Moving water, only where there is work.
  if (P && !small) {
    P.forEach((p, i) => {
      if (i < 95) {
        const f = wait ? 1 - Math.pow(1 - p.u, 2.3) : p.u;
        const x = W0 + (Math.min(front, FX0) - W0) * f;
        const y = Y(CY) + p.v * wAt(x) * 0.82;
        g.fillStyle = `rgba(255,255,255,${0.25 + 0.5 * Math.abs(Math.sin(p.u * 9 + i))})`;
        g.fillRect(X(x), y, p.r * 1.6, p.r);
      } else if (m.here >= 6 && n) {
        const k = i % n;
        const c = m.chans[k]!;
        if (c !== "live" && c !== "you") return;
        const lim = c === "live" ? 0.52 : 1;
        const u = c === "live" ? (p.u * 2.4) % 1 : p.u;
        const [x, y] = cp(k, u * lim);
        g.fillStyle = "rgba(255,255,255,.75)";
        g.fillRect(x, y - 0.6, p.r * 1.8, 1.2);
      }
    });
  }
  // The stops and Publicado.
  const r = small ? 1.6 : 4;
  for (let i = 0; i < 6; i++) {
    if (i === m.here && !small) continue;
    const x = SX(i);
    g.beginPath();
    g.arc(X(x), Y(CY), i < m.here ? r : r + (small ? 0 : 0.5), 0, 7);
    if (!m.born && i <= m.here && x <= front + 1) {
      g.fillStyle = i === m.here ? (m.front === "you" ? tok.amber : "#ffffff") : "#ede9fe";
      g.fill();
      if (!small) {
        g.lineWidth = 2.5;
        g.strokeStyle = tok.surface;
        g.stroke();
      }
    } else {
      g.fillStyle = tok.surface;
      g.fill();
      g.lineWidth = small ? 0.8 : 1.2;
      g.strokeStyle = "rgba(255,255,255,.3)";
      g.stroke();
    }
  }
  g.beginPath();
  g.arc(X(PX), Y(CY), m.here === 7 ? (small ? 2.2 : 6) : r + (small ? 0 : 0.5), 0, 7);
  if (m.here === 7) {
    g.fillStyle = tok.green;
    g.shadowColor = rgba(tok.green, 0.9);
    g.shadowBlur = small ? 0 : 18;
    g.fill();
    g.shadowBlur = 0;
  } else {
    g.fillStyle = tok.surface;
    g.fill();
    g.lineWidth = small ? 0.8 : 1.2;
    g.strokeStyle = "rgba(255,255,255,.3)";
    g.stroke();
  }
}

// A key that changes when the drawing would.
const keyOf = (m: RioModel) => `${m.born ? "b" : ""}${m.here}|${m.delivered.map(Number).join("")}|${m.dam}|${m.front}|${m.chans.join(",")}`;

export const Corriente = ({ m, size = "ficha", className }: { m: RioModel; size?: RioSize; className?: string }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = keyOf(m);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d");
    if (!g) return;
    let raf = 0;
    let cssW = cv.clientWidth || W;
    const tok = tokensOf(cv);
    const moving = !reducedMotion() && size === "ficha" && isAlive(m);
    const P = moving ? particles(170) : null;
    const fit = () => {
      cssW = cv.clientWidth || cssW;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(H[size] * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const frame = (now: number) => {
      if (P) for (const [i, p] of P.entries()) p.u = (p.u + p.sp * 0.016 * (i % 3 === 0 ? 1.6 : 1)) % 1;
      drawRio(g, m, size, cssW, tok, now / 1000, P);
      if (P) raf = requestAnimationFrame(frame);
    };
    fit();
    // The still frame, always, before anything moves.
    drawRio(g, m, size, cssW, tok, 0, null);
    if (P) raf = requestAnimationFrame(frame);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => (fit(), drawRio(g, m, size, cssW, tok, 0, null))) : null;
    ro?.observe(cv);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size]);
  return <canvas ref={ref} className={`cor-rio-canvas ${size}${className ? ` ${className}` : ""}`} role="img" aria-label={rioLabel(m)} data-rio={m.here} data-rio-dam={m.dam} style={{ height: H[size] }} />;
};

// Re-exported so the ficha can place its HTML stops over the drawing.
export { CX0, FX0, PX, SX, VX, W };
