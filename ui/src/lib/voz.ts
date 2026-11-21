// PLA-I69-5, PLA-130: how the app addresses people (tú, usted or vos), set in Estilo → Trato. Voz y nombre left Marca;
// this is what remains on the screen: the type, the three names and the one-line guide the runs get (the same as the
// server's, src/brand/voz.ts).
import { defineWords, words } from "./i18n.js";

export type Trato = "tu" | "usted" | "vos";
export type Voice = { trato: Trato };
export type VoiceRead = {
  voice: Voice | null;
  base: Voice;
  guide: string;
  versions: number;
  versionsList: { v: number; at: string; current: boolean }[];
};

/** The guide every run gets, as the server writes it. */
export const guideOf = (w: VozWords, v: Voice): string => w.guide(v.trato);

export const VOZ_WORDS = defineWords({
  es: {
    trato: "Cómo trata a la gente",
    tratos: { tu: "Tú", usted: "Usted", vos: "Vos" } as Record<string, string>,
    guide: (trato: Trato) => `Escribe todo texto que vea la gente de la app tratándola de ${{ tu: "tú", usted: "usted", vos: "vos (voseo)" }[trato]}.`,
  },
  en: {
    trato: "How it addresses people",
    tratos: { tu: "Tú (informal)", usted: "Usted (formal)", vos: "Vos (voseo)" } as Record<string, string>,
    guide: (trato: Trato) => `Write every text the app's people see addressing them ${{ tu: "informally (tú)", usted: "formally (usted)", vos: "informally (voseo)" }[trato]}.`,
  },
});
export const vozWords = () => words(VOZ_WORDS);
export type VozWords = ReturnType<typeof vozWords>;
