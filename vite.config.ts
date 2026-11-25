import { defineScoutThinViteConfig } from "scout-app/vite";

export default defineScoutThinViteConfig({
  product: "Feed",
  variant: "feed",
  rail: "reading",
  port: 4806,
  serverEntry: "src/server.ts",
});
