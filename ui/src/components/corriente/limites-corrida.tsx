// PLA-I2-6: Plomería's «Cada corrida» block: the turns, minutes and rest between runs every run meets. Each field saves
// alone (PUT /api/company/settings). Wording and bounds: @/lib/limites-corrida.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { LIMITES_WORDS, deFabrica, limiteAviso, limitesCorrida, limiteValor, type LimiteCorrida } from "@/lib/limites-corrida";
import { Btn, Label } from "./parts";

const Fila = ({ k, value, canEdit, onSaved }: { k: LimiteCorrida; value: number; canEdit: boolean; onSaved: () => void }) => {
  const w = words(LIMITES_WORDS);
  const [text, setText] = useState(String(value));
  const save = useMutation({
    mutationFn: (n: number) => api.setRunnerSettings({ [k]: n }),
    onSuccess: () => (toast(w.guardado), onSaved()),
    onError: () => toast.error(w.noGuardo),
  });
  const l = limitesCorrida()[k];
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
          {w.guardar}
        </Btn>
      )}
    </form>
  );
};

export const LimitesCorrida = ({ settings, canEdit, onSaved }: { settings: Record<LimiteCorrida, number>; canEdit: boolean; onSaved: () => void }) => {
  const w = words(LIMITES_WORDS);
  return (
    <section aria-label={w.titulo} data-block="cada-corrida">
      <Label as="h2">{w.titulo}</Label>
      <p className="cor-cap">{w.texto}</p>
      {(Object.keys(limitesCorrida()) as LimiteCorrida[]).map((k) => (
        <Fila key={`${k}:${settings[k]}`} k={k} value={settings[k]} canEdit={canEdit} onSaved={onSaved} />
      ))}
    </section>
  );
};
