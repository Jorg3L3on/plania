# Retro: three worked cases

## 1. Mechanical: a check

**What happened.** QA sent the delivery back: the type check failed on the delivered commit. The
builder's result said the tests passed, which was true; the project's verify list only had the tests.

**The mistake, in one sentence.** The delivery did not compile under the type checker, and nothing in
the builder's run ran it.

**Class.** Mechanical: one command would have caught it.

**The fix** (in the Retro doc):

```
Añadir a settings.qa.verify:
  name: typecheck
  command: pnpm exec tsc --noEmit
```

**The proposal.**

- title: «Para que no se repita: se entregó código que no pasaba la revisión de tipos»
- option 1 (recommended): «Revisar los tipos antes de cada entrega» — effect: «El taller no puede
  entregar si la revisión de tipos falla; tarda unos segundos más por entrega»
- option 2: «Dejarlo como está» — effect: «Nada cambia; si vuelve a pasar se verá en la siguiente
  entrega devuelta»
- recommended_reason: «La entrega volvió solo por esto, y una revisión automática lo detecta siempre.»

## 2. Judgement: one line in a skill

**What happened.** The owner pressed Pedir cambios: «Pedí compartir la lista y solo veo un botón que
no hace nada». The plan had three steps: the data, the service, the screen. Step one was delivered and
approved by QA, correctly, against its own Done when.

**The mistake, in one sentence.** The first step of the plan gave the owner nothing he could try.

**Class.** Judgement: every check passed. The plan was cut by layer.

**Look before you add.** The `tickets` skill already says each step must be something a person can
try. So the instruction was there, and was not followed. Is a check possible? Not a command. The next
best is to make the existing line harder to skip.

**The fix** (in the Retro doc):

```
Skill: tickets
Where: under "Where it goes", before the table
Line: Before you send a plan, write next to each step what a person can try when it lands. A step with nothing to write is merged into the next one.
```

**The proposal.** Option 1: «Que cada paso de un plan diga qué se puede probar al terminarlo».
Option 2: «Dejarlo como está».

## 3. Neither: nothing

**What happened.** The owner pressed Pedir cambios: «Mejor que el botón diga Enviar, no Compartir».
The ticket's scope said «Compartir», and the delivery matched it.

**The mistake, in one sentence.** There was none: the owner changed the wording after seeing it.

**Class.** Neither.

**What to do.** No proposal. One line in the project's thread: «Revisé la entrega devuelta: cumplía lo
pedido y el cambio es una preferencia nueva. No propongo cambiar nada.»

Seeing the same kind of change of mind three times is different: then the fix may be a question the
product owner asks up front (a line in `grilling`). One time is not a pattern.
