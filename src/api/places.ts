// PLA-I2-10: where an order came from, as the callers name it (in Spanish, stored in old scopes as written), said in
// English for an English install. An unknown place stays as given.
const PLACES_EN: Record<string, string> = {
  "Compañía": "Company",
  "el hilo del proyecto": "the project thread",
  "el brief de la mañana": "the morning brief",
};
export const placeEn = (place: string): string => PLACES_EN[place] ?? place;
