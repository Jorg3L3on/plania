// PLA-I68: the words the server writes for the owner in Camino: the names of environments read from older settings
// and the history's lines. In the install's language (src/words.ts say).
import { defineWords, say } from "../words.js";

export const CAMINO_SERVER_WORDS = defineWords({
  es: {
    envCopy: "Copia de prueba",
    envProd: "Producción",
    keySaved: (provider: string, l4: string) => `Llave de ${provider} guardada y probada (…${l4})`,
    keyRemoved: (provider: string) => `Llave de ${provider} quitada`,
    undoKey: "Quitar la llave en Conexiones y llaves",
  },
  en: {
    envCopy: "Test copy",
    envProd: "Production",
    keySaved: (provider: string, l4: string) => `${provider} key saved and tested (…${l4})`,
    keyRemoved: (provider: string) => `${provider} key removed`,
    undoKey: "Remove the key in Connections and keys",
  },
});
export const caminoSay = () => say(CAMINO_SERVER_WORDS);
