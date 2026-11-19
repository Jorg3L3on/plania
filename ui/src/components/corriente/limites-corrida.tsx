// PLA-I2-6: Plomería's «Cada corrida» block: the turns, minutes and rest between runs every run meets. Each field saves
// alone (PUT /api/company/settings). Wording and bounds: @/lib/limites-corrida.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { LIMITES_CORRIDA, LIMITES_TEXTO, LIMITES_TITULO, deFabrica, limiteAviso, limiteValor, type LimiteCorrida } from "@/lib/limites-corrida";
import { Btn, Label } from "./parts";

const Fila = ({ k, value, canEdit, onSaved }: { k: LimiteCorrida; value: number; canEdit: boolean; onSaved: () => void }) => {
  const [text, setText] = useState(String(value));
  const save = useMutation({
    mutationFn: (n: number) => api.setRunnerSettings({ [k]: n }),
    onSuccess: () => (toast("Guardado"), onSaved()),
    onError: () => toast.error("No se pudo guardar"),
  });
  const l = LIMITES_CORRIDA[k];
  const n = limiteValor(k, text);
  const id = `limite-${k}`;
  return (
    <form
      className="cor-ajuste-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (n !== null) save.mutate(n);
      }}
      data-limite={k}
    >
      <span className="cor-ajustes-nota-tx">
        <label className="cor-text" htmlFor={id}>
          <b>{l.label}</b>
        </label>
        <span className="cor-cap">{`${l.texto} ${deFabrica(k)}`}</span>
        {n === null && <span className="cor-state amber">{limiteAviso(k)}</span>}
      </span>
      <input id={id} inputMode="numeric" className="cor-input cor-mono" style={{ width: 90 }} value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} />
      {canEdit && n !== null && n !== value && (
        <Btn kind="secondary" type="submit" disabled={save.isPending} data-control={`guardar-${id}`}>
          Guardar
        </Btn>
      )}
    </form>
  );
};

export const LimitesCorrida = ({ settings, canEdit, onSaved }: { settings: Record<LimiteCorrida, number>; canEdit: boolean; onSaved: () => void }) => (
  <section aria-label={LIMITES_TITULO} data-block="cada-corrida">
    <Label as="h2">{LIMITES_TITULO}</Label>
    <p className="cor-cap">{LIMITES_TEXTO}</p>
    {(Object.keys(LIMITES_CORRIDA) as LimiteCorrida[]).map((k) => (
      <Fila key={`${k}:${settings[k]}`} k={k} value={settings[k]} canEdit={canEdit} onSaved={onSaved} />
    ))}
  </section>
);
