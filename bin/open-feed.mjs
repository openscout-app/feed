import { execFile } from "node:child_process";

export function openFeed(url) {
  const [command, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : ["xdg-open", [url]];
  execFile(command, args, error => {
    if (error) console.error("Open the Feed in your browser at " + url);
  });
}
