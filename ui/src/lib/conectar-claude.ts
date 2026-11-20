// P5 (first-install audit): Plomería's «Conectar Claude Code». One press makes a token of its own for the owner's Claude
// Code (POST /api/onboarding/claude-code, owner session only) and shows the one line that connects it, with a copy
// button. The token is shown this once, like every token, and can be revoked on the tokens page; MCP_BEARER_TOKEN
// never leaves .env. Words and the line, tested without a browser. No "@/" imports: a test reads this file with node.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const CONECTAR_CLAUDE_WORDS = defineWords({
  es: {
    titulo: "Conectar Claude Code",
    texto: "Para que tu Claude Code lea y escriba el plan desde cualquier carpeta de esta máquina. Corre la línea una vez en una terminal.",
    boton: "Crear la línea",
    creando: "Creando…",
    otra: "Crear otra",
    unaVez: "La línea lleva una llave nueva, solo para Claude Code, y se muestra esta única vez. Si la pierdes, crea otra.",
    revocar: "Ver o revocar las llaves",
    fallo: "No se pudo crear la llave. Intenta de nuevo.",
  },
  en: {
    titulo: "Connect Claude Code",
    texto: "So your Claude Code reads and writes the plan from any folder on this machine. Run the line once in a terminal.",
    boton: "Make the line",
    creando: "Making it…",
    otra: "Make another",
    unaVez: "The line carries a new key, for Claude Code only, and is shown this one time. If you lose it, make another.",
    revocar: "See or revoke the keys",
    fallo: "The key could not be made. Try again.",
  },
});

export const conectarClaudeWords = (language: Language = getLanguage()) => words(CONECTAR_CLAUDE_WORDS, language);

/** The line that adds Plania to Claude Code for this user, with the token in its header. */
export function claudeMcpAddLine(url: string, secret: string): string {
  return `claude mcp add --scope user --transport http plania ${url} --header "Authorization: Bearer ${secret}"`;
}
