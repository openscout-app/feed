import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkRuntime,
  createScoutThinHttpHandler,
  createScoutThinServer,
  runScoutThinCli,
  runtimeUrl,
  scanLocalFeedSessions,
  sendJson,
  serveScoutThinServer,
  type ScoutThinServerOptions,
} from "scout-app/thin-server";

export const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const HELP = `Usage:
  scout-feed [--port <n>] [--no-open]
      Serve Scout Feed from prebuilt HTML on http://127.0.0.1:4806, populated
      from local session history and Scout's runtime.

  scout-feed setup
      Install and start Scout's local runtime via the Scout CLI so new asks,
      shows, and completed runs stream into the Feed.

  scout-feed status [--json]
      Report Scout runtime connectivity and discovered local sessions.`;

interface FeedItemRecord {
  id: string;
  workId?: string;
  conversationId?: string | null;
  sessionId: string | null;
  source: string;
  agentName?: string;
  project: string | null;
  cwd: string | null;
  branch?: string | null;
  title: string;
  asked: string | null;
  body: string;
  filesTouched?: string[];
  prs?: Array<{
    key: string;
    label: string;
    number: number;
    url: string;
    title: string;
    state: "open" | "merged";
  }>;
  at: number;
}

function workingDay(ms: number): string {
  const shifted = new Date(ms - 4 * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

function headFromItem(item: FeedItemRecord, version: number) {
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
  const items = new Map<string, FeedItemRecord>();

  if (up) {
    try {
      const since = Date.now() - 14 * 24 * 3_600_000;
      const res = await fetch(`${base}/v1/feed/work?mode=window&since=${since}&limit=100`, {
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
      if (res.ok) {
        const page = (await res.json()) as { tasks?: any[] };
        for (const task of page.tasks || []) {
          if (task.state === "working") continue;
          items.set(`runtime:work:${task.id}`, {
            id: `runtime:work:${task.id}`,
            workId: task.id,
            conversationId: task.conversationId || null,
            sessionId: task.sessionId || null,
            source: task.harness || "scout",
            agentName: task.ownerName || task.ownerId || "Agent",
            project: task.cwd ? String(task.cwd).split(/[\\/]/).filter(Boolean).at(-1) ?? null : null,
            cwd: task.cwd || null,
            title: String(task.presentation?.title || task.reply || task.title || "Completed work").split("\n")[0]!.slice(0, 140),
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

const SERVER_OPTIONS: ScoutThinServerOptions = {
  packageName: "@openscout/feed",
  product: "Feed",
  distDir: DIST,
  getStatus: () => ({ localSessions: scanLocalFeedSessions().length }),
  apiHandler: async (req, res, { url, pathname }) => {
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
      const byDay = new Map<string, { day: string; at: number; ids: string[]; folded: string[] }>();
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

    return false;
  },
};

export const handle = createScoutThinHttpHandler(SERVER_OPTIONS);

export function createFeedServer() {
  return createScoutThinServer(SERVER_OPTIONS);
}

export function serve(port: number, host = "127.0.0.1") {
  return serveScoutThinServer(createFeedServer, port, host);
}

export function cli(argv = process.argv.slice(2)) {
  return runScoutThinCli(
    {
      binName: "scout-feed",
      packageName: "@openscout/feed",
      product: "Feed",
      defaultPort: 4806,
      portEnvVar: "SCOUT_FEED_PORT",
      distDir: DIST,
      help: HELP,
      createServer: createFeedServer,
      getStatus: async () => {
        const url = runtimeUrl();
        const runtimeUp = await checkRuntime(url);
        const localSessions = scanLocalFeedSessions().length;
        return {
          json: { runtimeUp, runtimeUrl: url, localSessions },
          lines: [
            `Runtime:  ${runtimeUp ? `up at ${url}` : "not running (run scout-feed setup to start it)"}`,
            `Sessions: ${localSessions} recent local transcripts discovered`,
          ],
        };
      },
    },
    argv,
  );
}
