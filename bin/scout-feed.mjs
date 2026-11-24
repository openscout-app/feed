#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fullFeedAvailable, hasLocalRuntime } from "./local-scout.mjs";
import { openFeed } from "./open-feed.mjs";

const web = "http://127.0.0.1:43120";
const runtime = "http://127.0.0.1:43110";

async function startPreview(open, standalone) {
  const env = { ...process.env, SCOUT_PREVIEW_OPEN: open ? "1" : "0" };
  // The OS can allocate a free port even when another preview is running.
  env.SCOUT_PREVIEW_PORT ??= "0";
  if (!standalone && !env.SCOUT_PREVIEW_BROKER_URL && await hasLocalRuntime(runtime)) {
    env.SCOUT_PREVIEW_BROKER_URL = runtime;
  }

  const entry = fileURLToPath(new URL("../scripts/preview.ts", import.meta.url));
  const version = spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout?.trim();
  const [major, minor, patch] = (version ?? "").split(".").map(Number);
  const localBun = major > 1 || (major === 1 && (minor > 4 || (minor === 4 && patch >= 4)));
  const npm = process.env.npm_execpath;
  if (!localBun && !npm) throw new Error("Start with npx or install Bun 1.4.4 or later.");
  const child = localBun
    ? spawn("bun", ["--no-env-file", entry], { stdio: "inherit", env })
    : spawn(process.execPath, [npm, "exec", "--yes", "--package=bun@1.4.4", "--", "bun", "--no-env-file", entry], { stdio: "inherit", env });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  child.once("error", error => { console.error(error.message); process.exitCode = 1; });
  child.once("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1); });
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: scout-feed [--no-open] [--standalone]\nOpen the local Feed. --standalone always starts the read-only preview.");
} else if (args.some(arg => !["--no-open", "--standalone"].includes(arg))) {
  console.error("Usage: scout-feed [--no-open] [--standalone]");
  process.exitCode = 2;
} else {
  const open = !args.includes("--no-open");
  const standalone = args.includes("--standalone");
  const useApp = !standalone && !process.env.SCOUT_PREVIEW_BROKER_URL && !process.env.SCOUT_PREVIEW_PORT;
  if (useApp && await fullFeedAvailable(web)) {
    const url = web + "/embed/feed";
    console.log("Scout Feed: " + url);
    if (open) openFeed(url);
  } else {
    await startPreview(open, standalone);
  }
}
