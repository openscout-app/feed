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
      JSON.stringify({ type: "assistant", cwd: "/tmp/demo-app", sessionId: "sess-101", message: { content: [{ type: "text", text: "Added dark mode token variables and verified contrast." }] } }),
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
});
