// PLA-I69-5: Marca → Voz y nombre, the screen's logic and words. Three moments of an app (an error, an empty list, a
// notice) written in the voice as the owner moves it, so the sliders mean something before anything is saved.
import { defineWords, words } from "./i18n.js";

export type Trato = "tu" | "usted" | "vos";
export type Voice = {
  cerca: number; humor: number; breve: number; sencillo: number; trato: Trato;
  yes: string[]; no: string[]; guide: string | null;
  name: string; short: string; desc: string; tag: string;
};
export type VoiceRead = {
  voice: Voice | null;
  base: Voice;
  guide: string;
  repo: { name?: string; short?: string; desc?: string; title?: string; files: string[] };
  names: ("name" | "short" | "desc")[];
  versions: number;
  versionsList: { v: number; at: string; current: boolean }[];
  pedido: { key: string; status: string } | null;
  limits: { name: number; short: number; desc: number; tag: number };
};
export type Moment = "err" | "vacio" | "aviso";
export const PRESETS: [string, Pick<Voice, "cerca" | "humor" | "breve" | "sencillo">][] = [
  ["amable", { cerca: 75, humor: 35, breve: 70, sencillo: 75 }],
  ["profesional", { cerca: 25, humor: 10, breve: 55, sencillo: 55 }],
  ["divertida", { cerca: 85, humor: 80, breve: 70, sencillo: 80 }],
  ["directa", { cerca: 55, humor: 15, breve: 95, sencillo: 70 }],
];

/** One moment in the voice: formal or warm × detailed or brief, by how people are addressed; humour opens it and a
 * technical, detailed voice adds the data. */
export function example(w: VozWords, m: Moment, v: Pick<Voice, "cerca" | "humor" | "breve" | "sencillo" | "trato">): string {
  const i = (v.cerca >= 50 ? 2 : 0) + (v.breve >= 50 ? 1 : 0);
  let s = w.ex[m][v.trato][i]!;
  if (v.sencillo < 40 && v.breve < 50) s += w.tech[m];
  if (v.humor >= 60) s = w.fun[m] + s;
  return s;
}
/** The guide as the server writes it from the sliders (shown live; the server's is what runs get). */
export function guideOf(w: VozWords, v: Voice, title: string): string {
  if (v.guide) return v.guide;
  const tone = [v.cerca >= 50 ? w.tone.cerca : w.tone.formal, v.humor >= 60 ? w.tone.humor : w.tone.seria, v.breve >= 50 ? w.tone.breve : w.tone.detalle, v.sencillo >= 50 ? w.tone.sencillo : w.tone.tecnico];
  const q = (ws: string[]) => ws.map(w.quote).join(", ");
  return [w.gLead(v.name || title, tone.join(", "), w.gTrato[v.trato] ?? v.trato), w.gRule, ...(v.yes.length ? [w.gYes(q(v.yes))] : []), ...(v.no.length ? [w.gNo(q(v.no))] : [])].join("\n");
}

