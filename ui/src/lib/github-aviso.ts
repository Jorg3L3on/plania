// F2 (first-install audit): gh is no longer required at install, since a first project with no code needs none. It is
// needed before a project with code: «Nuevo proyecto» asks the server (GET /api/onboarding/github, the readiness
// list's own GitHub access, src/runner/readiness.ts) once a repository is given, and says what is wrong and the fix.
// Words and rules, tested without a browser. No "@/" imports: a test reads this file with node directly.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

/** How Plania reaches GitHub (GithubAccess in src/runner/readiness.ts). */
export type GithubAccess = "ok" | "gh_absent" | "gh_signed_out" | "gh_no_write" | "no_token";
export type GithubAviso = { por: string; arregla: string; comando: string | null };

export const GITHUB_AVISO_WORDS = defineWords({
  es: {
    titulo: "Para un proyecto con código, gh debe tener la sesión iniciada y permiso para escribir en tus repositorios.",
    revisando: "Revisando que Plania pueda llegar a GitHub…",
    puedes: "Puedes crearlo igual: el equipo no podrá subir su trabajo a GitHub hasta que lo arregles.",
    gh_absent: { por: "gh, el programa de GitHub, no está instalado en esta máquina", arregla: "Instálalo desde https://cli.github.com y luego, en una terminal:" },
    gh_signed_out: { por: "gh no tiene la sesión iniciada", arregla: "En una terminal, corre esto y elige GitHub.com:" },
    gh_no_write: { por: "gh tiene la sesión iniciada, pero sin permiso para escribir en tus repositorios", arregla: "En una terminal, corre esto para darle ese permiso:" },
    no_token: { por: "Plania no tiene cómo llegar a GitHub", arregla: "Escribe un token de GitHub con permiso de escritura en GITHUB_TOKEN, en el archivo .env de Plania, y vuelve a encenderlo." },
  },
  en: {
    titulo: "For a project with code, gh must be signed in and able to write to your repositories.",
    revisando: "Checking that Plania can reach GitHub…",
    puedes: "You can make it anyway: the team cannot push its work to GitHub until you fix this.",
    gh_absent: { por: "gh, GitHub's program, is not installed on this machine", arregla: "Install it from https://cli.github.com, then in a terminal:" },
    gh_signed_out: { por: "gh is not signed in", arregla: "In a terminal, run this and choose GitHub.com:" },
    gh_no_write: { por: "gh is signed in, but cannot write to your repositories", arregla: "In a terminal, run this to give it that permission:" },
    no_token: { por: "Plania has no way to reach GitHub", arregla: "Put a GitHub token that can write in GITHUB_TOKEN, in Plania's .env file, and start it again." },
  },
});

export const githubAvisoWords = (language: Language = getLanguage()) => words(GITHUB_AVISO_WORDS, language);

const COMANDO: Record<Exclude<GithubAccess, "ok">, string | null> = {
  gh_absent: "gh auth login",
  gh_signed_out: "gh auth login",
  gh_no_write: "gh auth refresh -h github.com -s repo",
  no_token: null,
};

/** What is wrong and the fix, or null when Plania can reach GitHub (or the answer is not one it knows). */
export function githubAviso(access: string | null | undefined, language: Language = getLanguage()): GithubAviso | null {
  if (!access || access === "ok" || !(access in COMANDO)) return null;
  const a = access as Exclude<GithubAccess, "ok">;
  const w = words(GITHUB_AVISO_WORDS, language)[a];
  return { por: w.por, arregla: w.arregla, comando: COMANDO[a] };
}

/** Whether the sheet's choice uses gh: Nube clones with it. Local reads its folder and SSH uses git with the owner's keys. */
export function pideGithub(codigo: "carpeta" | "github" | "ssh" | "ninguno" | null, _repo = ""): boolean {
  return codigo === "github";
}
