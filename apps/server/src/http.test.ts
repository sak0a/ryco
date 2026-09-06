import { describe, expect, it } from "vite-plus/test";

import {
  downloadContentDisposition,
  inlineImageResponseHeaders,
  isLoopbackHostname,
  resolveDevRedirectUrl,
  userAssetResponseHeaders,
} from "./http.ts";

const testPath = {
  basename: (value: string) => value.split("/").at(-1) ?? value,
  extname: (value: string) => {
    const basename = value.split("/").at(-1) ?? value;
    const dot = basename.lastIndexOf(".");
    return dot < 0 ? "" : basename.slice(dot);
  },
};

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("does not treat LAN addresses as local", () => {
    expect(isLoopbackHostname("192.168.86.35")).toBe(false);
    expect(isLoopbackHostname("10.0.0.24")).toBe(false);
    expect(isLoopbackHostname("example.local")).toBe(false);
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});

describe("user asset response headers", () => {
  it("serves raster images inline with private caching and nosniff", () => {
    expect(userAssetResponseHeaders("/attachments/image.png", testPath)).toEqual({
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("sandboxes inline SVG images", () => {
    expect(userAssetResponseHeaders("/attachments/image.SVG", testPath)).toMatchObject({
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
    expect(inlineImageResponseHeaders("/project/favicon.svg")).toMatchObject({
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("forces documents to download as inert bytes", () => {
    expect(userAssetResponseHeaders("/attachments/report.html", testPath)).toMatchObject({
      "Content-Disposition": 'attachment; filename="report.html"',
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "application/octet-stream",
    });
    expect(userAssetResponseHeaders("/attachments/report.xml", testPath)).toMatchObject({
      "Content-Disposition": 'attachment; filename="report.xml"',
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "application/octet-stream",
    });
    expect(userAssetResponseHeaders("/attachments/report.docx", testPath)).toMatchObject({
      "Content-Disposition": 'attachment; filename="report.docx"',
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "application/octet-stream",
    });
  });

  it("keeps extensionless streamed uploads inert with a UTF-8 disposition", () => {
    expect(userAssetResponseHeaders("/attachments/thread-uuid-pdf", testPath)).toMatchObject({
      "Content-Disposition": 'attachment; filename="thread-uuid-pdf"',
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "application/octet-stream",
    });
  });
});

describe("downloadContentDisposition", () => {
  it("sanitizes quoted names and encodes non-ASCII names", () => {
    expect(downloadContentDisposition('we"ird\n.pdf')).toBe('attachment; filename="we_ird_.pdf"');
    expect(downloadContentDisposition("répört.pdf")).toBe(
      `attachment; filename="r_p_rt.pdf"; filename*=UTF-8''r%C3%A9p%C3%B6rt.pdf`,
    );
  });

  it("handles unpaired surrogates", () => {
    expect(downloadContentDisposition("bad\ud800name.pdf")).toBe(
      `attachment; filename="bad_name.pdf"; filename*=UTF-8''bad%EF%BF%BDname.pdf`,
    );
  });
});
