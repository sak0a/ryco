import {
  createDesktopNativeAuthorization,
  DesktopAuthorizationCallbackBroker,
  desktopAuthorizationCallbackUri,
  findDesktopAuthorizationCallback,
} from "./nativeAuthorization.ts";
import { describe, expect, it, vi } from "vite-plus/test";

const callback =
  `ryco://hosted/complete?code=${"A".repeat(43)}&state=${"B".repeat(43)}` +
  `&handoff_id=${"C".repeat(43)}`;

describe("Desktop native browser authorization", () => {
  it("uses only the fixed production and development callbacks", () => {
    expect(desktopAuthorizationCallbackUri("production")).toBe("ryco://hosted/complete");
    expect(desktopAuthorizationCallbackUri("preview")).toBe("ryco-preview://hosted/complete");
    expect(desktopAuthorizationCallbackUri("development")).toBe("ryco-dev://hosted/complete");
    expect(findDesktopAuthorizationCallback(["--flag", callback], "ryco://hosted/complete")).toBe(
      callback,
    );
    expect(
      findDesktopAuthorizationCallback(["ryco://other/complete"], "ryco://hosted/complete"),
    ).toBeNull();
  });

  it("opens the system browser and resolves only its exact callback base", async () => {
    const broker = new DesktopAuthorizationCallbackBroker();
    const openExternal = vi.fn(async () => undefined);
    const service = createDesktopNativeAuthorization({
      variant: "production",
      deviceLabel: () => "  Ada's Mac  ",
      broker,
      openExternal,
    });
    const pending = service.openSystemBrowser(
      "https://hub.example.test/native/authorize/opaque",
      "ryco://hosted/complete",
    );
    expect(openExternal).toHaveBeenCalledWith("https://hub.example.test/native/authorize/opaque");
    expect(broker.accept("ryco://other/complete?code=bad")).toBe(false);
    expect(broker.accept(callback)).toBe(true);
    await expect(pending).resolves.toEqual({ type: "success", url: callback });
    expect(service.deviceLabel()).toBe("Ada's Mac");
  });

  it("cancels on abort and supersedes a previous browser wait", async () => {
    const broker = new DesktopAuthorizationCallbackBroker();
    const first = broker.open({
      authorizationUrl: "https://hub.example.test/first",
      callbackUri: "ryco://hosted/complete",
      openExternal: async () => undefined,
    });
    const controller = new AbortController();
    const second = broker.open({
      authorizationUrl: "https://hub.example.test/second",
      callbackUri: "ryco://hosted/complete",
      openExternal: async () => undefined,
      signal: controller.signal,
    });
    await expect(first).resolves.toEqual({ type: "cancel" });
    controller.abort();
    await expect(second).resolves.toEqual({ type: "cancel" });
  });
});
