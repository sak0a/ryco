// Behaviour of the hosted account settings surface, against the real runtime
// stores with only the controller's network-touching actions stubbed.
//
// What is pinned here is not markup. It is the things that would be a security
// defect rather than a cosmetic one:
//
//   * a destructive action never fires before an explicit confirmation;
//   * a freshly minted set of recovery codes cannot be destroyed by an accident
//     — no Escape, no backdrop, no close button, one explicit acknowledgement;
//   * a TOTP field appears only after the Hub has demanded a step-up, and only
//     for the gate that has a step-up out of it, and the retry carries the code;
//   * a committed credential is never reported as a failed one, because that
//     invites a second ceremony and a duplicate credential;
//   * a request that never answers can always be abandoned;
//   * secret material never reaches a persisted store, the URL, or a DOM
//     attribute, and a dismissed or torn-down secret is cleared from the
//     runtime rather than merely hidden.
import "../../index.css";

import { page, userEvent } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";
import {
  HostedHubApiError,
  HOSTED_PASSKEY_UNCONFIRMED_MESSAGE,
  PASSKEY_SESSION_REQUIRED_CODE,
  STEP_UP_REQUIRED_CODE,
  type HostedHubPasskey,
} from "@ryco/client-runtime/authorization";

import { hostedAccountStore, hostedHubController, hostedHubStore } from "../../hostedHub/state";
import { useRecoveryCodeDisplayStore } from "../../hostedHub/recoveryCodeDisplay";
import { AccountSettingsPanel } from "./AccountSettings";

const STEP_UP_MESSAGE = new HostedHubApiError(STEP_UP_REQUIRED_CODE, 403).message;
const PASSKEY_SESSION_MESSAGE = new HostedHubApiError(PASSKEY_SESSION_REQUIRED_CODE, 403).message;

const RECOVERY_CODES = [
  "aaaa-1111-bbbb",
  "cccc-2222-dddd",
  "eeee-3333-ffff",
  "gggg-4444-hhhh",
] as const;

const TOTP_SECRET = "JBSWY3DPEHPK3PXPZZZZ";
const TOTP_URI = `otpauth://totp/Ryco:ada@example.com?secret=${TOTP_SECRET}&issuer=Ryco`;

const ACCOUNT = {
  id: "acct_aaaaaaaaaaaaaaaaaaaaaa",
  displayName: "Ada",
  role: "owner" as const,
  createdAt: 1_700_000_000_000,
  disabledAt: null,
};

const SESSION = {
  id: "sess_aaaaaaaaaaaaaaaaaaaaaa",
  accountId: ACCOUNT.id,
  createdAt: 1_700_000_000_000,
  expiresAt: 1_800_000_000_000,
  lastSeenAt: 1_700_000_000_000,
  revokedAt: null,
  revocationReasonCode: null,
};

function passkey(overrides: Partial<HostedHubPasskey> = {}): HostedHubPasskey {
  return {
    id: "pkey_aaaaaaaaaaaaaaaaaaaaaa",
    label: "Work laptop",
    createdAt: 1_700_000_000_000,
    lastUsedAt: 1_700_000_500_000,
    backupEligible: true,
    backupState: true,
    revokedAt: null,
    revocationReasonCode: null,
    ...overrides,
  };
}

/** A promise plus the handle that settles it, for a request that has not landed. */
function deferred(): { readonly promise: Promise<void>; readonly land: () => void } {
  let land = () => undefined as void;
  const promise = new Promise<void>((resolve) => {
    land = resolve;
  });
  return { promise, land };
}

/**
 * Give any dismissal, navigation, or store write that was going to happen the
 * chance to happen. Assertions that something did *not* occur are worthless
 * against a retrying matcher that passes on the first frame.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 60);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("IndexedDB request failed."));
    });
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return requestResult(indexedDB.open(name));
}

function describeValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Every record in every IndexedDB database this origin holds. */
async function indexedDbSnapshot(): Promise<string> {
  const parts: Array<string> = [];
  for (const { name } of await indexedDB.databases()) {
    if (name === undefined) continue;
    parts.push(name);
    const database = await openDatabase(name);
    try {
      const storeNames = Array.from(database.objectStoreNames);
      if (storeNames.length === 0) continue;
      const transaction = database.transaction(storeNames, "readonly");
      for (const storeName of storeNames) {
        const store = transaction.objectStore(storeName);
        parts.push(
          storeName,
          describeValue(await requestResult(store.getAllKeys())),
          describeValue(await requestResult(store.getAll())),
        );
      }
    } finally {
      database.close();
    }
  }
  return parts.join("\n");
}

