# Scout Feed

This launcher opens the Feed from [Scout App](https://github.com/openscout-app/scout-app).
Expand a finished item to read the result, or choose **Open in Chat** to see
the exchange that produced it.

## Open the Feed

With Node.js 20.11 or later, run:

```sh
npx openscout-app/feed
```

If the full Scout web app is running locally, the launcher opens
`http://127.0.0.1:43120/embed/feed` and exits. The app keeps running.

Otherwise, the launcher starts Scout App's read-only preview on a free loopback
port. The preview reads from the local Scout runtime if one is available. If
there is no runtime, the preview starts a temporary one and shows **Nothing
finished yet**. The launcher prints the URL. Press **Ctrl-C** to stop the
preview and remove any temporary runtime data. If Bun 1.4.4 or later is not
installed, npm fetches Bun 1.4.4 on the first run.

- `--no-open` prints the URL without opening a browser.
- `--standalone` skips detection of the installed app and runtime.
- `SCOUT_PREVIEW_BROKER_URL` starts the preview with the loopback runtime you
  specify, for example `http://127.0.0.1:43110`. The preview does not start or
  stop that runtime.
- `SCOUT_PREVIEW_PORT` starts the preview on the port you specify. Use `0` to
  select a free port.

To start the preview with a temporary runtime without opening a browser, run:

```sh
npx openscout-app/feed --standalone --no-open
```

Use the printed loopback URL. Do not expose the preview through a tunnel or
reverse proxy. The Feed can contain private messages and media.

## Test the launcher

With Bun 1.4.4 or later, run `bun install` and `bun test`. To run the launcher
from the checkout, use `node bin/scout-feed.mjs`.

## Licenses

This launcher uses the [Apache License, Version 2.0](LICENSE).
[Scout App](https://github.com/openscout-app/scout-app/blob/05db573/LICENSE)
uses PolyForm Shield 1.0.0.
