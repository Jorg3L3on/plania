// PLA-I2-6: two sections of a project's Ajustes. «Cómo arranca la app» edits settings.capture when Máquinas' guess is
// wrong (PUT …/settings/capture). «Avanzado» is closed: one row per advanced setting from the server's one list
// (src/mcp/settings-registry.ts), each saved alone (PUT …/settings/advanced); empty puts the default back. A token
// field takes a variable's name, never the token. The first field is the working branch (PLA-I2-5's setting).
// Wording and checks: @/lib/ajustes-avanzado.
import { useState } from "react";
import { api } from "@/lib/api";
import type { Ajustes as AjustesRead } from "@/lib/ajustes";
import {
  arranqueBody,
  arranqueForm,
  avanzadoTexto,
  avanzadoValor,
  avanzadoWords,
  porDefecto,
  type ArranqueForm,
  type ArranqueRead,
  type AvanzadoRead,
} from "@/lib/ajustes-avanzado";
import { Falla, Seccion, useGuardar } from "./ajustes";
import { Btn, Switch } from "./parts";
import { words } from "@/lib/i18n";
import { AJUSTES_VIEW_WORDS } from "@/lib/ajustes-words";

export const Arranque = ({ a }: { a: AjustesRead }) => {
  const [form, setForm] = useState<ArranqueForm>(arranqueForm(a.capture));
  const save = useGuardar(a.slug, (capture: ArranqueRead | null) => api.ajustesArranque(a.slug, { version: a.version, capture }));
  const out = arranqueBody(form);
  const ARRANQUE = avanzadoWords().arranque;
  const v = words(AJUSTES_VIEW_WORDS);
  const field = (k: Exclude<keyof ArranqueForm, "pages">, w: { label: string; hint: string }, mono = true) => (
    <label>
      <span className="cor-text">{w.label}</span>
      <input className={`cor-input${mono ? " cor-mono" : ""}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} autoComplete="off" spellCheck={false} data-campo={`arranque-${k}`} />
      <span className="cor-cap">{w.hint}</span>
    </label>
  );
  return (
    <Seccion id="arranque" titulo={ARRANQUE.titulo} texto={ARRANQUE.texto}>
      <form
        className="cor-ajustes-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (out.ok) save.mutate(out.capture);
        }}
      >
        {!a.capture && <p className="cor-cap">{ARRANQUE.vacio}</p>}
        {field("start_command", ARRANQUE.comando)}
        <span className="cor-hoja-two">
          {field("port", ARRANQUE.puerto)}
          {field("ready_path", ARRANQUE.lista)}
        </span>
        {field("install_command", ARRANQUE.instalar)}
        <label>
          <span className="cor-text">{ARRANQUE.paginas.label}</span>
          <textarea className="cor-textarea cor-mono cor-ajustes-area" rows={4} value={form.pages} onChange={(e) => setForm({ ...form, pages: e.target.value })} spellCheck={false} data-campo="arranque-paginas" />
          <span className="cor-cap">{ARRANQUE.paginas.hint}</span>
        </label>
        {!out.ok && <p className="cor-state amber">{out.aviso}</p>}
        <Falla error={save.error} />
        <div className="cor-acts">
          <Btn kind="secondary" type="submit" disabled={!out.ok || save.isPending} data-control="guardar-arranque">
            {save.isPending ? v.saving : v.save}
          </Btn>
        </div>
      </form>
    </Seccion>
  );
};

const Campo = ({ a, f }: { a: AjustesRead; f: AvanzadoRead }) => {
  const [text, setText] = useState(avanzadoTexto(f));
  const save = useGuardar(a.slug, (value: unknown) => api.ajustesAvanzado(a.slug, { version: a.version, field: f.field, value }));
  const aw = avanzadoWords();
  const v = words(AJUSTES_VIEW_WORDS);
  const label = aw.etiquetas[f.field] ?? f.field;
  const id = `avanzado-${f.field}`;
  const parsed = avanzadoValor(f.editor, text);
  const changed = text !== avanzadoTexto(f);
  return (
    <li className="cor-ajustes-nota" data-avanzado={f.field} data-ajuste={f.key}>
      <span className="cor-ajustes-nota-tx">
        <label htmlFor={id}>
          <b>{label}</b>
        </label>
        <span className="cor-text">{f.frase}</span>
        <span className="cor-cap">{porDefecto(f)}</span>
      </span>
      {f.editor === "switch" ? (
        <Switch id={id} on={f.value === null ? true : f.value === true} label={label} onChange={(on) => save.mutate(on)} disabled={save.isPending} data-campo={id} />
      ) : f.editor === "select" ? (
        <select id={id} className="cor-select" value={typeof f.value === "string" ? f.value : ""} disabled={save.isPending} onChange={(e) => save.mutate(e.target.value || null)} data-campo={id}>
          <option value="">{aw.automatico}</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {aw.opciones[o] ?? o}
            </option>
          ))}
        </select>
      ) : (
        <form
          className="cor-ajustes-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.ok) save.mutate(parsed.value);
          }}
        >
          {f.editor === "json" ? (
            <textarea id={id} className="cor-textarea cor-mono cor-ajustes-area" rows={Math.max(3, text.split("\n").length)} value={text} onChange={(e) => setText(e.target.value)} placeholder="{ }" spellCheck={false} data-campo={id} />
          ) : (
            <input id={id} className="cor-input cor-mono" inputMode={f.editor === "number" ? "numeric" : undefined} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} data-campo={id} />
          )}
          {!parsed.ok && <p className="cor-state amber">{parsed.aviso}</p>}
          {changed && parsed.ok && (
            <div className="cor-acts">
              <Btn kind="secondary" small type="submit" disabled={save.isPending} data-control="guardar-avanzado">
                {save.isPending ? v.saving : v.save}
              </Btn>
            </div>
          )}
        </form>
      )}
      <Falla error={save.error} />
    </li>
  );
};

export const Avanzado = ({ a }: { a: AjustesRead }) => (
  <details className="cor-card cor-ajustes-sec" data-ajustes="avanzado" id="ajustes-avanzado">
    <summary className="cor-ajustes-h">{avanzadoWords().seccion.titulo}</summary>
    <p className="cor-text">{avanzadoWords().seccion.texto}</p>
    <ul className="cor-ajustes-notas">
      {a.avanzado.map((f) => (
        <Campo key={`${f.field}:${a.version}`} a={a} f={f} />
      ))}
    </ul>
  </details>
);
