// PLA-I62: La corriente, Compañía redesigned (PLA-IDEA25). Built at /corriente while /ceo keeps the building; PLA-I62-9
// makes it /ceo. Data and calls are the ones /ceo uses (GET /api/company and friends); only the drawing is new.
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { Head } from "@/components/corriente/header";
import { NotYet, ReadError } from "@/components/corriente/parts";
import { Piezas } from "@/components/corriente/piezas";
import { api } from "@/lib/api";
import { atOf, hrefOf, legacyHref } from "@/lib/corriente";
import { pending } from "@/lib/v2";
import { useMinute } from "@/pages/ceo";

export const CorrientePage = () => {
  const location = useLocation();
  const at = atOf(location.search);
  const now = useMinute();
  const comp = useQuery({ queryKey: ["company"], queryFn: api.company, staleTime: 10_000, refetchInterval: 20_000 });
  const company = comp.data;
  const timeZone = company?.week.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const waiting = (company?.decisions ?? []).filter(pending).length;

  return (
    <div className="cor" data-corriente={at.slug ? `proyecto:${at.tab}` : at.view}>
      <span className="cor-aura" aria-hidden />
      <Head
        view={at.slug ? null : at.view}
        waiting={waiting}
        asistenteUnread={company?.asistente.unread ?? 0}
        now={now}
        timeZone={timeZone}
        pedirTo={legacyHref({})}
        tocaTo={hrefOf({ view: "tetoca" })}
      />
      <div className="cor-main">
        {at.view === "piezas" ? (
          <Piezas />
        ) : comp.isError && !company ? (
          <ReadError what="la compañía" onRetry={() => void comp.refetch()} />
        ) : (
          <NotYet what={at.slug ? "Este proyecto" : at.view === "tetoca" ? "Te toca" : at.view === "asistente" ? "Asistente" : at.view === "pedir" ? "Pedir" : "La corriente"} to={legacyHref(at)} />
        )}
      </div>
    </div>
  );
};
