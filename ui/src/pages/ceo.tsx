// PLA-I62-9: Compañía is La corriente (PLA-IDEA25). The building is gone; its addresses still land: ?p=<slug> and
// ?vista=<slug> on the project page, ?equipo on Máquina (ceoRedirect), and ?edificio, ?piso, ?f, ?m, ?plan, ?add,
// ?nivel, ?decision, ?asistente and ?nuevo on their screen in La corriente (lib/corriente.ts fromBuilding).
import { Navigate, useLocation } from "react-router";
import { ceoRedirect } from "@/lib/compania";
import { fromBuilding } from "@/lib/corriente";
import { fichaOf } from "@/lib/ficha";
import { CorrientePage } from "@/pages/corriente";

export { useMinute } from "@/lib/use-minute";

// La corriente's own addresses (?v=pedir&p=<slug> picks Pedir's project) never take the building's old routes.
const OWN = ["v", "proyecto", "hoja", "t", "ver"];
export const ownAddress = (search: string) => OWN.some((k) => new URLSearchParams(search).has(k));

export const CeoPage = () => {
  const location = useLocation();
  if (ownAddress(location.search)) return <CorrientePage />;
  const to = ceoRedirect(location.search);
  if (to) return <Navigate to={to} replace />;
  const f = fichaOf(location.search);
  const moved = fromBuilding(location.search, f?.ref ?? null, f?.slug ?? null);
  if (moved !== null) return <Navigate to={`/ceo${moved}`} replace />;
  return <CorrientePage />;
};

/** /corriente, where La corriente was built: the same address under /ceo. */
export const CorrienteRedirect = () => {
  const location = useLocation();
  return <Navigate to={`/ceo${location.search}`} replace />;
};
