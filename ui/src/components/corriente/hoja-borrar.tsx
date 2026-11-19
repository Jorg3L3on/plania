// NEWPROJ-7: Borrar proyecto, a sheet like the others in hojas.tsx (?hoja=borrar:<slug>). It names the project, says
// what stops, what goes and what stays (its code and repo), and needs the project's name typed and the owner's code
// before the button turns on. The words are in lib/borrar.ts. After the delete the screen goes back to the company.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, type OrgProject } from "@/lib/api";
import { BORRAR_WORDS, borrarButton, borrarDone, borrarError, borrarRows, borrarTitle, borrarUndo, canBorrar, nameHint } from "@/lib/borrar";
import { words } from "@/lib/i18n";
import { Hoja } from "./hojas";
import { Btn } from "./parts";

export const BorrarProyecto = ({ p, onClose, onDone }: { p: OrgProject; onClose: () => void; onDone: () => void }) => {
  const w = words(BORRAR_WORDS);
  const client = useQueryClient();
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState("");
  const running = p.team.filter((m) => m.state === "running").length;
  const del = useMutation({
    mutationFn: () => api.deleteProject(p.slug, code),
    onSuccess: () => {
      toast(borrarDone(p.title));
      void client.invalidateQueries({ queryKey: ["company"] });
      onDone();
    },
    onError: () => setCode(""),
  });
  const ready = canBorrar(typed, p.title, code) && !del.isPending;
  return (
    <Hoja label={w.sheet} title={borrarTitle(p.title)} onClose={onClose}>
      <dl className="cor-hoja-rows">
        {borrarRows(p.title, running).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="cor-cap">{borrarUndo()}</p>
      <form
        className="cor-hoja-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) del.mutate();
        }}
      >
        <span className="cor-hoja-two">
          <label style={{ flex: 2 }}>
            <span className="cor-text">{nameHint(p.title)}</span>
            <input className="cor-input" value={typed} maxLength={80} autoComplete="off" onChange={(e) => setTyped(e.target.value)} data-control="borrar-nombre" />
          </label>
          <label>
            <span className="cor-text">{w.code}</span>
            <input
              className="cor-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-label={w.code}
              data-control="borrar-codigo"
            />
          </label>
        </span>
        {del.isError && <p className="cor-state bad">{borrarError(del.error instanceof ApiError ? del.error.code : "")}</p>}
        <div className="cor-acts">
          <Btn kind="danger" type="submit" disabled={!ready} data-control="borrar-si">
            {borrarButton(p.title, del.isPending)}
          </Btn>
          <Btn kind="quiet" onClick={onClose}>
            {w.cancel}
          </Btn>
        </div>
      </form>
    </Hoja>
  );
};
