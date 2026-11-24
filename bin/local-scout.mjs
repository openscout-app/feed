// Only the full Scout web client has the in-app Feed. An HTTP 200 from the
// shell can also be a basic client or the machine directory.
export async function fullFeedAvailable(web) {
  const signal = AbortSignal.timeout(1200);
  const options = { signal, redirect: "error" };
  try {
    const healthUrl = web + "/api/health";
    let health = await fetch(healthUrl, options);
    if (health.status === 401) {
      // Use the web client's normal loopback session. Keep it in memory and
      // send it only to the same fixed origin for this capability check.
      await health.body?.cancel();
      const bootstrap = await fetch(web + "/api/bootstrap.js", options);
      const cookies = bootstrap.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]);
      await bootstrap.body?.cancel();
      if (!bootstrap.ok || !cookies.length) return false;
      health = await fetch(healthUrl, { ...options, headers: { cookie: cookies.join("; ") } });
    }
    if (!health.ok) { await health.body?.cancel(); return false; }
    const info = await health.json();
    return info.ok === true && info.surface === "openscout-web" && info.webClient === "full";
  } catch {
    return false;
  }
}

export async function hasLocalRuntime(runtime) {
  try {
    const result = await fetch(runtime + "/v1/node", { signal: AbortSignal.timeout(750), redirect: "error" });
    if (!result.ok) { await result.body?.cancel(); return false; }
    return typeof (await result.json()).id === "string";
  } catch {
    return false;
  }
}
