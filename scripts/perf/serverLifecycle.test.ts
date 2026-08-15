import { assert, describe, it } from "@effect/vitest";

import { parsePairingUrl } from "./serverLifecycle.ts";

describe("external server lifecycle output", () => {
  it("extracts the headless pairing URL without exposing surrounding output", () => {
    assert.equal(
      parsePairingUrl(
        "Ryco server is ready.\nConnection string: http://127.0.0.1:3773\nPairing URL: http://127.0.0.1:3773/pair#token=secret\n",
      ),
      "http://127.0.0.1:3773/pair#token=secret",
    );
  });

  it("rejects absent and invalid URLs", () => {
    assert.equal(parsePairingUrl("Ryco server is ready."), null);
    assert.equal(parsePairingUrl("\nPairing URL: not-a-url\n"), null);
  });
});
