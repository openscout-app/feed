import fs from "node:fs";
import { checkRuntime, runtimeUrl, runScoutSetup, scanLocalFeedSessions } from "./runtime.mjs";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function isLoopbackHost(req) {
  return LOCAL_HOST.test(req.headers.host || "");
}

export function isLocalRequest(req) {
  const host = req.headers.host || "";
  if (!isLoopbackHost(req)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function workingDay(ms) {
  const shifted = new Date(ms - 4 * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

function headFromItem(item, version) {
  const day = workingDay(item.at);
  const label = item.source === "claude" ? "Claude Code"
    : item.source === "codex" ? "Codex"
      : item.source === "antigravity" ? "Antigravity"
        : item.source === "kimi" ? "Kimi"
          : item.agentName || "Scout Agent";
  const files = Array.isArray(item.filesTouched) ? item.filesTouched.length : 0;
  const prs = Array.isArray(item.prs) ? item.prs : [];
  return {
    id: item.id,
    version,
    day,
    at: item.at,
    class: "landed",
    reviewed: false,
    selected: true,
    score: 10,
    title: item.title,
    caption: item.asked,
    writtenBy: "reply",
    line: null,
    agent: { name: label, harness: item.source },
    others: 0,
    thread: item.project,
    state: "done",
    lead: { kind: "text", ref: null },
    change: files > 0 ? { files, additions: null, deletions: null } : null,
    joined: [],
    prs,
    prCount: prs.length,
    forYou: null,
    backToYou: false,
    updates: 0,
    workId: item.workId || item.id,
    conversationId: item.conversationId || null,
    owner: { agentId: null, sessionId: item.sessionId, cwd: item.cwd },
    study: null,
    project: item.project,
  };
}

async function readFeedSnapshot() {
  const base = runtimeUrl();
  const up = await checkRuntime(base);
  const items = new Map();

  if (up) {
    try {
      const since = Date.now() - 14 * 24 * 3_600_000;
      const res = await fetch(`${base}/v1/feed/work?mode=window&since=${since}&limit=100`, {
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
      if (res.ok) {
        const page = await res.json();
        for (const task of page.tasks || []) {
          if (task.state === "working") continue;
          items.set(`runtime:work:${task.id}`, {
            id: `runtime:work:${task.id}`,
            workId: task.id,
            conversationId: task.conversationId || null,
            sessionId: task.sessionId || null,
            source: task.harness || "scout",
            agentName: task.ownerName || task.ownerId || "Agent",
            project: task.cwd ? task.cwd.split(/[\\/]/).filter(Boolean).at(-1) : null,
            cwd: task.cwd || null,
            title: (task.presentation?.title || task.reply || task.title || "Completed work").split("\n")[0].slice(0, 140),
            asked: task.title || null,
            body: task.reply || task.title || "",
            at: task.finishedAt || task.updatedAt || Date.now(),
          });
        }
      }
    } catch {}
  }

  for (const local of scanLocalFeedSessions()) {
    if (!items.has(local.id)) items.set(local.id, local);
  }

  return { up, base, items: [...items.values()].sort((a, b) => b.at - a.at) };
}

export async function handle(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/") && !pathname.startsWith("/v1/")) return false;

  if (!isLocalRequest(req)) {
    sendJson(res, 403, { error: "Loopback requests from this page only." });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/identity") {
    sendJson(res, 200, { app: "@openscout/feed" });
    return true;
  }

  if (req.method === "GET" && pathname === "/v1/events/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    });
    res.write(": connected\n\n");
    const keepAlive = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => clearInterval(keepAlive));
    return true;
  }

  if (req.method === "GET" && pathname === "/api/status") {
    const runtime = runtimeUrl();
    const runtimeUp = await checkRuntime(runtime);
    const localSessions = scanLocalFeedSessions().length;
    sendJson(res, 200, { runtimeUp, runtimeUrl: runtime, localSessions });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/setup") {
    try {
      runScoutSetup();
      const runtime = runtimeUrl();
      sendJson(res, 200, { ok: true, runtimeUp: await checkRuntime(runtime) });
    } catch (err) {
      sendJson(res, 503, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/feed/sources") {
    sendJson(res, 200, { outside: [], quota: [] });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/feed/summaries") {
    sendJson(res, 200, { summaries: {}, pending: false, available: false });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/feed") {
    const view = url.searchParams.get("view") === "reviewed" ? "reviewed" : "all";
    const snapshot = await readFeedSnapshot();
    const version = snapshot.items[0]?.at ?? 1;
    const heads = (view === "reviewed" ? [] : snapshot.items).map((item) => headFromItem(item, version));
    const byDay = new Map();
    for (const head of heads) {
      let bucket = byDay.get(head.day);
      if (!bucket) {
        bucket = { day: head.day, at: head.at, ids: [], folded: [] };
        byDay.set(head.day, bucket);
      }
      if (bucket.ids.length < 8) bucket.ids.push(head.id);
      else bucket.folded.push(head.id);
    }
    const days = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
    sendJson(res, 200, {
      version,
      generatedAt: Date.now(),
      view,
      full: true,
      posts: heads,
      removed: [],
      days,
      cursor: null,
      size: { posts: heads.length, days: days.length, reviewed: 0 },
      home: null,
      views: ["all"],
    });
    return true;
  }

  const postMatch = /^\/api\/feed\/post\/(.+)$/.exec(pathname);
  if (req.method === "GET" && postMatch?.[1]) {
    const id = decodeURIComponent(postMatch[1]);
    const snapshot = await readFeedSnapshot();
    const item = snapshot.items.find((entry) => entry.id === id);
    if (!item) {
      sendJson(res, 404, { error: "Feed post not found." });
      return true;
    }
    const head = headFromItem(item, item.at);
    sendJson(res, 200, {
      id: item.id,
      version: item.at,
      asked: item.asked,
      branch: item.branch || null,
      body: { landed: item.body, checks: null, next: null, open: null },
      earlier: [],
      prs: head.prs,
      leads: [head.lead],
      diff: null,
      agents: [head.agent],
      posterCandidates: [],
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/messages") {
    const conversationId = url.searchParams.get("conversationId") || "";
    const base = runtimeUrl();
    if (conversationId && await checkRuntime(base)) {
      try {
        const upstream = await fetch(`${base}/v1/messages?conversationId=${encodeURIComponent(conversationId)}&limit=50`, {
          signal: AbortSignal.timeout(3000),
          redirect: "error",
        });
        if (upstream.ok) {
          const data = await upstream.json();
          sendJson(res, 200, Array.isArray(data) ? data : (data.messages || []));
          return true;
        }
      } catch {}
    }
    sendJson(res, 200, []);
    return true;
  }

  const sessionMatch = /^\/api\/session-ref\/(.+)$/.exec(pathname);
  if (req.method === "GET" && sessionMatch?.[1]) {
    const requested = decodeURIComponent(sessionMatch[1]);
    const local = scanLocalFeedSessions().find((item) => item.sessionId === requested || item.id.endsWith(requested));
    if (!local || !local.transcriptPath || !fs.existsSync(local.transcriptPath)) {
      sendJson(res, 404, { error: "Session transcript not found." });
      return true;
    }
    const events = [];
    if (local.asked) {
      events.push({ id: "prompt-1", kind: "prompt", text: local.asked, ts: local.at - 1000 });
    }
    events.push({ id: "reply-1", kind: "message", text: local.body, ts: local.at });
    sendJson(res, 200, {
      kind: "observe",
      refId: local.sessionId,
      observe: {
        kind: "history",
        refId: local.sessionId,
        sessionId: local.sessionId,
        source: "history",
        fidelity: "timestamped",
        updatedAt: local.at,
        data: {
          live: false,
          events,
          files: [],
          metadata: { session: { adapterType: local.source, cwd: local.cwd } },
        },
      },
    });
    return true;
  }

  sendJson(res, 404, { error: "Unknown Feed API route." });
  return true;
}
