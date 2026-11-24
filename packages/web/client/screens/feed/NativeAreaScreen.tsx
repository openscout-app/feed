import { defineSurface, type EmbedScreenProps } from "../../surfaces/types.ts";
import { useEmbedHeadline } from "../../surfaces/useEmbedHeadline.ts";
import { FeedContent } from "./FeedContent.tsx";

/** The Feed in the Mac app's Feed row: the same page the web draws at /feed. */
export function NativeAreaScreen({ navigate, expand }: EmbedScreenProps & { expand?: string }) {
  useEmbedHeadline("Feed", true);
  return <FeedContent navigate={navigate} expand={expand} />;
}

export const scoutSurface = defineSurface({
  id: "feed", label: "Feed", route: { view: "feed" }, webPath: "/feed",
  screen: "NativeAreaScreen",
  embed: { path: "/embed/feed", profile: "macos.feed", hosts: { macos: true } },
});
