import { createRoot } from "react-dom/client";
import { FeedStandaloneSurface } from "scout-app/feed";
import {
  FeedGlyph,
  ScoutThinApp,
  type ScoutPageTab,
  type ScoutThinStatusBase,
} from "scout-app/shell";
import "scout-app/shell.css";

interface FeedHostStatus extends ScoutThinStatusBase {
  localSessions: number;
}

const FEED_PAGES: readonly ScoutPageTab[] = [
  { id: "feed", label: "Feed", route: "/", icon: FeedGlyph },
];

createRoot(document.getElementById("root")!).render(
  <ScoutThinApp<FeedHostStatus>
    product="Feed"
    variant="feed"
    rail="reading"
    pages={FEED_PAGES}
    chrome="sidebar"
    badge={(status) =>
      !status
        ? { label: "Checking Scout", tone: "loading" }
        : status.runtimeUp
          ? { label: "Runtime connected", tone: "ready", detail: status.runtimeUrl }
          : { label: "Local session history", tone: "local", detail: `${status.localSessions} recent sessions` }
    }
    setupCallout={({ status, installing, runSetup }) =>
      status.runtimeUp
        ? null
        : {
            title: "Scout runtime is not running yet.",
            description: "Recent local sessions already populate this Feed. Start the runtime to record asks, shows, and live completions.",
            command: "npx openscout-app/feed setup",
            actionLabel: installing ? "Starting…" : "Start runtime",
            onAction: installing ? undefined : runSetup,
          }
    }
  >
    <FeedStandaloneSurface />
  </ScoutThinApp>,
);
