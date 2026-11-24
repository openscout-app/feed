/** Canonical harness key after alias folding (anthropic → claude, etc.). */
export function normalizeHarnessKey(harness: string | null | undefined): string {
  const raw = harness?.trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw === "google antigravity" || raw === "google antigravity cli" || raw === "anti-gravity") return "antigravity";
  // Strip common decorations: "claude-code", "claude_code", "claude (sonnet)".
  const base = raw.replace(/[\s(].*$/, "").replace(/[_-].*$/, "");
  const ALIASES: Record<string, string> = {
    anthropic: "claude",
    claude: "claude",
    claudecode: "claude",
    sonnet: "claude",
    opus: "claude",
    openai: "codex",
    codex: "codex",
    gpt: "codex",
    chatgpt: "codex",
    oai: "codex",
    xai: "grok",
    grok: "grok",
    kimi: "kimi",
    moonshot: "kimi",
    devin: "devin",
    cognition: "devin",
    swe: "devin",
    antigravity: "antigravity",
    agy: "antigravity",
    google: "gemini",
    gemini: "gemini",
    vertex: "gemini",
    cursor: "cursor",
    github: "github",
    opencode: "opencode",
    oc: "opencode",
    amp: "amp",
    sourcegraph: "amp",
    pi: "pi",
    inflection: "pi",
    omp: "pi",
    "oh-my-pi": "pi",
    claw: "claw",
    native: "native",
    worker: "worker",
    quad: "quad",
  };
  const full = raw.replace(/[\s(].*$/, "");
  return Object.hasOwn(ALIASES, base) ? ALIASES[base]! : Object.hasOwn(ALIASES, full) ? ALIASES[full]! : raw;
}

const HARNESS_LABEL: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
  kimi: "Kimi",
  devin: "Devin",
  gemini: "Gemini",
  antigravity: "Google Antigravity",
  cursor: "Cursor",
  github: "GitHub",
  opencode: "OpenCode",
  amp: "Amp",
  pi: "Pi",
  claw: "Claw",
  native: "Native",
  worker: "Worker",
  quad: "Quad",
};

export function harnessLabel(harness: string | null | undefined): string {
  const key = normalizeHarnessKey(harness);
  return Object.hasOwn(HARNESS_LABEL, key) ? HARNESS_LABEL[key]! : harness?.trim() || "Unknown";
}
