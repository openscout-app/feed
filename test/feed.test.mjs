import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFeedServer } from "../server/serve.mjs";

test("serves prebuilt Feed HTML with embedded skeleton and populates from local transcripts and runtime", async (t) => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "scout-feed-test-"));
  const claudeDir = path.join(tempHome, ".claude", "projects", "demo-app");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, "sess-101.jsonl"),
    [
      JSON.stringify({ type: "user", cwd: "/tmp/demo-app", sessionId: "sess-101", message: { content: "Add dark mode tokens" } }),
      JSON.stringify({
        type: "assistant",
        cwd: "/tmp/demo-app",
        gitBranch: "feat/dark-tokens",
        sessionId: "sess-101",
        message: {
          content: [
            { type: "tool_use", name: "Edit", input: { file_path: "/tmp/demo-app/src/tokens.css" } },
            { type: "tool_use", name: "Write", input: { file_path: "/tmp/demo-app/src/theme.ts" } },
            { type: "text", text: "Added dark mode token variables and verified contrast.\nMerged https://github.com/acme/demo-app/pull/42" },
          ],
        },
      }),
    ].join("\n") + "\n",
  );

  useTestEnvironment(t, { SCOUT_SESSIONS_HOME: tempHome, SCOUT_RUNTIME_URL: "http://127.0.0.1:1" });

  const server = createFeedServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  // 1. HTML loads immediately with baked-in Scout Feed boot skeleton (zero runtime running).
  const htmlRes = await fetch(`${base}/`);
  assert.equal(htmlRes.status, 200);
  const html = await htmlRes.text();
  assert.match(html, /data-scout-boot="feed"/);
  assert.match(html, /Scout Feed/);

  // 2. Cross-origin requests are rejected.
  const crossOrigin = await fetch(`${base}/api/status`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(crossOrigin.status, 403);

  // 3. Feed populates immediately from local session history even with runtime offline.
  const feedRes = await fetch(`${base}/api/feed?view=all`);
  assert.equal(feedRes.status, 200);
  const feed = await feedRes.json();
  assert.equal(feed.posts.length, 1);
  assert.equal(feed.posts[0].title, "Added dark mode token variables and verified contrast.");
  assert.equal(feed.posts[0].agent.harness, "claude");
  assert.deepEqual(feed.posts[0].change, { files: 2, additions: null, deletions: null });
  assert.equal(feed.posts[0].prs.length, 1);
  assert.equal(feed.posts[0].prs[0].key, "demo-app#42");
  assert.equal(feed.posts[0].prs[0].state, "merged");

  const detailRes = await fetch(`${base}/api/feed/post/${encodeURIComponent(feed.posts[0].id)}`);
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json();
  assert.equal(detail.branch, "feat/dark-tokens");
  assert.equal(detail.prs.length, 1);

  // 4. Session drill-down returns full structured ObserveData (tool beats + prompt + reply).
  const sessionRes = await fetch(`${base}/api/session-ref/sess-101`);
  assert.equal(sessionRes.status, 200);
  const sessionRef = await sessionRes.json();
  assert.equal(sessionRef.observe.project, "demo-app");
  assert.equal(sessionRef.observe.data.metadata.session.branch, "feat/dark-tokens");
  assert.equal(sessionRef.observe.data.events.length, 4);
  assert.equal(sessionRef.observe.data.events[1].tool, "Edit");
  assert.equal(sessionRef.observe.data.events[2].tool, "Write");
});

