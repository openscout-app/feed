#!/usr/bin/env node
import { execFile, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fullFeedAvailable, hasLocalRuntime } from "./local-scout.mjs";
import { openFeed } from "./open-feed.mjs";

const web = "http://127.0.0.1:43120";
const runtime = "http://127.0.0.1:43110";

async function findBun() {
  const version = spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout?.trim();
  const [major, minor, patch] = (version ?? "").split(".").map(Number);
  const localBun = major > 1 || (major === 1 && (minor > 4 || (minor === 4 && patch >= 4)));
  if (localBun) return "bun";
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("Start with npx or install Bun 1.4.4 or later.");
  // Start Bun directly even when npm supplies it, so signals reach the preview.
  const { stdout } = await promisify(execFile)(process.execPath, [
    npm, "exec", "--yes", "--package=bun@1.4.4", "--", "bun", "--print", "process.execPath",
  ]);
  return stdout.trim();
}

async function linkPreviewRuntime(entry) {
  // The pinned preview uses a package-local runtime path even when npm or Bun hoists it.
  const scope = resolve(dirname(entry), "../node_modules/@openscout");
  const target = join(scope, "scout");
  const runtimeEntry = join(target, "bin/openscout-runtime.mjs");
  if (existsSync(runtimeEntry)) return;
  const source = dirname(createRequire(entry).resolve("@openscout/scout/package.json"));
  await mkdir(scope, { recursive: true });
  try {
    await symlink(process.platform === "win32" ? source : relative(scope, source), target, "junction");
  } catch (error) {
    if (error.code !== "EEXIST" || !existsSync(runtimeEntry)) throw error;
  }
}

async function startPreview(open, standalone) {
  const env = { ...process.env, SCOUT_PREVIEW_OPEN: open ? "1" : "0" };
  // The OS can allocate a free port even when another preview is running.
  env.SCOUT_PREVIEW_PORT ??= "0";
  if (!standalone && !env.SCOUT_PREVIEW_BROKER_URL && await hasLocalRuntime(runtime)) {
    env.SCOUT_PREVIEW_BROKER_URL = runtime;
  }

  const entry = fileURLToPath(import.meta.resolve("scout-app/scripts/preview.ts"));
  if (!env.SCOUT_PREVIEW_BROKER_URL) await linkPreviewRuntime(entry);
  const bun = await findBun();
  const child = spawn(bun, ["--no-env-file", entry], {
    // On Unix, only the launcher should receive the terminal's Ctrl-C.
    detached: process.platform !== "win32",
    stdio: ["ignore", open ? "pipe" : "inherit", "inherit"], env,
  });
  if (child.stdout) {
    child.stdout.pipe(process.stdout, { end: false });
    // The pinned preview prints the URL but does not open it.
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => {
      const match = /^Scout App Preview: (http:\/\/127\.0\.0\.1:\d{1,5}\/embed\/feed)$/.exec(line);
      if (match) {
        lines.close();
        openFeed(match[1]);
      }
    });
  }
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
    try {
      await startPreview(open, standalone);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
