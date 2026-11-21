# The screen's words, in two languages

PLA-I2-10. The screen speaks the install's language: Spanish (`es`, the default) or English (`en`). The owner
chooses it at first start and changes it in Plomería. The morning brief follows the same choice.

## Where the language lives

- Server: `src/language.ts`. Stored in `machine_state` (key `language`); `PLANIA_LANGUAGE` wins when set.
  `installLanguage()` reads it; `saveLanguage(db, lang)` stores it and sets `brief_settings.language` to match.
- Routes: `GET /api/language` (no session: the login and first-start screens need it), `PUT /api/language`.
- Screen: `ui/src/lib/i18n.ts`. The language is fixed for the life of a page load. It is read from
  `localStorage` at load; `LanguageSync` (`ui/src/components/language-sync.tsx`) asks the server and reloads the
  page when the server's chosen language differs. So any module, and the locale, sees one language.
- Dates and numbers: `ui/src/lib/locale.ts` (`LOCALE`) and `src/locale.ts` (`screenLocale()`). Spanish falls back to
  `es-MX`, English to `en-US`; the browser's own variant of the language wins on the screen.

## Where words live

Every sentence the owner reads lives in a wording module under `ui/src/lib/`, made with `defineWords`. The Spanish
object sets the shape; the English must have the same keys (the type-checker refuses a missing one, and
`test/i2-10-language.test.ts` checks every module again at run time).

```ts
// ui/src/lib/login-words.ts
import { defineWords } from "./i18n.js";
export const LOGIN = defineWords({
  es: { title: "Entrar", tries: (n: number) => `Te quedan ${n} intentos.` },
  en: { title: "Sign in", tries: (n: number) => `${n} tries left.` },
});

// ui/src/pages/login.tsx
import { words } from "@/lib/i18n";
import { LOGIN } from "@/lib/login-words";
const w = words(LOGIN);  // inside the component
<h1>{w.title}</h1>
```

- A sentence with a number or a name is a function, not a string with a placeholder.
- A lib function that returns words takes `language: Language = getLanguage()`, so the server can pass its own.
- A wording module has no `@/` imports: the server and the tests import it with node.

## Adding a string

1. Add the key to both `es` and `en` in the file's wording module (or make one: `ui/src/lib/<name>.ts`).
2. Read it with `words(MODULE).key` in the component.
3. Run `node --import tsx --test test/i2-10-language.test.ts`.

## The guard

`scripts/inline-words.ts` finds Spanish written inline in `ui/src/components/` and `ui/src/pages/`: a string literal,
template text or JSX text with an accented letter, `¿ ¡ « »`, or two Spanish stop-words. Comments are skipped.
`test/inline-words-allow.txt` lists the files not moved yet. The test fails on a file with a sentence that is not
listed, and on a listed file that no longer has one, so the list only shrinks. Run
`node --import tsx scripts/inline-words.ts` to see what is left. Single-word labels («Guardar») are not detected;
move them with the rest of the file's words. A string right after `from`, `import(` or `data-…=` is code, not a
sentence, and is skipped.

The same guard covers `ui/src/lib/`: a module may hold Spanish only inside a `defineWords(…)` call, where its English
twin is checked. `node --import tsx scripts/inline-words.ts --lib` lists what is outside. `test/lib-words-allow.txt`
names the few exceptions, each with its reason after `#` (a regex, an identifier, a Spanish helper used inside the
`es` words); the test fails on an unlisted module, on an entry without a reason, and on an entry that is clean. The
limit is the same: a single-word label outside `defineWords` is not detected.

## Product names

Names of places on the screen. «Stays» means the English screen keeps the Spanish name, as a proper name; the
English column is what is written in English sentences around it.

| Spanish | In English | Why |
|---|---|---|
| Plania | stays | The product. |
| La corriente | stays | A place name; «the stream» is the gloss in help text. |
| Compañía | Company | A plain word, not a brand. |
| Plomería | stays | A place name; «the plumbing» in help text. |
| Máquina / Máquinas | Machine / Machines | Plain words. |
| Buzón | Inbox | A plain word. |
| Bandeja | Inbox | The same place for the owner. |
| Te toca | Your turn | A phrase, translated. |
| Taller | stays | A role name in prompts and the roster. |
| Asistente | stays | A role name in prompts and the roster. |
| El Probador | stays | A tool's name. |
| Motores | Engines | A plain word. |
| Docs del proyecto | Project docs | A plain phrase. |
| Biblioteca | Library | A plain word. |
| Tablero | Board | A plain word. |
| Ficha | Card | A plain word. |
| Novedades | What's new | A plain word. |
| Calidad | Quality | A plain word. |
| Progreso | Progress | A plain word. |
| Hoy | Today | A plain word. |
| Orden | Order | A plain word. |
| Pedido / Pedir | Request / Ask | Plain words. |
| Preguntar | Ask a question | Plain words. |
| Aceptar | Accept | A button. |
| Pedir cambios | Ask for changes | A button. |
| Lanzar | Release | A button. |
| Delegada | Delegated | A badge. |
| Muestra | Preview | A plain word. |
| Copia de prueba | Test copy | Plain words. |
| Sueltos | Loose | Plain words. |
| Piso | Floor | A plain word. |
| Inicio | Home | A plain word. |
| Ahora | Now | A plain word. |
| Puesto | Seat | A plain word. |
| Hecho | Done | A plain word. |
| Lista | Ready | A plain word. |
| Pedir ajuste | Ask for changes | A button; the same words as «Pedir cambios». |
