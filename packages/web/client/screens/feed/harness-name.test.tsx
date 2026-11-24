import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Mark } from "./sources.tsx";

test("Feed bylines render the harness name as plain text", () => {
  for (const [input, label] of [["openai", "Codex"], ["claude-code", "Claude"], ["agy", "Google Antigravity"], ["My Harness", "My Harness"], ["constructor", "constructor"]] as const) {
    const html = renderToStaticMarkup(<Mark harness={input} />);
    expect(html).toContain(`>${label}</span>`);
    expect(html).not.toMatch(/<svg|<img|<path/);
  }
  expect(renderToStaticMarkup(<Mark harness={null} />)).toBe("");
});
