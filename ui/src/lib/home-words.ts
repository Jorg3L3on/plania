// PLA-I2-10: the words of Inicio's page shell, in both languages. No "@/" imports.
import { defineWords } from "./i18n.js";

export const HOME_PAGE = defineWords({
  es: { failed: "No se pudieron cargar los proyectos." },
  en: { failed: "The projects could not be loaded." },
});