export const VOZ_WORDS = defineWords({
  es: {
    loading: "Leyendo el nombre y los textos del repo…",
    readError: "la voz",
    how: (t: string) => `Cómo habla ${t}`,
    presets: { amable: "Amable", profesional: "Profesional", divertida: "Divertida", directa: "Directa" } as Record<string, string>,
    sliders: { cerca: ["Formal", "Cercana"], humor: ["Seria", "Con humor"], breve: ["Detallada", "Breve"], sencillo: ["Técnica", "Sencilla"] } as Record<string, [string, string]>,
    sliderLabel: (a: string, b: string) => `${a} o ${b}`,
    trato: "Cómo trata a la gente",
    tratos: { tu: "Tú", usted: "Usted", vos: "Vos" } as Record<string, string>,
    yes: "Decimos",
    no: "No decimos",
    add: "+ agregar",
    addLabel: (which: string) => `Agregar a «${which}»`,
    remove: (x: string) => `Quitar «${x}»`,
    agentsNote: "Taller, Artist y el bot del producto escriben los textos de la app con esta voz: la reciben en cada corrida del proyecto.",
    guideTitle: "Guía que reciben los agentes",
    guideLabel: "Guía de voz",
    guideNote: "Se guarda en Plania, no en el repo. Bórrala toda para volver a la que sale de los controles.",
    expert: "Modo experto",
    sounds: "Así suena",
    soundsSay: "con tu estilo y tu voz, en tres momentos de la app",
    moments: { err: "Error al guardar", vacio: "Lista vacía", aviso: "Aviso en el teléfono" },
    emptyBtn: ["Explorar", "Empezar"],
    now: "ahora",
    names: "Nombre y textos",
    fields: {
      name: ["Nombre", "Aviso de instalar, ventana de la app y tiendas."],
      short: ["Nombre corto", "Debajo del ícono en el teléfono; con más de unos 12 se corta."],
      desc: ["Descripción", "Aviso de instalar, Google y la tarjeta para compartir."],
      tag: ["Frase", "La plantilla «Con frase» de Compartir. Se queda en Plania."],
    } as Record<string, [string, string]>,
    over: "más de lo que cabe",
    inRepo: (v: string) => `En el repo: ${v}`,
    notInRepo: "El repo no tiene este texto.",
    bring: (n: number) => (n === 1 ? "Llevar 1 texto al repo" : `Llevar ${n} textos al repo`),
    same: "Igual que el repo",
    way: (k: string) => `En camino · ${k}`,
    sent: (k: string) => `Pedido a Taller (${k}).`,
    saving: "Guardando…",
    saved: "Guardado en Plania",
    tone: { cerca: "cercana", formal: "formal", humor: "con humor suave", seria: "seria", breve: "breve", detalle: "detallada", sencillo: "sin tecnicismos", tecnico: "precisa, con datos técnicos" },
    gTrato: { tu: "tú", usted: "usted", vos: "vos (voseo)" } as Record<string, string>,
    gLead: (t: string, tone: string, trato: string) => `Voz de ${t}: ${tone}. Trata a la gente de ${trato}.`,
    gRule: "Primero di qué pasó, luego qué puede hacer la persona. Sin mayúsculas para gritar ni signos de admiración dobles.",
    gYes: (q: string) => `Usa: ${q}.`,
    gNo: (q: string) => `No uses: ${q}.`,
    quote: (x: string) => `«${x}»`,
    ex: {
      err: {
        tu: ["El cambio no se guardó porque se perdió la conexión. Lo que escribiste se conserva; vuelve a intentarlo cuando haya señal.", "El cambio no se guardó. Vuelve a intentarlo.", "No pudimos guardar tu cambio porque se cortó la conexión. Lo que escribiste sigue aquí: inténtalo de nuevo cuando vuelva la señal.", "No pudimos guardar tu cambio. Inténtalo de nuevo."],
        usted: ["El cambio no se guardó porque se perdió la conexión. Lo que escribió se conserva; vuelva a intentarlo cuando haya señal.", "El cambio no se guardó. Vuelva a intentarlo.", "No pudimos guardar su cambio porque se cortó la conexión. Lo que escribió sigue aquí: inténtelo de nuevo cuando vuelva la señal.", "No pudimos guardar su cambio. Inténtelo de nuevo."],
        vos: ["El cambio no se guardó porque se perdió la conexión. Lo que escribiste se conserva; volvé a intentarlo cuando haya señal.", "El cambio no se guardó. Volvé a intentarlo.", "No pudimos guardar tu cambio porque se cortó la conexión. Lo que escribiste sigue acá: intentalo de nuevo cuando vuelva la señal.", "No pudimos guardar tu cambio. Intentalo de nuevo."],
      },
      vacio: {
        tu: ["No hay elementos guardados. Para guardar uno, ábrelo y elige «Guardar».", "Sin elementos guardados. Guarda uno para verlo aquí.", "Aún no tienes nada guardado. Cuando algo te guste, ábrelo y elige «Guardar»: aparecerá aquí.", "Aún no tienes nada. Guarda lo primero."],
        usted: ["No hay elementos guardados. Para guardar uno, ábralo y elija «Guardar».", "Sin elementos guardados. Guarde uno para verlo aquí.", "Aún no tiene nada guardado. Cuando algo le guste, ábralo y elija «Guardar»: aparecerá aquí.", "Aún no tiene nada. Guarde lo primero."],
        vos: ["No hay elementos guardados. Para guardar uno, abrilo y elegí «Guardar».", "Sin elementos guardados. Guardá uno para verlo acá.", "Todavía no tenés nada guardado. Cuando algo te guste, abrilo y elegí «Guardar»: va a aparecer acá.", "Todavía no tenés nada. Guardá lo primero."],
      },
      aviso: {
        tu: ["Recordatorio: tu cita es mañana a las 10:00. Revisa los detalles y confirma tu asistencia.", "Tu cita: mañana, 10:00.", "Mañana a las 10:00 tienes tu cita. Si no puedes llegar, cámbiala desde aquí en un momento.", "Mañana 10:00 es tu cita. ¿Vienes?"],
        usted: ["Recordatorio: su cita es mañana a las 10:00. Revise los detalles y confirme su asistencia.", "Su cita: mañana, 10:00.", "Mañana a las 10:00 tiene su cita. Si no puede llegar, cámbiela desde aquí en un momento.", "Mañana 10:00 es su cita. ¿Viene?"],
        vos: ["Recordatorio: tu cita es mañana a las 10:00. Revisá los detalles y confirmá tu asistencia.", "Tu cita: mañana, 10:00.", "Mañana a las 10:00 tenés tu cita. Si no podés llegar, cambiala desde acá en un momento.", "Mañana 10:00 es tu cita. ¿Venís?"],
      },
    } as Record<Moment, Record<Trato, string[]>>,
    fun: { err: "Ups, se nos fue la señal. ", vacio: "Todo tranquilo por aquí. ", aviso: "¡Mañana es el día! " } as Record<Moment, string>,
    tech: { err: " (Sin conexión: código 504.)", vacio: " (0 elementos.)", aviso: " (Zona horaria: la de tu teléfono.)" } as Record<Moment, string>,
  },
  en: {
    loading: "Reading the repo's name and texts…",
    readError: "the voice",
    how: (t: string) => `How ${t} speaks`,
    presets: { amable: "Friendly", profesional: "Professional", divertida: "Playful", directa: "Direct" } as Record<string, string>,
    sliders: { cerca: ["Formal", "Warm"], humor: ["Serious", "Playful"], breve: ["Detailed", "Brief"], sencillo: ["Technical", "Plain"] } as Record<string, [string, string]>,
    sliderLabel: (a: string, b: string) => `${a} or ${b}`,
    trato: "How it addresses people",
    tratos: { tu: "Informal", usted: "Formal", vos: "Voseo" } as Record<string, string>,
    yes: "We say",
    no: "We don't say",
    add: "+ add",
    addLabel: (which: string) => `Add to «${which}»`,
    remove: (x: string) => `Remove «${x}»`,
    agentsNote: "Taller, Artist and the product bot write the app's texts in this voice: every run of the project gets it.",
    guideTitle: "Guide the agents get",
    guideLabel: "Voice guide",
    guideNote: "Kept in Plania, not in the repo. Clear it all to go back to the one the controls make.",
    expert: "Expert mode",
    sounds: "How it sounds",
    soundsSay: "with your style and voice, in three moments of the app",
    moments: { err: "Error saving", vacio: "Empty list", aviso: "Phone notification" },
    emptyBtn: ["Explore", "Start"],
    now: "now",
    names: "Name and texts",
    fields: {
      name: ["Name", "Install prompt, app window and stores."],
      short: ["Short name", "Under the icon on the phone; past about 12 it is cut."],
      desc: ["Description", "Install prompt, Google and the share card."],
      tag: ["Tagline", "The share template «With a tagline». It stays in Plania."],
    } as Record<string, [string, string]>,
    over: "more than fits",
    inRepo: (v: string) => `In the repo: ${v}`,
    notInRepo: "The repo has no such text.",
    bring: (n: number) => (n === 1 ? "Bring 1 text to the repo" : `Bring ${n} texts to the repo`),
    same: "Same as the repo",
    way: (k: string) => `On its way · ${k}`,
    sent: (k: string) => `Asked Taller (${k}).`,
    saving: "Saving…",
    saved: "Saved in Plania",
    tone: { cerca: "warm", formal: "formal", humor: "with light humour", seria: "serious", breve: "brief", detalle: "detailed", sencillo: "jargon-free", tecnico: "precise, with technical data" },
    gTrato: { tu: "informally", usted: "formally", vos: "informally (voseo in Spanish)" } as Record<string, string>,
    gLead: (t: string, tone: string, trato: string) => `${t}'s voice: ${tone}. Address people ${trato}.`,
    gRule: "First say what happened, then what the person can do. No shouting capitals, no double exclamation marks.",
    gYes: (q: string) => `Use: ${q}.`,
    gNo: (q: string) => `Do not use: ${q}.`,
    quote: (x: string) => `«${x}»`,
    ex: {
      err: {
        tu: ["The change was not saved because the connection dropped. What you wrote is kept; try again when you have signal.", "The change was not saved. Try again.", "We couldn't save your change because the connection dropped. What you wrote is still here: try again once you're back online.", "We couldn't save your change. Try again."],
        usted: ["The change could not be saved because the connection was lost. Your text has been kept; please try again when a connection is available.", "The change could not be saved. Please try again.", "We were unable to save your change because the connection was lost. Your text is still here: please try again once you are back online.", "We were unable to save your change. Please try again."],
        vos: ["The change was not saved because the connection dropped. What you wrote is kept; try again when you have signal.", "The change was not saved. Try again.", "We couldn't save your change because the connection dropped. What you wrote is still here: try again once you're back online.", "We couldn't save your change. Try again."],
      },
      vacio: {
        tu: ["There are no saved items. To save one, open it and choose «Save».", "No saved items. Save one to see it here.", "Nothing saved yet. When you like something, open it and choose «Save»: it'll show up here.", "Nothing yet. Save your first one."],
        usted: ["There are no saved items. To save one, please open it and choose «Save».", "No saved items. Please save one to see it here.", "You have not saved anything yet. When something interests you, open it and choose «Save»: it will appear here.", "Nothing yet. Please save your first item."],
        vos: ["There are no saved items. To save one, open it and choose «Save».", "No saved items. Save one to see it here.", "Nothing saved yet. When you like something, open it and choose «Save»: it'll show up here.", "Nothing yet. Save your first one."],
      },
      aviso: {
        tu: ["Reminder: your appointment is tomorrow at 10:00. Check the details and confirm you'll attend.", "Your appointment: tomorrow, 10:00.", "Your appointment is tomorrow at 10:00. Can't make it? Change it from here in a moment.", "Tomorrow 10:00 is your appointment. Coming?"],
        usted: ["Reminder: your appointment is tomorrow at 10:00. Please review the details and confirm your attendance.", "Your appointment: tomorrow, 10:00.", "Your appointment is tomorrow at 10:00. If you cannot attend, you may change it from here.", "Tomorrow 10:00 is your appointment. Will you attend?"],
        vos: ["Reminder: your appointment is tomorrow at 10:00. Check the details and confirm you'll attend.", "Your appointment: tomorrow, 10:00.", "Your appointment is tomorrow at 10:00. Can't make it? Change it from here in a moment.", "Tomorrow 10:00 is your appointment. Coming?"],
      },
    } as Record<Moment, Record<Trato, string[]>>,
    fun: { err: "Oops, the signal wandered off. ", vacio: "All quiet around here. ", aviso: "Tomorrow's the day! " } as Record<Moment, string>,
    tech: { err: " (Offline: code 504.)", vacio: " (0 items.)", aviso: " (Time zone: your phone's.)" } as Record<Moment, string>,
  },
});
export const vozWords = () => words(VOZ_WORDS);
export type VozWords = ReturnType<typeof vozWords>;
