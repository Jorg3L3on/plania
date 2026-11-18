# Grilling: examples

The request in these examples: «Quiero que la gente pueda compartir su lista de compras».

## Fact or decision

| Unknown | Kind | What to do |
|---|---|---|
| Does the app already have accounts? | Fact | Read the repo. Do not ask. |
| Is there a pinned decision about sharing by link? | Fact | `get_memory`. Cite it if there is one. |
| Can a shared list be edited by the other person? | Decision | Closed question. |
| Should sharing need an account on the other side? | Decision | Closed question. |
| Which library draws the share sheet? | Neither | Technical how. It belongs to Taller. |

## A bad question and its repair

Bad: «¿Cómo quieres que funcione compartir?»
It is open, it hands the owner the design work, and no answer can be taken by default.

Good, as one `propose` of kind `choice`:

- title: «Cuando alguien comparte su lista, ¿la otra persona puede cambiarla?»
- option 1 (recommended): label «Sí, las dos personas pueden agregar y tachar», effect «La lista se
  vuelve de las dos; lo que una tacha la otra lo ve tachado», cost `{days: 3}`
- option 2: label «No, la otra persona solo la ve», effect «Sirve para mandar la lista a quien va a la
  tienda, pero no puede tachar», cost `{days: 1}`
- recommended_reason: «En el pedido hablas de hacer las compras entre dos; con solo ver, quien va a la
  tienda no puede marcar lo que ya tomó.»

The assumption recorded while he has not answered:

`Supuesto: cuando alguien comparte su lista, ¿la otra persona puede cambiarla? → Sí, las dos pueden agregar y tachar. Vale hasta que el dueño diga otra cosa.`

## Other repairs

| Bad | Why | Good |
|---|---|---|
| «¿Usamos enlaces o invitaciones?» | Names mechanisms, not outcomes | «¿Quien recibe la lista necesita tener cuenta?» with what each answer means for that person |
| «¿Está bien si lo dejamos simple?» | "No" has no described outcome | Two options, each saying what is in and what is left out |
| «¿Compartir por WhatsApp, correo, enlace o código QR?» | Four options you would not all build | Keep the two that fit what you found; recommend one |
| «¿Cuántas personas por lista y pueden borrar?» | Two decisions in one | Two questions, or decide the smaller one yourself |
