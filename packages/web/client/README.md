# Feed client

For the standalone preview, run the [root startup command](../../../README.md#start-the-preview). The contract below describes what a full host can supply. The preview mounts the read-only Feed and Chat routes, omits write controls, and uses polling.

The Mac Feed screen is `screens/feed/NativeAreaScreen.tsx`. It exports the surface description for `/embed/feed` (profile `macos.feed`) and renders `FeedContent → FeedStream → FeedItem`. The client reads the local runtime; it has no bundled posts or offline demo. This package does not start a server, register a host route, or open a WebView.

## Mount it

Have the local shell serve its React entry at `/embed/feed` on the **same origin** as the API. Use the shell's React 19 runtime once for both the root and these components. With a router, pass its navigation function as the fallback:

```tsx
import { NativeAreaScreen } from "./screens/feed/NativeAreaScreen.tsx";
import { routeEmbeddedNavigation } from "./surfaces/embed-navigation.ts";
import type { Route } from "./lib/types.ts";
import "./surfaces/feed-embed-theme.css";

export function FeedPage({ navigate, theme }: {
  navigate: (route: Route) => void;
  theme: "light" | "dark";
}) {
  return (
    <div className="scout-feed-embed" data-scout-theme={theme}>
      <NativeAreaScreen navigate={route => routeEmbeddedNavigation(route, navigate)} />
    </div>
  );
}
```

Give the mount a height. The optional stylesheet supplies the Feed's spacing, type and base palettes in the wrapper; omit it if the host already supplies Scout theme tokens. Keep the stream and its lightbox under the same `div[data-scout-theme]`. Bundle the component CSS imports with the JS.

The native bridge receives `{ kind: "ui-action", action: { type: "navigate", route } }`. Without that bridge, the shell owns the destinations: `/c/:conversationId`, `/sessions/:sessionId`, and `/work/:workId`. “Copy a link to this post” uses `/?post=:id`; the receiving Home route must pass that id as `FeedStream.expand`. The standalone native Feed is not the Home stream: leave its own scrolling and undo toast enabled.

## Local service contract

| Feature | Host dependency |
| --- | --- |
| Stream | `GET /api/feed?view=all\|reviewed`. Supply the production heads and day groups in `../shared/api/feed.ts`. Older pages use `cursor`; refresh uses `since` and accepts HTTP 304. A failed first read shows a retry state, not an empty feed. |
| Source posts and media | `GET /api/feed/sources` for outside threads and quota warnings (contract: `lib/feed-sources.ts`); `GET /api/feed/summaries?posts=…` for batched summaries; `GET /api/feed/live?since=…` for visible live leads. Serve the asset and page URLs the heads return. No media or outside conversations ship with the client. |
| Expanded item | `GET /api/feed/post/:id`, then `GET /api/session-ref/:ref` if there is an owner session. Commit diffs use `GET /api/repo-diff/worktree` with the checkout, branch layer, base and compare refs, patch tier and cache preference. Trace previews are the fallback. |
| Discussion | Opening the thread is navigation, not a new write. Reply/React can send `POST /api/sessions/reply` with the session id, body and client message id. A successor sends `POST /api/work/:id/continue` with body and request id. “Ask about this” uses `POST /api/scoutbot/artifact-ask`: Scoutbot answers from the post, not by interrupting its owner. |
| Moves and undo | `POST /api/work/:id/move` returns an applied/refused decision. `POST /api/feed/moves` records a completed action. Hide posts to `/api/feed/hides` with the id and time; undo deletes `/api/feed/hides?id=…`. Keep writes on the authorized local runtime and return its real decisions. |
| Refresh and auth | Same-origin tRPC WebSockets: `control.events` at `/ws/events`, `tail.events` at `/ws/tail` for open session detail. The stream retains its production polling fallback. The JSON client retries a 401 once after a successful bootstrap read (`/api/bootstrap.js` by default). |
| Reply dictation | The mic probes `/api/voice/health`, engages capture, and starts capture with `POST /api/voice/session` and uses its events, stop and cancel routes, or browser audio with `/api/voice/transcribe`. The permission/settings fallback is in `lib/scout-voice.ts`. Typed replies do not require voice. |

The only application imports outside this package are the clean base's `../shared/api/feed.ts` and `feed-moves.ts`. React, React DOM, Lucide, the tRPC client and the public Scout protocol package are pinned by this workspace manifest and the repository lockfile. The client uses the local transport, not paired-host transports, a hosted console, or another screen's router.

## Check without a running app

From this directory:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test
out="$(mktemp -d)"
bun build ./screens/feed/NativeAreaScreen.tsx --target browser --outdir "$out"
rm -r "$out"
```

The tests use constructed inputs, static React rendering and intercepted HTTP requests. They neither read a recorded feed nor send a real message. The root host mounts the native Feed surface on the same origin as the read-only API.