/**
 * Everything the browser would still be holding after a reload.
 *
 * Both web storages are the obvious places, and they are not the only ones: a
 * secret written to IndexedDB or set as a cookie survives a reload exactly as
 * well, and a snapshot blind to those would report "never persisted" for a
 * surface that had persisted them. The self-check below proves this can see all
 * four before any test leans on it.
 */
async function persistedStorageSnapshot(): Promise<string> {
  const parts: Array<string> = [document.cookie];
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null) continue;
      parts.push(key, storage.getItem(key) ?? "");
    }
  }
  parts.push(await indexedDbSnapshot());
  return parts.join("\n");
}

/**
 * Every attribute value in the document.
 *
 * `textContent` cannot see an `<img src>`, a `data:` URI, or a `value` — which
 * is exactly where a secret rendered by the wrong primitive would end up, still
 * in the DOM and still readable, while a textContent assertion reported it gone.
 */
function domAttributeSnapshot(): string {
  const parts: Array<string> = [];
  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      parts.push(`${attribute.name}=${attribute.value}`);
    }
  }
  return parts.join("\n");
}

/** The outside press that ordinarily dismisses a dialog. */
function pressBackdrop(): void {
  const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
  if (!(backdrop instanceof HTMLElement)) throw new Error("Expected a dialog backdrop to press.");
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    backdrop.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        isPrimary: true,
      }),
    );
  }
}

type Mounted = Awaited<ReturnType<typeof render>> & {
  cleanup?: () => Promise<void>;
  unmount?: () => Promise<void>;
};