function useTestEnvironment(t, overrides) {
  for (const [key, value] of Object.entries(overrides)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

async function listen(t, server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  return server.address().port;
}

async function cliStatus() {
  const bin = fileURLToPath(new URL("../bin/scout-feed.mjs", import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [bin, "status", "--json"]);
  return JSON.parse(stdout);
}

test("uses the loopback broker for feed reads and status when the configured TLS URL fails", async (t) => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "scout-feed-runtime-"));
  t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));
  useTestEnvironment(t, {
    SCOUT_SESSIONS_HOME: tempHome,
    SCOUT_RUNTIME_URL: undefined,
    OPENSCOUT_BROKER_URL: undefined,
  });

  const port = await listen(t, createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/health") {
      res.end("{}");
    } else if (req.url.startsWith("/v1/feed/work?")) {
      res.end(JSON.stringify({ tasks: [{ id: "loopback", reply: "Work from the local broker" }] }));
    } else {
      res.writeHead(404).end();
    }
  }));
  const loopback = `http://127.0.0.1:${port}`;
  const config = path.join(tempHome, ".openscout", "config.json");
  fs.mkdirSync(path.dirname(config));
  const feedPort = await listen(t, createFeedServer());
  const base = `http://127.0.0.1:${feedPort}`;
  const status = async () => (await fetch(`${base}/api/status`)).json();

  // A reachable configured host wins over loopback, and uses the nested broker port.
  fs.writeFileSync(config, JSON.stringify({ host: "localhost", ports: { broker: port } }));
  assert.deepEqual(await status(), { runtimeUp: true, runtimeUrl: `http://localhost:${port}`, localSessions: 0 });

  fs.writeFileSync(config, JSON.stringify({ url: `https://192.0.2.1:${port}` }));
  const expected = { runtimeUp: true, runtimeUrl: loopback, localSessions: 0 };
  assert.deepEqual(await status(), expected);
  // A TLS request to the HTTP-only broker fails without waiting on the network.
  fs.writeFileSync(config, JSON.stringify({ url: `https://127.0.0.1:${port}` }));
  const feed = await (await fetch(`${base}/api/feed`)).json();
  assert.deepEqual(feed.posts.map((post) => post.title), ["Work from the local broker"]);
  assert.deepEqual(await cliStatus(), expected);

  // An injected LAN endpoint takes precedence over config but can fall back.
  fs.writeFileSync(config, JSON.stringify({ url: "http://127.0.0.1:1" }));
  process.env.OPENSCOUT_BROKER_URL = `https://192.0.2.1:${port}`;
  assert.deepEqual(await status(), expected);
  assert.deepEqual(await cliStatus(), expected);

  // A Feed-specific override stays strict even with a working loopback broker.
  const strict = `https://127.0.0.1:${port}`;
  process.env.SCOUT_RUNTIME_URL = strict;
  assert.deepEqual(await status(), { runtimeUp: false, runtimeUrl: strict, localSessions: 0 });
});

test("hides local login, rate limit, and heartbeat noise from the feed and status counts", async (t) => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "scout-feed-login-"));
  t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));
  useTestEnvironment(t, { SCOUT_SESSIONS_HOME: tempHome, SCOUT_RUNTIME_URL: "http://127.0.0.1:1" });
  const claudeDir = path.join(tempHome, ".claude", "projects", "demo-app");
  fs.mkdirSync(claudeDir, { recursive: true });
  for (const [sessionId, reply] of [
    ["timed-out", "Login reached its time limit · Please run /login"],
    ["auth-timeout", "Failed to authenticate: this login reached its time limit. Please run /login again."],
    ["signed-out", "Please run /login"],
    ["multiline-timeout", "Login reached its time limit\nPlease run /login"],
    ["rate-limited", "You've hit your limit · resets 5pm (America/Montreal)"],
    ["actual-work", "Documented how to recover from a login timeout."],
    ["work-with-instructions", "Please run /login\nUpdated the sign-in docs and added tests."],
  ]) {
    fs.writeFileSync(path.join(claudeDir, `${sessionId}.jsonl`), [
      { type: "user", sessionId, message: { content: "Update the sign-in docs" } },
      { type: "assistant", sessionId, message: { content: [{ type: "text", text: reply }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  }
  const codexDir = path.join(tempHome, ".codex", "sessions");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, "rollout-heartbeat.jsonl"), [
    { type: "session_meta", payload: { id: "heartbeat", cwd: "/tmp/demo-app" } },
    { type: "response_item", payload: { role: "user", content: [{ type: "input_text", text: "  <HEARTBEAT>  " }] } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

  const port = await listen(t, createFeedServer());
  const base = `http://127.0.0.1:${port}`;
  const feed = await (await fetch(`${base}/api/feed`)).json();
  assert.deepEqual(feed.posts.map((post) => post.owner.sessionId).sort(), ["actual-work", "work-with-instructions"]);
  const hidden = await fetch(`${base}/api/feed/post/${encodeURIComponent("local:session:claude:timed-out")}`);
  assert.equal(hidden.status, 404);
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.localSessions, 2);
  assert.equal((await cliStatus()).localSessions, 2);
});

test("package.json stays npx-safe from git without triggering npm prepare/devDependencies", () => {
  const pkgPath = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  assert.equal(pkg.workspaces, undefined, "git packages with workspaces trigger npm git-dep preparation");
  const scripts = pkg.scripts ?? {};
  // pacote's GitFetcher.#prepareDir runs `npm install` (including devDependencies)
  // whenever any of these script names is present in a git-installed package.
  const prepareTriggers = ["postinstall", "build", "preinstall", "install", "prepack", "prepare"];
  for (const name of prepareTriggers) {
    assert.equal(
      scripts[name],
      undefined,
      `scripts.${name} triggers npm git-dep preparation during npx openscout-app/feed`,
    );
  }
  assert.ok(fs.existsSync(new URL("../dist/index.html", import.meta.url)), "prebuilt dist/index.html must be committed");
  assert.ok(fs.existsSync(new URL("../dist/thin-server.mjs", import.meta.url)), "prebuilt dist/thin-server.mjs must be committed");
});
