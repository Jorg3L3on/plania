// PLA-I74-6: «Revisar proyecto», the card at the top of Máquinas. One line: the title, how the last pass went and when,
// the eight steps as chips (name, time, coloured by result) and the button. A chip opens its detail below (what it
// found and, on a failure, the last lines it printed). Rules and words in lib/revision.ts.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { REVISION_UI, firstOpen, stateWord, stepName, stepsOf, summaryOf, timeText, type RevisionRead, type StepId } from "@/lib/revision";
import { Btn } from "./parts";

export const revisionKey = (slug: string) => ["revision", slug] as const;

export const useRevision = (slug: string) =>
  useQuery<RevisionRead>({
    queryKey: revisionKey(slug),
    queryFn: () => api.revision(slug).then((x) => x.revision),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : 60_000),
    retry: 0,
  });

export const Revision = ({ slug }: { slug: string }) => {
  const w = words(REVISION_UI);
  const client = useQueryClient();
  const q = useRevision(slug);
  const [open, setOpen] = useState<StepId | null | undefined>(undefined);
  const start = useMutation({
    mutationFn: () => api.revisar(slug),
    onSuccess: (x) => {
      client.setQueryData(revisionKey(slug), x.revision);
      toast(x.started ? w.started : w.already);
    },
  });
  const r = q.data;
  if (!r) return null;
  const sum = summaryOf(r, Date.now());
  const last = r.last;
  const shown = open === undefined ? firstOpen(last) : open;
  const steps = last ? stepsOf(last) : [];
  const detail = steps.find((s) => s.id === shown);
  return (
    <section className="rv" data-revision={sum.tone} aria-label={w.title}>
      <div className="rv-row">
        <div className="rv-tt">
          <h3>{w.title}</h3>
          <span className={`rv-sum ${sum.tone}`} role="status">
            {sum.text}
          </span>
        </div>
        {steps.length > 0 && (
          <ol className="rv-steps">
            {steps.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`rv-step ${s.estado} ${shown === s.id ? "on" : ""} ${r.running?.step === s.id ? "live" : ""}`}
                  aria-pressed={shown === s.id}
                  onClick={() => setOpen(shown === s.id ? null : s.id)}
                  title={`${stepName(s.id)}: ${stateWord(s.estado)}`}
                  data-paso={s.id}
                  data-estado={s.estado}
                >
                  <span className="rv-dot" aria-hidden />
                  {stepName(s.id)}
                  {s.estado !== "omitido" && <small>{timeText(s.ms)}</small>}
                </button>
              </li>
            ))}
          </ol>
        )}
        <Btn kind={last && last.ok ? "secondary" : "primary"} small disabled={!r.available || !!r.running || start.isPending} onClick={() => start.mutate()} data-control="revisar">
          {w.button}
        </Btn>
      </div>
      {detail && (
        <div className={`rv-detail ${detail.estado}`} data-detalle={detail.id}>
          <p>
            <b>{stepName(detail.id)}</b> · {stateWord(detail.estado)} · {detail.detalle ?? w.noDetail}
          </p>
          {detail.id === "arranque" && detail.estado === "ok" && last?.cold_start_ms ? <p className="rv-note">{w.coldStart(Math.round(last.cold_start_ms / 1000))}</p> : null}
          {detail.tail && <pre>{detail.tail}</pre>}
        </div>
      )}
    </section>
  );
};
