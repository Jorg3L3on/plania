// PLA-I67-3: the words that mark a lesson as relaxing a check, per language (src/runner/lessons.ts builds its matcher
// from both). A wording module: the owner's language decides nothing here, both lists always apply.
import { defineWords } from "../words.js";

export const RELAX_WORDS = defineWords({
  es: {
    leaveOut: ["sin", "omite", "omitir", "salta", "saltar", "quita", "quitar", "ignora", "ignorar", "desactiva", "no"],
    checks: ["prueba", "pruebas", "revisión", "revision", "verificación", "verificacion", "aceptación", "qa", "lint"],
  },
  en: {
    leaveOut: ["skip", "omit", "without", "ignore", "disable", "no"],
    checks: ["test", "tests", "review", "check", "checks", "verify", "qa", "lint", "type-check", "typecheck"],
  },
});
