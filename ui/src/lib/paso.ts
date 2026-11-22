// PLA-157: pure rules of a step's detail (components/corriente/tablero.tsx), tested without a browser. No "@/" imports.

export type PrChip = "merged" | "open" | "closed";

/** The PR chip: the PR's own state when the server knows it; the ticket's status only when it does not.
 * A step closed Done with its PR still open read «Fusionado» (PLA-157 a). */
export function prChip(status: string, prState: string | null | undefined): PrChip {
  const s = (prState ?? "").toLowerCase();
  if (s === "merged" || s === "open" || s === "closed") return s;
  return status === "Merged" || status === "Released" || status === "Done" ? "merged" : "open";
}

/** Where «Reabrir» puts a step back (owner decision for PLA-157 b): In review, so its delivery card can come back. */
export const REOPEN_TO = "In review";

/** PLA-160 (F-34): a step with no muestra has no delivery card to bring back; In review drew an empty
 * «Esta entrega no tiene fotos» card. It goes to Ready instead, so the team redoes it. */
export const REDO_TO = "Ready";

export function reopenTo(hasMuestra: boolean): string {
  return hasMuestra ? REOPEN_TO : REDO_TO;
}

/** «Reabrir» shows on a closed step (Done or Won't do), never on an initiative or an idea. */
export function canReopen(t: { kind: string; status: string }): boolean {
  return t.kind === "ticket" && (t.status === "Done" || t.status === "Won't do");
}

/** The patch «Reabrir» sends: the lifecycle's reopen is the owner's and needs a reason; null while it is empty. */
export function reopenPatch(reason: string, version: number, hasMuestra: boolean): { status: string; reason: string; version: number } | null {
  const r = reason.trim();
  return r ? { status: reopenTo(hasMuestra), reason: r, version } : null;
}
