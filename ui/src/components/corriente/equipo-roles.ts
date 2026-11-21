// PLA-I2-10 / PLA-I71-1: each seat's one-line job (the words are in @/lib/equipo-words; the language is fixed for the
// page's life, so this reads it once). Its own module so the chart and the panel read it without a cycle.
import { words } from "@/lib/i18n";
import { EQUIPO_WORDS } from "@/lib/equipo-words";

export const ROLE_LINE: Record<string, string> = words(EQUIPO_WORDS).roleLine;
