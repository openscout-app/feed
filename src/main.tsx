import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FeedStandaloneSurface } from "scout-app/feed";
import { FeedGlyph } from "scout-app/primitives";
import { ScoutAppFrame, type ScoutRuntimeBadge } from "scout-app/shell";
import "scout-app/shell.css";

interface FeedHostStatus {
  runtimeUp: boolean;
  runtimeUrl: string;
  localSessions: number;
  settingUp?: boolean;
}

const PAGES = [{ id: "feed", label: "Feed", route: "/", icon: FeedGlyph }] as const;

function App() {
  const [status, setStatus] = useState<FeedHostStatus | null>(null);
  const [installing, setInstalling] = useState(false);

  const refreshStatus = useCallback(() => {
    fetch("/api/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setStatus(data as FeedHostStatus);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 15_000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  const runSetup = async () => {
    setInstalling(true);
    try {
      await fetch("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      refreshStatus();
    } finally {
      setInstalling(false);
    }
  };

  const badge: ScoutRuntimeBadge = !status
    ? { label: "Checking Scout", tone: "loading" }
    : status.runtimeUp
      ? { label: "Runtime connected", tone: "ready", detail: status.runtimeUrl }
      : { label: "Local session history", tone: "local", detail: `${status.localSessions} recent sessions` };

  const callout = status && !status.runtimeUp
    ? {
        title: "Scout runtime is not running yet.",
        description: "Recent local sessions already populate this Feed. Start the runtime to record asks, shows, and live completions.",
        command: "npx openscout-app/feed setup",
        actionLabel: installing ? "Starting…" : "Start runtime",
        onAction: installing ? undefined : () => void runSetup(),
      }
    : null;

  return (
    <ScoutAppFrame product="Feed" variant="feed" pages={PAGES} status={badge} setupCallout={callout}>
      <FeedStandaloneSurface />
    </ScoutAppFrame>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
