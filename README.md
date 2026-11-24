# Scout Feed

Open a finished piece of local agent work in the Feed. Expand the item to read the result, or choose **Open in Chat** to see the request and reply that produced it. The preview uses the Scout app's Feed client and the [public Scout runtime](https://github.com/openscout-app/scout).

## Open Feed with npx

From any directory with Node.js 20.11 or later, run:

```sh
npx --yes github:openscout-app/feed
```

When the full Scout web app is already running on this machine, the command opens its Feed directly at **http://127.0.0.1:43120/embed/feed**. The launcher exits and the app keeps running.

On a machine with just the local Scout runtime, the command starts the read-only preview with that runtime's work. On a new machine, it starts a temporary runtime and shows **Nothing finished yet** until there is work to show. The preview opens on a free loopback port and prints the URL. Press **Ctrl-C** to stop it. If the preview needs Bun, npm can fetch the pinned version on the first run.

Use `--no-open` to print the URL without opening a browser. Use `--standalone` to try the preview with a fresh, empty runtime, or set `SCOUT_PREVIEW_BROKER_URL` to select the runtime you want to read.

## Start the preview

Install [Bun](https://bun.sh) 1.4.4 or later. From the root of a fresh checkout, run:

```sh
bun run start
```

Open **http://127.0.0.1:4173/embed/feed**. The command installs the locked public dependencies, builds the client, and starts a temporary Scout runtime on loopback. It does not require a Scout account, another checkout, or an installed Scout service. The first install needs internet access.

A new runtime has no work. Its Feed says **Nothing finished yet.** It does not load sample posts. To see your own work, connect an existing runtime as described below. Press **Ctrl-C** to stop the preview and remove the temporary runtime data. The installed dependencies remain in `node_modules/`.

## Read your local work

If you already run Scout with the Feed work API (tested with 0.5.4), specify its loopback HTTP origin instead:

```sh
SCOUT_PREVIEW_BROKER_URL=http://127.0.0.1:43110 bun run start
```

This mode reads the runtime you named. It does not start, restart, or stop it. If the runtime cannot serve the Feed, the page reports a read failure rather than showing an empty Feed. A runtime that requires credentials is not supported. The preview does not forward tokens or expose write endpoints.

- Click an item to open its detail. **Esc** closes it.
- **Open in Chat** follows both the conversation ID and work ID. A newer message in the same chat does not replace the recorded exchange. If the reply is missing, Chat says so.
- A standalone post has no task discussion. If it names an original harness session, the preview offers that session instead.
- The preview reads the last 14 days. It polls for changes. Sending replies, moving work, provider connections, and hosted enrichment are not part of this preview.

Use the printed loopback URL. Do not expose it through a tunnel or reverse proxy: local records may contain private messages or media. To choose another web port, set `SCOUT_PREVIEW_PORT` (use `0` to select a free port).

## Check the checkout

After installing dependencies, run `bun run check` for both TypeScript projects and `bun run test` for the client, API, and host tests. The [local Feed API guide](packages/web/server/feed/README.md) also documents a compatibility check that writes test-owned records into a temporary public-core SQLite database. Neither the tests nor the first run need a copy of anyone's activity.

## License

This Feed preview is licensed under the [Apache License, Version 2.0](LICENSE). It identifies harnesses by name, without their logos.
