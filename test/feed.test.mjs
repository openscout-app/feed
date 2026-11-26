import assert from "node:assert/strict";
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

  process.env.SCOUT_SESSIONS_HOME = tempHome;
  process.env.SCOUT_RUNTIME_URL = "http://127.0.0.1:1";

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
