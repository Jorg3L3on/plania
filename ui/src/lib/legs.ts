// PLA-I46-14: a delivery leg's look (complete, in course, next, postponed, not planned) and where the one light sits:
// on the leg in course, or on the next open one once it is complete. The Entrega strip that drew it on the floor is
// gone (PLA-I53-3, the stage board took its place); Oficina's façade and its city still paint the legs with it. Pure.
import type { OrgRouteLeg } from "./api";

export type LegLook = "done" | "now" | "next" | "off" | "unplanned" | "planned";

const complete = (l: OrgRouteLeg) => l.state === "done" || (l.total > 0 && l.done === l.total);

export function legLooks(legs: OrgRouteLeg[]): { looks: LegLook[]; lit: number } {
  const looks: LegLook[] = legs.map((l) => (complete(l) ? "done" : l.state === "here" ? "now" : l.postponed ? "off" : l.state === "unplanned" ? "unplanned" : "planned"));
  const here = legs.findIndex((l) => l.state === "here");
  if (here >= 0 && looks[here] === "now") return { looks, lit: here };
  const open = (i: number) => looks[i] !== "done" && looks[i] !== "off";
  const from = here >= 0 ? here + 1 : 0;
  let next = legs.findIndex((_, i) => i >= from && open(i));
  if (next < 0) next = legs.findIndex((_, i) => open(i));
  if (next >= 0) looks[next] = "next";
  return { looks, lit: next };
}
