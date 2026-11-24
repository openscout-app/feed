import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fullFeedAvailable, hasLocalRuntime } from "../bin/local-scout.mjs";

test("the launcher confirms the full app with its loopback session before opening the Feed", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    switch (new URL(req.url).pathname) {
      case "/api/bootstrap.js":
        return new Response("", { headers: { "set-cookie": "session=fixture; HttpOnly; Path=/" } });
      case "/api/health":
        return req.headers.get("cookie") === "session=fixture"
          ? Response.json({ ok: true, surface: "openscout-web", webClient: "full" })
          : new Response(null, { status: 401 });
      default: return new Response(null, { status: 404 });
    }
  } });
  try { expect(await fullFeedAvailable(server.url.origin)).toBe(true); }
  finally { await server.stop(true); }
});

test("a basic client, portal or redirected endpoint never qualifies as the full Feed", async () => {
  for (const response of [
    () => Response.json({ ok: true, surface: "openscout-web", webClient: "basic" }),
    () => new Response("<title>Scout</title>"),
    () => Response.redirect("http://scout.invalid/"),
  ]) {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: response });
    try {
      expect(await fullFeedAvailable(server.url.origin)).toBe(false);
      expect(await hasLocalRuntime(server.url.origin)).toBe(false);
    } finally { await server.stop(true); }
  }
});

test("the launcher checks the local runtime's node identity", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    return new URL(req.url).pathname === "/v1/node"
      ? Response.json({ id: "fixture" })
      : new Response(null, { status: 404 });
  } });
  try { expect(await hasLocalRuntime(server.url.origin)).toBe(true); }
  finally { await server.stop(true); }
});

test("the standalone launcher serves the installed Scout App Feed and stops on SIGTERM", async () => {
  const entry = fileURLToPath(new URL("../bin/scout-feed.mjs", import.meta.url));
  const child = Bun.spawn(["node", entry, "--standalone", "--no-open"], {
    cwd: tmpdir(),
    env: { ...process.env, SCOUT_PREVIEW_BROKER_URL: "", SCOUT_PREVIEW_PORT: "0" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 50_000);
  let url: string | undefined;
  try {
    let output = "";
    for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
      output += chunk;
      url = /^Scout App Preview: (http:\/\/127\.0\.0\.1:\d+\/embed\/feed)$/m.exec(output)?.[1];
      if (url) break;
    }
    if (!url) throw new Error("The launcher did not print a Scout App preview URL");
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('src="/assets/preview.js"');

    const bundle = await fetch(new URL("/assets/preview.js", url), { signal: AbortSignal.timeout(5000) });
    expect(bundle.status).toBe(200);
    expect(await bundle.text()).toContain("Read-only Feed preview. Reply to agents");
  } finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
  }
  await expect(fetch(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
}, 60_000);
