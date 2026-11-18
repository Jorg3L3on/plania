// PLA-I62-3/4: Pedir ajuste, the building's Devolver a Taller: one reason, one optional line, the pins on the pictures;
// Taller reads «reason: line» as a note (the same cambios text).
import { useState } from "react";
import type { Decision, Marca } from "@/lib/api";
import { NOTE_MAX, RETURN_REASONS, returnText } from "@/lib/evidencia";
import type { CorrienteActs } from "./acts";
import { Btn, Label } from "./parts";

export const Ajuste = ({ d, acts, onDone, marcas = [] }: { d: Decision; acts: CorrienteActs; onDone: () => void; marcas?: Marca[] }) => {
  const [reason, setReason] = useState<string>(RETURN_REASONS[0]);
  const [line, setLine] = useState("");
  const busy = acts.decisions.busy?.id === d.id;
  return (
    <form
      className="cor-ajuste"
      data-ajuste={d.id}
      onSubmit={(e) => {
        e.preventDefault();
        acts.decisions.decide(d, { action: "cambios", text: returnText(reason, line), ...(marcas.length ? { marcas } : {}) }, "devolver");
        onDone();
      }}
    >
      <Label as="p" id={`aj-${d.id}`}>
        Pedir ajuste a Taller
      </Label>
      <div className="cor-seg" role="radiogroup" aria-labelledby={`aj-${d.id}`}>
        {RETURN_REASONS.map((x) => (
          <button key={x} type="button" role="radio" aria-checked={reason === x} className="cor-opt" onClick={() => setReason(x)} disabled={busy} data-reason={x}>
            {x}
          </button>
        ))}
      </div>
      {marcas.length > 0 && (
        <p className="cor-cap" data-marcas={marcas.length}>
          Van tus {marcas.length} {marcas.length === 1 ? "marca" : "marcas"}, cada una con su foto.
        </p>
      )}
      <div className="cor-ajuste-row">
        <textarea
          className="cor-input cor-ajuste-text"
          value={line}
          maxLength={NOTE_MAX}
          rows={3}
          placeholder="Qué cambiarías, para Taller (opcional)"
          aria-label="Nota para Taller"
          aria-describedby={line.length > NOTE_MAX * 0.9 ? `aj-n-${d.id}` : undefined}
          onChange={(e) => setLine(e.target.value)}
          disabled={busy}
        />
        {line.length > NOTE_MAX * 0.9 && (
          <span className="cor-cap" id={`aj-n-${d.id}`} aria-live="polite">
            {line.length} / {NOTE_MAX}
          </span>
        )}
        <Btn kind="secondary" type="submit" disabled={busy} data-control="enviar-ajuste">
          Enviar a Taller
        </Btn>
        <Btn kind="quiet" onClick={onDone}>
          Cancelar
        </Btn>
      </div>
    </form>
  );
};

