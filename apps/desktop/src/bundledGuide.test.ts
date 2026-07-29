import * as Path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveBundledRelayGuidePath } from "./bundledGuide.ts";

const appRoot = Path.resolve("/tmp/ryco-desktop-test/dist");
const sourceUrl = pathToFileURL(Path.join(appRoot, "index.html")).toString();

describe("resolveBundledRelayGuidePath", () => {
  it("accepts a generated relay guide below the loaded app directory", () => {
    const target = Path.join(appRoot, "assets", "relay-architecture-A1b_2.html");

    expect(resolveBundledRelayGuidePath(pathToFileURL(target).toString(), sourceUrl)).toBe(target);
  });

  it("rejects other local files and paths outside the loaded app directory", () => {
    expect(
      resolveBundledRelayGuidePath(
        pathToFileURL(Path.join(appRoot, "assets", "settings.html")).toString(),
        sourceUrl,
      ),
    ).toBeNull();
    expect(
      resolveBundledRelayGuidePath(
        pathToFileURL("/tmp/relay-architecture-stolen.html").toString(),
        sourceUrl,
      ),
    ).toBeNull();
  });

  it("rejects non-file sources and target URLs with metadata", () => {
    const targetUrl = pathToFileURL(
      Path.join(appRoot, "assets", "relay-architecture.html"),
    ).toString();

    expect(resolveBundledRelayGuidePath(targetUrl, "https://app.example.test/")).toBeNull();
    expect(resolveBundledRelayGuidePath(`${targetUrl}?unexpected=1`, sourceUrl)).toBeNull();
  });
});