describe("AccountSettingsPanel", () => {
  let mounted: Mounted | null = null;
  let clipboard: Array<string> = [];

  const mount = async () => {
    mounted = await render(<AccountSettingsPanel />);
    return mounted;
  };

  const teardown = async () => {
    if (!mounted) return;
    const stop = mounted.cleanup ?? mounted.unmount;
    await stop?.call(mounted).catch(() => undefined);
    mounted = null;
  };

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    clipboard = [];
    hostedHubStore.setState(
      {
        ...hostedHubStore.getInitialState(),
        accountStatus: "authenticated",
        account: ACCOUNT,
        session: SESSION,
      },
      true,
    );
    hostedAccountStore.setState(
      { ...hostedAccountStore.getInitialState(), passkeys: [passkey()], passkeysStatus: "ready" },
      true,
    );
    useRecoveryCodeDisplayStore.setState({ claims: 0 });
    // The mount read is a read; it must never be the thing that reaches the Hub
    // in a test about mutations.
    vi.spyOn(hostedHubController, "refreshPasskeys").mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          clipboard.push(value);
          return Promise.resolve();
        },
      },
    });
  });

  afterEach(async () => {
    await teardown();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  /* --------------------------------------------------- the tools themselves */

  it("has a persistence snapshot that can actually see every store a secret could reach", async () => {
    const canary = "canary-3f9c2a";
    const database = "account-settings-snapshot-self-check";
    window.localStorage.setItem("local", `${canary}-local`);
    window.sessionStorage.setItem("session", `${canary}-session`);
    document.cookie = `snapshot-self-check=${canary}-cookie; path=/`;
    const opened = indexedDB.open(database, 1);
    opened.addEventListener("upgradeneeded", () => {
      opened.result.createObjectStore("records");
    });
    const connection = await requestResult(opened);
    await new Promise<void>((resolve, reject) => {
      const transaction = connection.transaction(["records"], "readwrite");
      transaction.objectStore("records").put(`${canary}-indexeddb`, "record");
      transaction.addEventListener("complete", () => {
        resolve();
      });
      transaction.addEventListener("error", () => {
        reject(transaction.error ?? new Error("IndexedDB write failed."));
      });
    });
    connection.close();

    try {
      const persisted = await persistedStorageSnapshot();
      for (const store of ["local", "session", "cookie", "indexeddb"]) {
        expect(persisted, `the snapshot is blind to ${store}`).toContain(`${canary}-${store}`);
      }
    } finally {
      document.cookie = "snapshot-self-check=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      indexedDB.deleteDatabase(database);
    }
  });

  it("dismisses an ordinary dialog on Escape and on a backdrop press", async () => {
    // The control for every "this one does not dismiss" assertion below: if
    // these two gestures were inert in this harness, those assertions would
    // pass without proving anything.
    await mount();
    await page.getByRole("button", { name: "Add passkey" }).click();
    await expect.element(page.getByText("Add a passkey")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByText("Add a passkey")).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Add passkey" }).click();
    await expect.element(page.getByText("Add a passkey")).toBeVisible();

    pressBackdrop();
    await expect.element(page.getByText("Add a passkey")).not.toBeInTheDocument();
  });

  /* ------------------------------------------- destructive actions confirm */

  it("rotates recovery codes only after an explicit confirmation that says what it destroys", async () => {
    const regenerate = vi
      .spyOn(hostedHubController, "regenerateRecoveryCodes")
      .mockImplementation(async () => {
        hostedHubStore.setState({ recoveryCodes: [...RECOVERY_CODES] });
        hostedAccountStore.setState({ errorMessage: null });
      });

    await mount();
    await page.getByRole("button", { name: "Generate new codes" }).click();

    expect(
      regenerate,
      "the trigger opens a confirmation; it must not rotate on its own",
    ).not.toHaveBeenCalled();
    await expect
      .element(page.getByText(/Every code you have already saved stops working immediately/i))
      .toBeVisible();

    await page.getByRole("button", { name: "Replace codes" }).click();
    expect(regenerate).toHaveBeenCalledOnce();
  });

  it("leaves the saved codes alone when the confirmation is declined", async () => {
    const regenerate = vi.spyOn(hostedHubController, "regenerateRecoveryCodes").mockResolvedValue();

    await mount();
    await page.getByRole("button", { name: "Generate new codes" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect
      .element(page.getByText(/Every code you have already saved stops working/i))
      .not.toBeInTheDocument();
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("never rotates recovery codes as a side effect of mounting the surface", async () => {
    const regenerate = vi.spyOn(hostedHubController, "regenerateRecoveryCodes").mockResolvedValue();

    await mount();
    await expect.element(page.getByText("One-time recovery codes")).toBeVisible();

    expect(regenerate).not.toHaveBeenCalled();
  });

  it("revokes a passkey only after an explicit confirmation", async () => {
    const revoke = vi.spyOn(hostedHubController, "revokePasskey").mockResolvedValue();

    await mount();
    await page.getByRole("button", { name: "Revoke Work laptop" }).click();

    expect(revoke).not.toHaveBeenCalled();
    await expect.element(page.getByText(/will stop working immediately/i)).toBeVisible();

    await page.getByRole("button", { name: "Revoke passkey" }).click();
    expect(revoke).toHaveBeenCalledWith("pkey_aaaaaaaaaaaaaaaaaaaaaa");
  });

  it("reports the revoke while it is running, on the row being revoked", async () => {
    const pending = deferred();
    vi.spyOn(hostedHubController, "revokePasskey").mockImplementation(async () => {
      hostedAccountStore.setState({ actionStatus: "revoking-passkey" });
      await pending.promise;
    });

    await mount();
    await page.getByRole("button", { name: "Revoke Work laptop" }).click();
    await page.getByRole("button", { name: "Revoke passkey" }).click();

    // A destructive action that reports nothing while it runs reads as a dead
    // control, and invites a second press.
    await vi.waitFor(() => {
      const button = page.getByRole("button", { name: "Revoke Work laptop" }).element();
      expect(button.querySelector('[role="status"]'), "the revoke spinner never renders").not.toBe(
        null,
      );
    });

    pending.land();
  });

  /* -------------------------------------------------------- step-up retry */

  it("asks for a TOTP code only after the Hub demands one, then retries with it", async () => {
    const attempts: Array<{ readonly email: string; readonly totpCode?: string }> = [];
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async (input) => {
      attempts.push(input);
      hostedAccountStore.setState({
        errorMessage: input.totpCode === undefined ? STEP_UP_MESSAGE : null,
      });
    });

    await mount();

    // A passkey session must never be shown a code field up front — and the
    // client cannot tell which kind of session it is on, so "up front" means
    // "before the Hub has said so".
    await expect
      .element(page.getByRole("textbox", { name: "Authenticator code" }))
      .not.toBeInTheDocument();

    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();

    await expect.element(page.getByText("Confirm the email change")).toBeVisible();
    expect(attempts).toEqual([{ email: "ada@example.com" }]);

    await page.getByRole("textbox", { name: "Authenticator code" }).fill("123 456");
    await page.getByRole("button", { name: "Confirm code" }).click();

    expect(attempts).toEqual([
      { email: "ada@example.com" },
      { email: "ada@example.com", totpCode: "123456" },
    ]);
    await expect.element(page.getByText("Confirm the email change")).not.toBeInTheDocument();
    await expect.element(page.getByText(/Request accepted by the Hub/i)).toBeVisible();
    // The address has reached the Hub; it does not stay in the field afterwards.
    await expect.element(page.getByRole("textbox", { name: "Email address" })).toHaveValue("");
  });

  it("re-prompts on a rejected code instead of reporting success", async () => {
    const codes: Array<string | undefined> = [];
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async (input) => {
      codes.push(input.totpCode);
      hostedAccountStore.setState({
        errorMessage: input.totpCode === "654321" ? null : STEP_UP_MESSAGE,
      });
    });

    await mount();
    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();
    await expect.element(page.getByText("Confirm the email change")).toBeVisible();

    await page.getByRole("textbox", { name: "Authenticator code" }).fill("111111");
    await page.getByRole("button", { name: "Confirm code" }).click();

    // Still open, and the copy no longer claims to know why it failed.
    await expect.element(page.getByText(/That code was not accepted/i)).toBeVisible();
    await expect.element(page.getByText(/Request accepted by the Hub/i)).not.toBeInTheDocument();

    await page.getByRole("textbox", { name: "Authenticator code" }).fill("654321");
    await page.getByRole("button", { name: "Confirm code" }).click();

    expect(codes).toEqual([undefined, "111111", "654321"]);
    await expect.element(page.getByText(/Request accepted by the Hub/i)).toBeVisible();
  });

  it("never opens a step-up prompt for a session the Hub accepts", async () => {
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async () => {
      hostedAccountStore.setState({ errorMessage: null });
    });

    await mount();
    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();

    await expect.element(page.getByText(/Request accepted by the Hub/i)).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Authenticator code" }))
      .not.toBeInTheDocument();
  });

  it("never turns an ordinary refusal into a step-up prompt", async () => {
    // The step-up gate is one specific refusal. A classifier that fired on any
    // failure would demand an authenticator code for a rejected address — and
    // would then re-send the same doomed request with a code attached.
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async () => {
      hostedAccountStore.setState({ errorMessage: "That address was not accepted." });
    });

    await mount();
    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();

    await expect.element(page.getByText("That address was not accepted.")).toBeVisible();
    await settle();
    await expect
      .element(page.getByRole("textbox", { name: "Authenticator code" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText(/Request accepted by the Hub/i)).not.toBeInTheDocument();
  });

  it("does not offer a step-up out of the passkey-session gate, on an action that has one", async () => {
    // `revoke-totp` is one of the intents whose refusal legitimately *does*
    // become a step-up prompt, so it is the only place the two gates can be
    // confused. An action that never routes through the step-up path could not
    // show a code field whatever the classifier said, and proves nothing.
    vi.spyOn(hostedHubController, "revokeTotp").mockImplementation(async () => {
      hostedAccountStore.setState({ errorMessage: PASSKEY_SESSION_MESSAGE });
    });

    await mount();
    await page.getByRole("button", { name: "Turn off two-factor authentication" }).click();
    await page.getByRole("button", { name: "Remove two-factor" }).click();

    await expect.element(page.getByText("Passkey needed")).toBeVisible();
    await settle();
    await expect
      .element(page.getByRole("textbox", { name: "Authenticator code" }))
      .not.toBeInTheDocument();
  });

  it("presents the passkey-session gate as a passkey prompt rather than a failure", async () => {
    vi.spyOn(hostedHubController, "beginTotpEnrollment").mockImplementation(async () => {
      hostedAccountStore.setState({ errorMessage: PASSKEY_SESSION_MESSAGE });
    });

    await mount();
    await page.getByRole("button", { name: "Set up" }).click();

    await expect.element(page.getByText("Passkey needed")).toBeVisible();
    await expect.element(page.getByText("That did not work")).not.toBeInTheDocument();
  });

  it("lets the user out of a step-up retry the Hub never answers", async () => {
    const pending = deferred();
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async (input) => {
      if (input.totpCode === undefined) {
        hostedAccountStore.setState({ errorMessage: STEP_UP_MESSAGE });
        return;
      }
      hostedAccountStore.setState({ actionStatus: "requesting-email-verification" });
      await pending.promise;
    });
    const abort = vi.spyOn(hostedHubController, "cancelAccountAction").mockImplementation(() => {
      hostedAccountStore.setState({ actionStatus: "idle", errorMessage: null });
      pending.land();
    });

    await mount();
    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();
    await expect.element(page.getByText("Confirm the email change")).toBeVisible();

    await page.getByRole("textbox", { name: "Authenticator code" }).fill("123456");
    await page.getByRole("button", { name: "Confirm code" }).click();
    await expect.element(page.getByText("Confirm the email change")).toBeVisible();

    // Nothing else can end this: submit is disabled while busy, and a modal
    // with no working exit leaves a page reload as the only way out.
    await page.getByRole("button", { name: "Cancel" }).click();

    expect(
      abort,
      "the cancel must abort the operation, not just hide the prompt",
    ).toHaveBeenCalled();
    await expect.element(page.getByText("Confirm the email change")).not.toBeInTheDocument();
    await settle();
    // An aborted operation leaves the store idle with no error — byte for byte
    // what a commit looks like. It must not be reported as one.
    await expect.element(page.getByText(/Request accepted by the Hub/i)).not.toBeInTheDocument();
  });

  it("lets the user out of a set-password the Hub never answers, and keeps nothing", async () => {
    const pending = deferred();
    vi.spyOn(hostedHubController, "setPassword").mockImplementation(async () => {
      hostedAccountStore.setState({ actionStatus: "setting-password" });
      await pending.promise;
    });
    const abort = vi.spyOn(hostedHubController, "cancelAccountAction").mockImplementation(() => {
      hostedAccountStore.setState({ actionStatus: "idle", errorMessage: null });
      pending.land();
    });

    await mount();
    await page.getByRole("button", { name: "Set or change" }).click();
    await page.getByLabelText("New password").fill("correct horse battery staple");
    await page.getByLabelText("Confirm password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Save password" }).click();

    await page.getByRole("button", { name: "Cancel" }).click();

    expect(abort).toHaveBeenCalled();
    await expect.element(page.getByText("Set a fallback password")).not.toBeInTheDocument();

    // Reopening must not hand the abandoned plaintext back.
    await page.getByRole("button", { name: "Set or change" }).click();
    await expect.element(page.getByLabelText("New password")).toHaveValue("");
  });

  /* ------------------------------------------------------- passkey commits */

  it("does not invite a second ceremony when the confirming re-read of a committed passkey fails", async () => {
    // What the runtime leaves behind when the Hub accepted the ceremony and the
    // forced read that confirms it could not reach the Hub: the credential is
    // enrolled, and there is an error on the same slot a refusal would use.
    const add = vi.spyOn(hostedHubController, "addPasskey").mockImplementation(async () => {
      hostedAccountStore.setState({
        passkeysStatus: "stale",
        errorMessage: "The Hub could not be reached.",
      });
    });

    await mount();
    await page.getByRole("button", { name: "Add passkey" }).click();
    await page.getByRole("textbox", { name: "Name (optional)" }).fill("Work laptop");
    await page.getByRole("button", { name: "Create passkey" }).click();

    // Leaving the dialog open with the label intact puts "Create passkey" one
    // press away from a second ceremony and a duplicate credential.
    await expect.element(page.getByText("Add a passkey")).not.toBeInTheDocument();
    await expect.element(page.getByText("The Hub could not be reached.")).toBeVisible();
    expect(add).toHaveBeenCalledOnce();
  });

  it("does not invite a second ceremony when the Hub does not list the passkey it accepted", async () => {
    const add = vi.spyOn(hostedHubController, "addPasskey").mockImplementation(async () => {
      hostedAccountStore.setState({
        passkeysStatus: "ready",
        errorMessage: HOSTED_PASSKEY_UNCONFIRMED_MESSAGE,
      });
    });

    await mount();
    await page.getByRole("button", { name: "Add passkey" }).click();
    await page.getByRole("button", { name: "Create passkey" }).click();

    await expect.element(page.getByText("Add a passkey")).not.toBeInTheDocument();
    await expect.element(page.getByText(HOSTED_PASSKEY_UNCONFIRMED_MESSAGE)).toBeVisible();
    expect(add).toHaveBeenCalledOnce();
  });

  it("keeps the add dialog open when the ceremony itself was refused", async () => {
    vi.spyOn(hostedHubController, "addPasskey").mockImplementation(async () => {
      hostedAccountStore.setState({
        passkeysStatus: "ready",
        errorMessage: "That credential is already registered.",
      });
    });

    await mount();
    await page.getByRole("button", { name: "Add passkey" }).click();
    await page.getByRole("button", { name: "Create passkey" }).click();

    // Nothing was enrolled, so the retry is the right offer to make.
    await expect.element(page.getByText("That credential is already registered.")).toBeVisible();
    await expect.element(page.getByText("Add a passkey")).toBeVisible();
  });

  /* ------------------------------------------------------ secret handling */

  it("shows recovery codes once, with copy, and never writes them to a persisted store", async () => {
    vi.spyOn(hostedHubController, "regenerateRecoveryCodes").mockImplementation(async () => {
      hostedHubStore.setState({ recoveryCodes: [...RECOVERY_CODES] });
      hostedAccountStore.setState({ errorMessage: null });
    });

    await mount();
    await page.getByRole("button", { name: "Generate new codes" }).click();
    await page.getByRole("button", { name: "Replace codes" }).click();

    await expect.element(page.getByText(RECOVERY_CODES[0])).toBeVisible();

    const persisted = await persistedStorageSnapshot();
    for (const code of RECOVERY_CODES) {
      expect(persisted, `recovery code ${code} reached a persisted store`).not.toContain(code);
      expect(window.location.href).not.toContain(code);
    }

    await page.getByRole("button", { name: "Copy codes" }).click();
    expect(clipboard).toEqual([RECOVERY_CODES.join("\n")]);
  });

  it("gives freshly minted recovery codes exactly one exit", async () => {
    vi.spyOn(hostedHubController, "regenerateRecoveryCodes").mockImplementation(async () => {
      hostedHubStore.setState({ recoveryCodes: [...RECOVERY_CODES] });
      hostedAccountStore.setState({ errorMessage: null });
    });

    await mount();
    await page.getByRole("button", { name: "Generate new codes" }).click();
    await page.getByRole("button", { name: "Replace codes" }).click();
    await expect.element(page.getByText(RECOVERY_CODES[0])).toBeVisible();

    // By now the rotation has invalidated every code the user had written down.
    // What is on screen is the only copy of what protects the account, and an
    // accident that clears it leaves the account holding recovery codes its
    // owner does not have.
    await expect.element(page.getByRole("button", { name: "Close" })).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await settle();
    expect(hostedHubStore.getState().recoveryCodes, "Escape destroyed the codes").toEqual([
      ...RECOVERY_CODES,
    ]);
    await expect.element(page.getByText(RECOVERY_CODES[0])).toBeVisible();

    pressBackdrop();
    await settle();
    expect(hostedHubStore.getState().recoveryCodes, "a backdrop press destroyed the codes").toEqual(
      [...RECOVERY_CODES],
    );
    await expect.element(page.getByText(RECOVERY_CODES[0])).toBeVisible();

    // The acknowledgement is the one exit, and it clears the runtime slot
    // rather than merely hiding the display.
    await page.getByRole("button", { name: "I saved the codes" }).click();
    await expect.element(page.getByText(RECOVERY_CODES[0])).not.toBeInTheDocument();
    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
  });

  it("does not let a rotation still in flight put codes back after the surface is gone", async () => {
    const pending = deferred();
    vi.spyOn(hostedHubController, "regenerateRecoveryCodes").mockImplementation(async () => {
      await pending.promise;
      hostedHubStore.setState({ recoveryCodes: [...RECOVERY_CODES] });
      hostedAccountStore.setState({ errorMessage: null });
    });

    await mount();
    await page.getByRole("button", { name: "Generate new codes" }).click();
    await page.getByRole("button", { name: "Replace codes" }).click();

    await teardown();
    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);

    pending.land();
    await settle();

    // The response landed into a slot nobody is rendering. Left there, the
    // hosted root's full-screen takeover would show a secret this surface has
    // already reported as dropped — and the claim that would have kept the root
    // away has been released.
    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
    expect(useRecoveryCodeDisplayStore.getState().claims).toBe(0);
  });

  it("drops both held secrets when the surface goes away", async () => {
    await mount();
    hostedHubStore.setState({
      recoveryCodes: [...RECOVERY_CODES],
      totpEnrollment: { secretBase32: TOTP_SECRET, provisioningUri: TOTP_URI },
    });
    await expect.element(page.getByText(RECOVERY_CODES[0])).toBeVisible();

    await teardown();

    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
    expect(hostedHubStore.getState().totpEnrollment).toBeNull();
    // `innerHTML`, not `textContent`: the enrolment secret is rendered as text
    // *and* encoded into a provisioning URI, and a URI stranded in an attribute
    // is invisible to a textContent assertion.
    const dom = document.body.innerHTML;
    expect(dom).not.toContain(TOTP_SECRET);
    expect(dom).not.toContain("otpauth:");
  });

  it("draws the enrolment QR rather than stranding the provisioning URI in an attribute", async () => {
    await mount();
    hostedHubStore.setState({
      totpEnrollment: { secretBase32: TOTP_SECRET, provisioningUri: TOTP_URI },
    });
    await expect.element(page.getByLabelText("Two-factor setup code")).toBeVisible();

    // An `<img src="otpauth://…">`, or a `data:` URI built from one, would put
    // the account's shared secret in an attribute — where it survives in the
    // DOM, in a copied `outerHTML`, and in anything that reads attributes.
    const qr = document.querySelector('[aria-label="Two-factor setup code"]');
    expect(qr?.tagName.toLowerCase()).toBe("svg");
    expect(qr?.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(qr?.querySelector("img")).toBeNull();

    const attributes = domAttributeSnapshot();
    expect(attributes, "the enrolment secret reached a DOM attribute").not.toContain(TOTP_SECRET);
    expect(attributes, "the provisioning URI reached a DOM attribute").not.toContain("otpauth:");
  });

  it("shows the TOTP enrolment key once and clears it on dismissal", async () => {
    await mount();
    hostedHubStore.setState({
      totpEnrollment: { secretBase32: TOTP_SECRET, provisioningUri: TOTP_URI },
    });

    await expect.element(page.getByLabelText("Two-factor setup key")).toBeVisible();
    await expect.element(page.getByLabelText("Two-factor setup code")).toBeVisible();

    const persisted = await persistedStorageSnapshot();
    expect(persisted).not.toContain(TOTP_SECRET);
    expect(window.location.href).not.toContain(TOTP_SECRET);

    await page.getByRole("button", { name: "Cancel" }).click();

    expect(hostedHubStore.getState().totpEnrollment).toBeNull();
    await expect.element(page.getByLabelText("Two-factor setup key")).not.toBeInTheDocument();
    const dom = document.body.innerHTML;
    expect(dom).not.toContain(TOTP_SECRET);
    expect(dom).not.toContain("otpauth:");
  });

  it("keeps the hosted root's full-screen code takeover out of the way while it is mounted", async () => {
    await mount();
    expect(useRecoveryCodeDisplayStore.getState().claims).toBe(1);
    await teardown();
    expect(useRecoveryCodeDisplayStore.getState().claims).toBe(0);
  });

  /* ------------------------------------------------------------------ copy */

  it("says that email verification currently delivers nothing", async () => {
    await mount();
    await expect.element(page.getByText("No mail will arrive yet")).toBeVisible();
    await expect.element(page.getByText(/no mail transport configured/i)).toBeVisible();
  });

  it("never presents a fallback credential as the equal of a passkey", async () => {
    await mount();
    await expect
      .element(page.getByText(/A password is a fallback, not an equal of a passkey/i))
      .toBeVisible();
    await expect
      .element(page.getByText(/They are a last resort, not a substitute for one/i))
      .toBeVisible();
  });

  it("reports a revoked credential rather than hiding it", async () => {
    hostedAccountStore.setState({
      passkeys: [
        passkey(),
        passkey({
          id: "pkey_bbbbbbbbbbbbbbbbbbbbbb",
          label: "Old phone",
          revokedAt: 1_700_000_900_000,
          revocationReasonCode: "device_lost",
        }),
      ],
      passkeysStatus: "ready",
    });

    await mount();
    await expect.element(page.getByText("Old phone")).toBeVisible();
    await expect.element(page.getByText(/device_lost/)).toBeVisible();
    await expect.element(page.getByText("1 usable passkey")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Revoke Old phone" }))
      .not.toBeInTheDocument();
  });
});
