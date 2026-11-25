import { defineScoutThinViteConfig } from "scout-app/vite";
// @ts-expect-error plain ESM server handler
import { handle } from "./server/api.mjs";

export default defineScoutThinViteConfig({
  product: "Feed",
  variant: "feed",
  port: 4806,
  apiHandler: handle,
});
