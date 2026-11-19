// PLA-I2-10: the login screen's words, in both languages. No "@/" imports.
import { defineWords } from "./i18n.js";

export const LOGIN = defineWords({
  es: {
    lead: "Entra para ver tus proyectos.",
    password: "Contraseña",
    wrong: "Contraseña incorrecta.",
    failed: "No se pudo entrar. Intenta de nuevo.",
    submit: "Entrar",
    submitting: "Entrando…",
  },
  en: {
    lead: "Sign in to see your projects.",
    password: "Password",
    wrong: "Wrong password.",
    failed: "Could not sign in. Try again.",
    submit: "Sign in",
    submitting: "Signing in…",
  },
});
