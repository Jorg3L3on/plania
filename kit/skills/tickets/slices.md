# Tickets: how to cut a slice

## Ways to split a step that is too big

| Split by | First slice | Later slices |
|---|---|---|
| Case | The most common case only | Each other case, then the error states |
| Step of the flow | The one step that gives the result | The steps before and after it |
| Role | One kind of person | Each other role and its permissions |
| Data | One kind of item, fixed values | More kinds, then editing and deleting |
| Polish | It works and is plain | Empty, loading and error states; phone width; wording |

Never split by layer (data, then logic, then screen) and never by who builds it.

## Example: «Que la gente pueda compartir su lista de compras»

Cut by layer, which is wrong:

1. Crear la tabla de listas compartidas. *Nothing to try.*
2. Hacer el servicio para compartir. *Nothing to try.*
3. Hacer la pantalla de compartir. *The first moment anyone sees anything, and it carries all the risk.*

Cut in slices:

1. **Compartir una lista por enlace y verla.** Done when: «Desde una lista, "Compartir" da un enlace;
   al abrirlo en otro teléfono se ven los mismos productos.» Work type `code`. Blockers: none. Owner: no.
2. **Tachar productos en una lista compartida.** Done when: «Lo que una persona tacha aparece tachado
   para la otra al volver a abrir la lista.» Blockers: 1. Owner: no.
3. **Dejar de compartir.** Done when: «Después de "Dejar de compartir", el enlace muestra "Esta lista
   ya no está compartida".» Blockers: 1. Owner: no.

After step 1 someone can already try the feature. If it turns out to be the wrong idea, two steps were
never built.

## Done when: bad and good

| Bad | Why | Good |
|---|---|---|
| «El buscador funciona» | Nothing to check | «Al escribir «le» solo quedan los productos cuyo nombre contiene «le»» |
| «Se agregaron pruebas» | Describes work, not a result | «`pnpm test` pasa, con una prueba que falla si el enlace de otra persona abre mi lista» |
| «La pantalla se ve bien» | Taste | «A 390 de ancho no hay texto cortado ni hay que desplazar hacia los lados» |
| «Es rápido» | No number | «La lista de 500 productos aparece en menos de un segundo» |

## A step that needs the owner

Say it in the step, before anyone builds:

- «Publicar en la tienda de apps. Necesita al dueño: su cuenta de desarrollador.»
- On the ticket: `blocked_by: [{human_action: {text: "Entrar a la cuenta de la tienda y aceptar los nuevos términos"}}]`.

Order the plan so the steps that do not need him come first and can land while he is away.
