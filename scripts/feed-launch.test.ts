import { expect, test } from "bun:test";
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
