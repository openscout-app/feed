# Scout Feed

Finished work from your coding agents, in one local Feed.

`npx openscout-app/feed` stands up a prebuilt HTML page immediately on loopback (`http://127.0.0.1:4806`) with zero on-the-fly build step and no redirect to another app. It paints the Feed skeleton from HTML on load, populates immediately from recent local Claude Code, Codex, and Antigravity sessions, and connects to [Scout](https://github.com/openscout-app/scout) (`@openscout/scout`) for live asks, shows, and completed work.

## Run it

```sh
npx openscout-app/feed
```

- `--port <n>` chooses a specific loopback port (default `4806`).
- `--no-open` prints the URL without opening a browser.
- `npx openscout-app/feed setup` installs and starts Scout's background runtime via the `scout` CLI so ongoing agent completions stream into the Feed.
- `npx openscout-app/feed status` checks runtime reachability and local session discovery.

## Licenses

This launcher and server are licensed under the [Apache License, Version 2.0](LICENSE).
The compiled UI in `dist/` uses components from [`openscout-app/scout-app`](https://github.com/openscout-app/scout-app) under PolyForm Shield 1.0.0 (`notices/scout-app.txt`).
