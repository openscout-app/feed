import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WINDOW_MS = 14 * 24 * 3_600_000;

export function homeDir() {
  return process.env.SCOUT_SESSIONS_HOME || os.homedir();
}

export function runtimeUrl() {
  const explicit = process.env.SCOUT_RUNTIME_URL || process.env.OPENSCOUT_BROKER_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(homeDir(), ".openscout", "config.json"), "utf8"));
    if (cfg?.port) return `http://127.0.0.1:${cfg.port}`;
  } catch {}
  return "http://127.0.0.1:43110";
}

export function scoutBin() {
  if (process.env.SCOUT_BIN) return process.env.SCOUT_BIN;
  try {
    const pkg = require.resolve("@openscout/scout/package.json");
    const candidate = path.join(path.dirname(pkg), "bin", "scout");
    if (fs.existsSync(candidate)) return candidate;
  } catch {}
  const which = spawnSync("which", ["scout"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

export function findBun() {
  const which = spawnSync("which", ["bun"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

export async function checkRuntime(base = runtimeUrl()) {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500), redirect: "error" });
    return res.ok;
  } catch {
    return false;
  }
}

export function runScoutSetup() {
  const bin = scoutBin();
  const bun = findBun();
  if (!bin) throw new Error("Scout CLI not found. Reinstall @openscout/feed.");
  if (!bun) throw new Error("Bun 1.4.4+ is required to run Scout's background runtime (https://bun.sh).");
  const env = { ...process.env, PATH: `${path.dirname(bun)}:${process.env.PATH || ""}` };
  execFileSync(bin, ["setup"], { stdio: "pipe", env, timeout: 30_000 });
}

function walkJsonl(dir, maxDepth, out = [], depth = 0) {
  if (depth > maxDepth || !fs.existsSync(dir)) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsonl(full, maxDepth, out, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      try {
        const st = fs.statSync(full);
        if (Date.now() - st.mtimeMs <= WINDOW_MS && st.size > 0) {
          out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
        }
      } catch {}
    }
  }
  return out;
}

function tailText(filePath, maxBytes = 65_536) {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

const PR_URL_RE = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;

function collectPrs(text, prsMap, fallbackTitle) {
  if (!text || typeof text !== "string") return;
  const mergedHint = /\bmerged\b/i.test(text);
  for (const match of text.matchAll(PR_URL_RE)) {
    const [, owner, repo, num] = match;
    const key = `${repo}#${num}`;
    const prev = prsMap.get(key);
    prsMap.set(key, {
      key,
      label: key,
      number: Number(num),
      url: `https://github.com/${owner}/${repo}/pull/${num}`,
      title: prev?.title || fallbackTitle || key,
      state: prev?.state === "merged" || mergedHint ? "merged" : "open",
    });
  }
}

function recordTouchedPath(rawPath, cwd, set) {
  if (!rawPath || typeof rawPath !== "string") return;
  const cleaned = rawPath.trim();
  if (!cleaned) return;
  if (cwd && cleaned.startsWith(cwd)) {
    const rel = cleaned.slice(cwd.length).replace(/^[\\/]+/, "");
    if (rel) {
      set.add(rel);
      return;
    }
  }
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  set.add(parts.slice(-3).join("/") || cleaned);
}

function summarizeTranscript(item, source) {
  const raw = tailText(item.path);
  const lines = raw.split("\n").filter(Boolean);
  let prompt = null;
  let reply = null;
  let cwd = null;
  let branch = null;
  let sessionId = path.basename(item.path, ".jsonl");
  const touched = new Set();
  const prsMap = new Map();

  if (source === "antigravity") {
    const match = /brain[\\/]([\da-f-]{36})[\\/]/i.exec(item.path);
    if (match?.[1]) sessionId = match[1];
  } else if (source === "kimi") {
    const match = /sessions[\\/][^\\/]+[\\/]([^\\/]+)[\\/]agents/i.exec(item.path);
    if (match?.[1]) sessionId = match[1];
  }

  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (source === "claude") {
      if (obj.cwd && !cwd) cwd = obj.cwd;
      if (obj.gitBranch && !branch) branch = obj.gitBranch;
      if (obj.sessionId) sessionId = obj.sessionId;
      if (obj.type === "user" && typeof obj.message?.content === "string") prompt = obj.message.content;
      if (obj.type === "user" && Array.isArray(obj.message?.content)) {
        const text = obj.message.content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n").trim();
        if (text) prompt = text;
        for (const b of obj.message.content) {
          if (b.type === "tool_result" && typeof b.content === "string") collectPrs(b.content, prsMap, null);
        }
      }
      if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
        const text = obj.message.content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n").trim();
        if (text) {
          reply = text;
          collectPrs(text, prsMap, null);
        }
        for (const b of obj.message.content) {
          if (b.type === "tool_use" && b.input && (b.name === "Edit" || b.name === "Write" || b.name === "MultiEdit")) {
            recordTouchedPath(b.input.file_path || b.input.path, cwd, touched);
          }
        }
      }
    } else if (source === "codex") {
      if (obj.type === "session_meta") {
        if (obj.payload?.cwd) cwd = obj.payload.cwd;
        if (obj.payload?.git?.branch) branch = obj.payload.git.branch;
      }
      if (obj.type === "response_item" && obj.payload?.role === "user") {
        const text = (obj.payload.content || []).map((c) => c.text || c.input_text || "").join("\n").trim();
        if (text) prompt = text;
      }
      if (obj.type === "response_item" && obj.payload?.role === "assistant") {
        const text = (obj.payload.content || []).map((c) => c.text || c.output_text || "").join("\n").trim();
        if (text) {
          reply = text;
          collectPrs(text, prsMap, null);
        }
      }
      if (obj.type === "response_item" && (obj.payload?.type === "custom_tool_call" || obj.payload?.type === "function_call")) {
        const patchText = typeof obj.payload?.input === "string" ? obj.payload.input : (obj.payload?.arguments || "");
        for (const pm of String(patchText).matchAll(/\*\*\* (?:Update|Add) File:\s*([^\r\n]+)/g)) {
          recordTouchedPath(pm[1], cwd, touched);
        }
      }
      if (obj.type === "response_item" && obj.payload?.type === "function_call_output") {
        collectPrs(obj.payload.output, prsMap, null);
      }
    } else if (source === "antigravity") {
      const step = obj.step || obj;
      if (step.userInput?.userResponse) prompt = step.userInput.userResponse;
      if (step.plannerResponse?.modifiedResponse || step.plannerResponse?.response) {
        reply = step.plannerResponse.modifiedResponse || step.plannerResponse.response;
        collectPrs(reply, prsMap, null);
      }
      for (const tc of step.plannerResponse?.toolCalls || []) {
        if (tc.name === "edit_file" || tc.name === "write_file") {
          let args = tc.argumentsJson;
          if (typeof args === "string") {
            try { args = JSON.parse(args); } catch { args = null; }
          }
          if (args?.Path) recordTouchedPath(args.Path, cwd, touched);
        }
      }
      if (step.runCommand?.combinedOutput?.full) {
        collectPrs(step.runCommand.combinedOutput.full, prsMap, null);
      }
    } else if (source === "kimi") {
      if (obj.type === "turn.prompt" && Array.isArray(obj.input)) {
        const text = obj.input.map((p) => p.text || "").join("\n").trim();
        if (text) prompt = text;
      }
      if (obj.type === "context.append_loop_event" && obj.event?.part?.text) {
        reply = obj.event.part.text;
        collectPrs(reply, prsMap, null);
      }
    }
  }

  if (!reply && !prompt) return null;
  const cleanReply = (reply || prompt || "").trim();
  const firstLine = cleanReply.split("\n").find((l) => l.trim().length > 0)?.replace(/^#+\s*/, "").trim() || "Completed session turn";
  const headline = firstLine.slice(0, 140);
  const prs = [...prsMap.values()].map((pr) => ({
    ...pr,
    title: pr.title === pr.key ? headline : pr.title,
  }));
  const project = cwd ? path.basename(cwd) : path.basename(path.dirname(item.path));
  return {
    id: `local:session:${source}:${sessionId}`,
    sessionId,
    source,
    project: project.startsWith(".") || project === "logs" || project === "main" ? null : project,
    cwd,
    branch,
    title: headline,
    asked: prompt ? prompt.trim().slice(0, 280) : null,
    body: cleanReply.slice(0, 2400),
    filesTouched: [...touched],
    prs,
    at: Math.floor(item.mtimeMs),
    transcriptPath: item.path,
  };
}

export function scanLocalFeedSessions() {
  const home = homeDir();
  const groups = [
    { source: "claude", files: walkJsonl(path.join(home, ".claude", "projects"), 3) },
    { source: "codex", files: walkJsonl(path.join(home, ".codex", "sessions"), 4) },
    { source: "antigravity", files: [
      ...walkJsonl(path.join(home, ".gemini", "antigravity-cli", "brain"), 4),
      ...walkJsonl(path.join(home, ".gemini", "antigravity", "brain"), 4),
    ] },
    { source: "kimi", files: walkJsonl(path.join(home, ".kimi-code", "sessions"), 5) },
  ];

  const items = [];
  for (const group of groups) {
    const recent = group.files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 15);
    for (const file of recent) {
      try {
        const summary = summarizeTranscript(file, group.source);
        if (summary) items.push(summary);
      } catch {}
    }
  }
  return items.sort((a, b) => b.at - a.at).slice(0, 30);
}
