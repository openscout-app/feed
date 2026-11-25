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

function summarizeTranscript(item, source) {
  const raw = tailText(item.path);
  const lines = raw.split("\n").filter(Boolean);
  let prompt = null;
  let reply = null;
  let cwd = null;
  let sessionId = path.basename(item.path, ".jsonl");

  if (source === "antigravity") {
    const match = /brain[\\/]([\da-f-]{36})[\\/]/i.exec(item.path);
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
      if (obj.sessionId) sessionId = obj.sessionId;
      if (obj.type === "user" && typeof obj.message?.content === "string") prompt = obj.message.content;
      if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
        const text = obj.message.content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n").trim();
        if (text) reply = text;
      }
    } else if (source === "codex") {
      if (obj.type === "session_meta" && obj.payload?.cwd) cwd = obj.payload.cwd;
      if (obj.type === "response_item" && obj.payload?.role === "user") {
        const text = (obj.payload.content || []).map((c) => c.text || "").join("\n").trim();
        if (text) prompt = text;
      }
      if (obj.type === "response_item" && obj.payload?.role === "assistant") {
        const text = (obj.payload.content || []).map((c) => c.text || "").join("\n").trim();
        if (text) reply = text;
      }
    } else if (source === "antigravity") {
      const step = obj.step || obj;
      if (step.userInput?.userResponse) prompt = step.userInput.userResponse;
      if (step.plannerResponse?.modifiedResponse || step.plannerResponse?.response) {
        reply = step.plannerResponse.modifiedResponse || step.plannerResponse.response;
      }
    }
  }

  if (!reply && !prompt) return null;
  const cleanReply = (reply || prompt || "").trim();
  const firstLine = cleanReply.split("\n").find((l) => l.trim().length > 0)?.replace(/^#+\s*/, "").trim() || "Completed session turn";
  const project = cwd ? path.basename(cwd) : path.basename(path.dirname(item.path));
  return {
    id: `local:session:${source}:${sessionId}`,
    sessionId,
    source,
    project: project.startsWith(".") ? null : project,
    cwd,
    title: firstLine.slice(0, 140),
    asked: prompt ? prompt.trim().slice(0, 280) : null,
    body: cleanReply.slice(0, 2400),
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
