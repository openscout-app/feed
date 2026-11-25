#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkRuntime, runtimeUrl, runScoutSetup, scanLocalFeedSessions } from "../server/runtime.mjs";
import { DIST, serve } from "../server/serve.mjs";

const FIRST_PORT = 4806;
const args = process.argv.slice(2);
const opt = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const HELP = `Usage:
  scout-feed [--port <n>] [--no-open]
      Serve Scout Feed from prebuilt HTML on http://127.0.0.1:4806, populated
      from local session history and Scout's runtime.

  scout-feed setup
      Install and start Scout's local runtime via the Scout CLI so new asks,
      shows, and completed runs stream into the Feed.

  scout-feed status [--json]
      Report Scout runtime connectivity and discovered local sessions.`;

if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

if (args[0] === "setup") {
  try {
    runScoutSetup();
    console.log(`Scout runtime is ready at ${runtimeUrl()}.`);
    process.exit(0);
  } catch (err) {
    console.error(`scout-feed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (args[0] === "status") {
  const url = runtimeUrl();
  const up = await checkRuntime(url);
  const localSessions = scanLocalFeedSessions().length;
  if (args.includes("--json")) {
    console.log(JSON.stringify({ runtimeUp: up, runtimeUrl: url, localSessions }, null, 2));
  } else {
    console.log(`Runtime:  ${up ? `up at ${url}` : "not running (run scout-feed setup to start it)"}`);
    console.log(`Sessions: ${localSessions} recent local transcripts discovered`);
  }
  process.exit(0);
}

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("scout-feed: dist/index.html is missing. Run `npm run build` first.");
  process.exit(1);
}

const requested = Number(opt("--port") ?? process.env.SCOUT_FEED_PORT ?? 0);
const startPort = requested || FIRST_PORT;
const open = !args.includes("--no-open");

function openBrowser(url) {
  if (!open) return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const cmdArgs = process.platform === "win32" ? ["/c", "start", url] : [url];
  execFile(cmd, cmdArgs, () => {});
}

for (let port = startPort; port < startPort + (requested ? 1 : 10); port++) {
  try {
    await serve(port);
    const url = `http://127.0.0.1:${port}`;
    console.log(`Scout Feed: ${url}`);
    openBrowser(url);
    break;
  } catch (err) {
    if (err?.code === "EADDRINUSE") {
      try {
        const check = await fetch(`http://127.0.0.1:${port}/api/identity`, { signal: AbortSignal.timeout(800) });
        if (check.ok && (await check.json()).app === "@openscout/feed") {
          const url = `http://127.0.0.1:${port}`;
          console.log(`Scout Feed is already running at ${url}`);
          openBrowser(url);
          process.exit(0);
        }
      } catch {}
      if (!requested) continue;
    }
    console.error(`scout-feed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
