// PLA-I2-13: what a process started for a run receives. One allow-list, used by every place that starts one: the
// runner's claude runs (Preguntar runs included), the brief, QA commands, test copies and the capture browser.
// Before, a run got the server's whole environment minus ANTHROPIC_*: DATABASE_URL, the full-access MCP token,
// SESSION_SECRET, GITHUB_TOKEN and the push keys reached every agent that printed its environment.
//
// Allowed: system basics (PATH, HOME, user, shell, locale, temp dir, and the Windows names for the same), what git,
// gh and Node need (ssh agent, gh's config dir, proxy and CA variables), Claude Code's own variables, untouched
// (Anthropic's conditions for products that run Claude Code: each user signs in with their own plan, key or
// provider, and the product may not remove or restrict a sign-in method), the run's own token (passed as extra) and
// the variables a project names in settings.runner.env. Never Plania's own, whatever asks for them.
//
// PLANIA_STRIP_ANTHROPIC_ENV=1 keeps the old behaviour (drop ANTHROPIC_*, so the run signs in with the plan login).
// Off by default.

export type RunEnvOptions = {
  // The run's own values (its token, PORT, a test copy's database URL). Set last, over everything but the strip.
  extra?: Record<string, string>;
  // Variable names a project asks for (settings.runner.env). Plania's own names are refused.
  names?: readonly string[];
  // false for an app's commands (QA, test copies, the capture browser): they need no Claude sign-in.
  claude?: boolean;
};

// Exact names. Unix basics first, then the platform's equivalents, then tools.
const BASICS = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "COLORTERM", "TZ", "TMPDIR", "TMP", "TEMP",
  "LANG", "LANGUAGE",
  // Windows (WSL hosts pass some of these through) and the XDG folders on Linux.
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC", "ComSpec", "PATHEXT",
  "WSL_DISTRO_NAME", "WSL_INTEROP", "WSLENV",
  // Node and package managers.
  "NVM_DIR", "NVM_BIN", "PNPM_HOME", "COREPACK_HOME", "VOLTA_HOME", "FNM_DIR", "N_PREFIX",
  // git and gh: the ssh agent and gh's own login (its config dir, never a token).
  "SSH_AUTH_SOCK", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "GIT_CONFIG_GLOBAL", "GH_CONFIG_DIR", "GH_HOST", "GH_PROMPT_DISABLED", "EDITOR", "VISUAL",
  // Proxy and certificates, for git, gh, Node and Claude Code behind a corporate network.
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
  "NODE_EXTRA_CA_CERTS", "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "GIT_SSL_CAINFO",
];
const BASIC_PREFIX = [/^LC_/, /^XDG_/];
// Matched without case: Windows keeps "Path" and "SystemRoot", and proxies are set in both cases.
const BASIC_SET = new Set(BASICS.map((n) => n.toUpperCase()));

// Claude Code's own: ANTHROPIC_* (API key, auth token, base URL, model, Foundry and Vertex project), CLAUDE_*
// (CLAUDE_CODE_USE_BEDROCK / _VERTEX / _FOUNDRY, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CONFIG_DIR) and its tuning names.
const CLAUDE_PREFIX = [/^ANTHROPIC_/, /^CLAUDE_/, /^DISABLE_/, /^BASH_.*_TIMEOUT_MS$/, /^VERTEX_REGION_/];
const CLAUDE_NAMES = ["MCP_TIMEOUT", "MCP_TOOL_TIMEOUT", "MAX_THINKING_TOKENS", "MAX_MCP_OUTPUT_TOKENS", "CLOUD_ML_REGION", "USE_BUILTIN_RIPGREP"];
// A cloud provider's own credentials, only while Claude is switched to that provider.
const BEDROCK = [/^AWS_/];
const VERTEX = [/^GOOGLE_APPLICATION_CREDENTIALS$/, /^GOOGLE_CLOUD_PROJECT$/, /^GCLOUD_PROJECT$/];

