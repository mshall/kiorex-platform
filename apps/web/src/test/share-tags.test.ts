import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");

describe("link preview tags (WhatsApp, Telegram, X)", () => {
  it("has the full Open Graph and Twitter set with ABSOLUTE image and url placeholders", () => {
    for (const tag of ["og:title", "og:description", "og:url", "og:image", "og:image:alt"]) expect(html).toContain(`property="${tag}"`);
    expect(html).toContain('property="og:image" content="__KX_SITE_URL__/og-image.png"');
    expect(html).toContain('property="og:url" content="__KX_SITE_URL__/"');
    expect(html).toContain('name="twitter:image" content="__KX_SITE_URL__/og-image.png"');
    expect(html).not.toMatch(/property="og:image" content="\//);
  });
  it("ships the icons the chat apps read (PNG, not only SVG)", () => {
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(html).toContain('href="/favicon-32.png"');
  });
});
