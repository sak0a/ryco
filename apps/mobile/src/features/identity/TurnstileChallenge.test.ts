import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View" }));
vi.mock("react-native-webview", () => ({ WebView: "WebView" }));

import {
  createTurnstileHtml,
  parseTurnstileMessage,
  TurnstileChallenge,
  turnstileOriginWhitelist,
} from "./TurnstileChallenge";

describe("TurnstileChallenge", () => {
  it("allows the Hub, Cloudflare, and WebView bootstrap documents", () => {
    expect(turnstileOriginWhitelist("https://hub.example.com")).toEqual([
      "https://hub.example.com",
      "https://challenges.cloudflare.com",
      "about:blank",
      "about:srcdoc",
    ]);
  });

  it("renders a bounded flexible mobile challenge with retry callbacks", () => {
    const html = createTurnstileHtml("public-site-key");

    expect(html).toContain('data-sitekey="public-site-key"');
    expect(html).toContain('data-size="flexible"');
    expect(html).toContain('data-retry="auto"');
    expect(html).toContain('data-error-callback="clear"');
    expect(html).toContain('data-expired-callback="clear"');
    expect(html).toContain('data-unsupported-callback="clear"');
  });

  it("accepts only a non-empty string token", () => {
    expect(parseTurnstileMessage('{"token":"verified"}')).toBe("verified");
    expect(parseTurnstileMessage('{"token":""}')).toBeNull();
    expect(parseTurnstileMessage('{"token":12}')).toBeNull();
    expect(parseTurnstileMessage("not-json")).toBeNull();
  });

  it("keeps the WebView bounded and enables Cloudflare's mobile requirements", () => {
    const element = TurnstileChallenge({
      origin: "https://hub.example.com",
      siteKey: "public-site-key",
      onToken: vi.fn(),
    }) as unknown as {
      readonly props: {
        readonly style: { readonly height: number; readonly flex: number };
        readonly children: {
          readonly props: {
            readonly style: { readonly height: number; readonly flex: number };
            readonly javaScriptEnabled: boolean;
            readonly domStorageEnabled: boolean;
            readonly sharedCookiesEnabled: boolean;
            readonly thirdPartyCookiesEnabled: boolean;
            readonly allowsInlineMediaPlayback: boolean;
            readonly mediaPlaybackRequiresUserAction: boolean;
            readonly scrollEnabled: boolean;
          };
        };
      };
    };

    expect(element.props.style).toMatchObject({ height: 80, flex: 0 });
    expect(element.props.children.props.style).toMatchObject({ height: 80, flex: 0 });
    expect(element.props.children.props).toMatchObject({
      javaScriptEnabled: true,
      domStorageEnabled: true,
      sharedCookiesEnabled: true,
      thirdPartyCookiesEnabled: true,
      allowsInlineMediaPlayback: true,
      mediaPlaybackRequiresUserAction: false,
      scrollEnabled: false,
    });
  });
});