// Plania's own. Never passed, not as a basic, not when a project names it. PLANIA_* is the server's namespace:
// a run's own PLANIA_RUNNER_TOKEN / PLANIA_BRIEF_TOKEN comes in through extra.
export const PLANIA_OWN = [
  "DATABASE_URL", "MCP_BEARER_TOKEN", "MCP_READ_TOKEN", "SESSION_SECRET", "GITHUB_TOKEN", "VERCEL_TOKEN",
  "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",
] as const;
const PLANIA_OWN_SET = new Set<string>(PLANIA_OWN);
export const isPlaniaOwn = (name: string): boolean => PLANIA_OWN_SET.has(name) || /^PLANIA_/.test(name) || /^VAPID_/.test(name);

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const on = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true";
export const stripAnthropicOn = (base: NodeJS.ProcessEnv): boolean => on(base.PLANIA_STRIP_ANTHROPIC_ENV);

function claudeAllows(name: string, base: NodeJS.ProcessEnv): boolean {
  if (CLAUDE_NAMES.includes(name) || CLAUDE_PREFIX.some((r) => r.test(name))) return true;
  if (on(base.CLAUDE_CODE_USE_BEDROCK) && BEDROCK.some((r) => r.test(name))) return true;
  if (on(base.CLAUDE_CODE_USE_VERTEX) && VERTEX.some((r) => r.test(name))) return true;
  return false;
}

// The run's environment, built from base (the server's) by allow-list.
export function runEnv(base: NodeJS.ProcessEnv, opts: RunEnvOptions = {}): NodeJS.ProcessEnv {
  const claude = opts.claude ?? true;
  const strip = claude && stripAnthropicOn(base);
  const named = new Set((opts.names ?? []).filter((n) => ENV_NAME.test(n) && !isPlaniaOwn(n)));
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || isPlaniaOwn(key)) continue;
    const allowed = BASIC_SET.has(key.toUpperCase()) || BASIC_PREFIX.some((r) => r.test(key)) || named.has(key) || (claude && claudeAllows(key, base));
    if (allowed) out[key] = value;
  }
  for (const [key, value] of Object.entries(opts.extra ?? {})) out[key] = value;
  if (strip) for (const key of Object.keys(out)) if (/^ANTHROPIC_/i.test(key)) delete out[key];
  return out;
}

// The variable names a project asks its runs to get (settings.runner.env), valid and not Plania's own.
export function projectEnvNames(settings: { runner?: { env?: unknown } } | null | undefined): string[] {
  const raw = settings?.runner?.env;
  if (!Array.isArray(raw)) return [];
  return raw.filter((n): n is string => typeof n === "string" && ENV_NAME.test(n) && !isPlaniaOwn(n));
}

// Motores: which sign-in Claude is using, in one sentence, from variable names only. Plania never reads Claude's
// credential files or keychain entry (test/run-env.test.ts scans src/ for that), so "plan" means: no key or
// provider is set in the environment, and Claude uses the login it keeps itself.
export type ClaudeSignIn = "bedrock" | "vertex" | "foundry" | "key" | "plan";
export function claudeSignIn(base: NodeJS.ProcessEnv): ClaudeSignIn {
  if (on(base.CLAUDE_CODE_USE_BEDROCK)) return "bedrock";
  if (on(base.CLAUDE_CODE_USE_VERTEX)) return "vertex";
  if (on(base.CLAUDE_CODE_USE_FOUNDRY)) return "foundry";
  if (!stripAnthropicOn(base) && (base.ANTHROPIC_API_KEY?.trim() || base.ANTHROPIC_AUTH_TOKEN?.trim())) return "key";
  return "plan";
}

const SIGN_IN_WORDS: Record<ClaudeSignIn, string> = {
  bedrock: "con tu cuenta de Amazon Bedrock",
  vertex: "con tu cuenta de Google Vertex AI",
  foundry: "con tu cuenta de Microsoft Foundry",
  key: "con una clave de API",
  plan: "con la sesión de tu plan",
};
export function claudeSignInLine(base: NodeJS.ProcessEnv): string {
  return `Los agentes usan Claude ${SIGN_IN_WORDS[claudeSignIn(base)]}, la que tú configuraste en Claude Code; Plania no la elige.`;
}
