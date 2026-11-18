# Two-axis review: the report

**The run prompt's format wins.** It shows the exact block Plania parses for this run. Use its field
names and nothing else. This page only shows how the two axes fit into it.

## When the block has `spec` and `code`

```qa-report
{
  "review": {
    "verdict": "fail",
    "notes": "Cumple lo pedido, pero el borrado no revisa de quién es la lista.",
    "spec": { "verdict": "pass", "notes": "Los tres puntos del Done when se cumplen: ver src/listas/compartir.ts:41 y la prueba test/compartir.test.ts:18." },
    "code": { "verdict": "fail", "notes": "src/listas/borrar.ts:27: borra por id sin comprobar el dueño; con el id de otra persona se borra su lista. Arreglo: comparar lista.dueño con la sesión antes de borrar." }
  },
  "checklist": [
    { "n": 1, "mark": "pass", "note": "Se ve bien a 390: sin texto cortado." },
    { "n": 2, "mark": "pass", "note": "Las listas guardadas siguen ahí: test/listas.test.ts:60 pasa." },
    { "n": 3, "mark": "fail", "note": "El aviso de error está en inglés: src/listas/compartir.tsx:88." }
  ]
}
```

- `review.verdict` is `fail` when `spec.verdict` or `code.verdict` is `fail`.
- `review.notes` is one or two sentences for the owner. The detail goes in each axis.
- A check-list item marked `fail` fails the spec axis.

## When the block has a single verdict

Older run prompts ask only for `review.verdict` and `review.notes`. Keep the axes apart inside the
notes, one line each, in this order:

```
Spec: pasa — los tres puntos del Done when se cumplen.
Código: falla — src/listas/borrar.ts:27: borra por id sin comprobar el dueño. Arreglo: comparar lista.dueño con la sesión.
```

The single verdict is `fail` when either line says «falla».

## Notes that help the builder

The builder reads your notes in a fresh session, with nothing else. Each finding needs three parts.

| Part | Example |
|---|---|
| Where | `src/listas/borrar.ts:27` |
| What is wrong, as a case | «con el id de la lista de otra persona, la borra» |
| What would fix it | «comparar el dueño de la lista con la sesión antes de borrar» |

Not useful: «revisar permisos», «faltan pruebas», «mejorar el manejo de errores».

## The four outcomes

| Spec | Code | What it means | Overall |
|---|---|---|---|
| pass | pass | Does what was asked, and is sound | pass |
| pass | fail | Does what was asked, and will break or is unsafe | fail |
| fail | pass | Well built, and not what was asked | fail |
| fail | fail | Both | fail |
