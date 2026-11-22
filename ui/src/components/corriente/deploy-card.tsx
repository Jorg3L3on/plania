// PLA-I74-8: the production deploy in the ficha. A failed one is a red bar with «Pedir arreglo» (a Taller step that
// carries the log, src/api/deploy-fix.ts) and the log itself in «Publicado»; one still building or waiting for the
// production address to answer says so, so a failed release never reads as a slow one.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { api, type IdeaBuilt, type IdeaDeploy } from "@/lib/api";
import { FICHA_WORDS } from "@/lib/ficha-words";
import { words } from "@/lib/i18n";
import { Btn, Label } from "./parts";

const say = () => words(FICHA_WORDS).deploy;

export function usePedirArreglo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { slug: string; key: string }) => api.pedirArreglo(v.slug, v.key),
    onSuccess: () => {
      toast(say().asked);
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["idea"] });
    },
    onError: () => toast.error(say().askFailed),
  });
}

/** The bar's label and sentence for a deploy that is not in production yet. */
export const deployBarOf = (d: IdeaDeploy): { label: string; line: string; tone: "bad" | "live" } => {
  const w = say();
  if (d.state === "error") return { label: w.error, line: d.fix_key ? w.fixing : w.errorLine, tone: "bad" };
  if (d.state === "building") return { label: w.building, line: w.buildingLine, tone: "live" };
  return { label: w.checking, line: w.checkingLine, tone: "live" };
};

export const DeployBar = ({ slug, b, paso }: { slug: string; b: IdeaBuilt & { deploy: IdeaDeploy }; paso: (key: string) => string }) => {
  const w = say();
  const pedir = usePedirArreglo();
  const d = b.deploy;
  const bar = deployBarOf(d);
  return (
    <div className={`cor-ficha-ahora ${bar.tone}`} data-ahora={bar.tone} data-deploy={d.state} role="region" aria-label={bar.label}>
      <i className="cor-ficha-gl" aria-hidden />
      <div className="cor-ficha-ahora-tx">
        <Label tone={bar.tone === "live" ? "violet" : undefined} className={bar.tone === "bad" ? "bad" : undefined}>
          {bar.label}
        </Label>
        <p>{bar.line}</p>
      </div>
      {d.state === "error" &&
        (d.fix_key ? (
          <Link className="cor-btn secondary" to={paso(d.fix_key)} data-control="ficha-ver-arreglo">
            {w.seeFix}
          </Link>
        ) : (
          <Btn kind="primary" disabled={pedir.isPending} onClick={() => pedir.mutate({ slug, key: b.key })} data-control="ficha-pedir-arreglo">
            {pedir.isPending ? w.asking : w.askFix}
          </Btn>
        ))}
    </div>
  );
};

/** «Publicado» while the production build has failed: the host's log, and its page. */
export const DeployLog = ({ d }: { d: IdeaDeploy }) => {
  const w = say();
  return (
    <div className="cor-ficha-deploy" data-deploy-log>
      <Label className="bad">{w.errorEmpty}</Label>
      <span className="cor-text">{w.log}</span>
      {d.log ? <pre className="cor-ficha-deploy-log">{d.log}</pre> : <span className="cor-text">{w.noLog}</span>}
      {d.url && (
        <a className="cor-btn quiet" href={d.url} target="_blank" rel="noreferrer">
          {w.hostPage}
        </a>
      )}
    </div>
  );
};
