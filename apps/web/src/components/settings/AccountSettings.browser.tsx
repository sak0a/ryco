// Behaviour of the hosted account settings surface, against the real runtime
// stores with only the controller's network-touching actions stubbed.
//
// What is pinned here is not markup. It is the things that would be a security
// defect rather than a cosmetic one:
//
//   * a destructive action never fires before an explicit confirmation;
//   * a TOTP field appears only after the Hub has demanded a step-up — and
//     never for any other refusal — and the retry actually carries the code;
//   * a one-shot secret is not destroyed by a stray Escape, backdrop click, or
//     X, and cannot be resurrected after it has been dropped;
//   * secret material never reaches a persisted store, a DOM attribute, or the
//     URL;
//   * a dismissed or torn-down secret is cleared from the runtime, not merely
//     hidden;
//   * no modal can be entered that only a page reload leaves.
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

import { cdpSession } from "../../../test/browserPointer";
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

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed.")),
      { once: true },
    );
  });
}

async function indexedDbSnapshot(name: string): Promise<string> {
  const db = await requestValue(indexedDB.open(name));
  try {
    const parts: Array<string> = [];
    for (const storeName of Array.from(db.objectStoreNames)) {
      const store = db.transaction(storeName, "readonly").objectStore(storeName);
      // Both requests are issued before either is awaited: a read transaction
      // ends as soon as it goes idle, and an await between them would do that.
      const keys = requestValue(store.getAllKeys());
      const values = requestValue(store.getAll());
      parts.push(storeName, stringify(await keys), stringify(await values));
    }
    return parts.join("\n");
  } finally {
    db.close();
  }
}

/**
 * Everything the browser would still be holding after a reload: both web
 * storages, cookies, and every record in every IndexedDB database. Checking
 * only `localStorage`/`sessionStorage` would miss the two stores a client
 * runtime is most likely to reach for.
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
  for (const info of await indexedDB.databases()) {
    if (info.name === undefined) continue;
    parts.push(info.name, await indexedDbSnapshot(info.name));
  }
  return parts.join("\n");
}

/**
 * Every attribute value in the document.
 *
 * `document.body.textContent` structurally cannot see a secret parked in an
 * attribute — an `<img src="otpauth://…">` QR code is invisible to it — so the
 * enrolment-secret leak checks read this instead. The QR here is inline SVG
 * path data, which is what these assertions exist to keep true.
 */
function domAttributeSnapshot(): string {
  const parts: Array<string> = [];
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      parts.push(`${attribute.name}=${attribute.value}`);
    }
  }
  return parts.join("\n");
}

/**
 * A real mouse press on the page, outside the open dialog.
 *
 * Dispatched through CDP rather than synthesised on a node, so it travels the
 * same outside-press path a user's click does. The coordinate is checked
 * against the popup first: a press that quietly landed *inside* the dialog
 * would make a "this does not dismiss" assertion pass for no reason.
 */
async function pressOutsideDialog(): Promise<void> {
  const popup = document.querySelector<HTMLElement>('[data-slot="dialog-popup"]');
  if (popup === null) throw new Error("Expected an open dialog popup.");
  const rect = popup.getBoundingClientRect();
  const centreX = Math.round(rect.left + rect.width / 2);
  const centreY = Math.round(rect.top + rect.height / 2);
  const candidates: ReadonlyArray<readonly [number, number]> = [
    [centreX, Math.round(rect.top / 2)],
    [centreX, Math.round((rect.bottom + window.innerHeight) / 2)],
    [Math.round(rect.left / 2), centreY],
    [Math.round((rect.right + window.innerWidth) / 2), centreY],
  ];
  const outside = candidates.find(([x, y]) => {
    if (x < 1 || y < 1 || x > window.innerWidth - 1 || y > window.innerHeight - 1) return false;
    const landing = document.elementFromPoint(x, y);
    return landing !== null && landing.closest('[data-slot="dialog-popup"]') === null;
  });
  if (outside === undefined) {
    throw new Error("Found no point outside the dialog popup to press.");
  }
  const [x, y] = outside;
  const session = cdpSession();
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

/** A promise a stub can hold open, to keep an action in flight on demand. */
function deferred(): { readonly promise: Promise<void>; readonly release: () => void } {
  let settle: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, release: () => settle?.() };
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

  it("shows the revoke in progress on the credential it is destroying", async () => {
    const inflight = deferred();
    vi.spyOn(hostedHubController, "revokePasskey").mockImplementation(async () => {
      hostedAccountStore.setState({ actionStatus: "revoking-passkey" });
      await inflight.promise;
      hostedAccountStore.setState({ actionStatus: "idle" });
    });

    await mount();
    await page.getByRole("button", { name: "Revoke Work laptop" }).click();
    await page.getByRole("button", { name: "Revoke passkey" }).click();

    // The confirmation has done its job and closed, but the row still says that
    // something destructive is happening to that credential.
    await expect.element(page.getByLabelText("Loading")).toBeVisible();

    inflight.release();
    await expect.element(page.getByLabelText("Loading")).not.toBeInTheDocument();
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

  it("never turns an unrelated refusal into a step-up prompt", async () => {
    // The discrimination is the point. A surface that offered a code field for
    // any failure would be asking for an authenticator code to fix a rate
    // limit, and would swallow the message that says what actually happened.
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async () => {
      hostedAccountStore.setState({ errorMessage: "Too many requests. Try again in a minute." });
    });

    await mount();
    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();

    await expect.element(page.getByText(/Too many requests/i)).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Authenticator code" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText(/Request accepted by the Hub/i)).not.toBeInTheDocument();
  });

  it("does not offer a step-up out of the passkey-session gate", async () => {
    // Routed through an action that *can* raise a step-up — `revokeTotp` is one
    // of the six intents — so the sentinel is genuinely under test. Asserting
    // this against an action that never consults the classifier at all
    // (`beginTotpEnrollment` is invoked directly, not through `run`) would pass
    // just as happily with the guard deleted.
    const revokeTotp = vi.spyOn(hostedHubController, "revokeTotp").mockImplementation(async () => {
      hostedAccountStore.setState({ errorMessage: PASSKEY_SESSION_MESSAGE });
    });

    await mount();
    await page.getByRole("button", { name: "Turn off two-factor authentication" }).click();
    await page.getByRole("button", { name: "Remove two-factor" }).click();

    expect(revokeTotp).toHaveBeenCalledOnce();
    await expect.element(page.getByText("Passkey needed")).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Authenticator code" }))
      .not.toBeInTheDocument();
  });

  it("lets the user out of a step-up retry that never comes back", async () => {
    const inflight = deferred();
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async (input) => {
      if (input.totpCode === undefined) {
        hostedAccountStore.setState({ errorMessage: STEP_UP_MESSAGE });
        return;
      }
      // A platform sheet the user walks away from: never resolves, never
      // rejects, and the surface stays busy for the life of the session.
      hostedAccountStore.setState({ actionStatus: "requesting-email-verification" });
      await inflight.promise;
    });
    const cancel = vi
      .spyOn(hostedHubController, "cancelAccountAction")
      .mockImplementation(() =>
        hostedAccountStore.setState({ actionStatus: "idle", errorMessage: null }),
      );

    await mount();
    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();
    await expect.element(page.getByText("Confirm the email change")).toBeVisible();

    await page.getByRole("textbox", { name: "Authenticator code" }).fill("123456");
    await page.getByRole("button", { name: "Confirm code" }).click();

    // Busy, and going to stay that way. Cancel must remain usable, and Escape
    // must still reach the dismissal — otherwise only a reload gets out.
    await expect.element(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
    await userEvent.keyboard("{Escape}");

    await expect.element(page.getByText("Confirm the email change")).not.toBeInTheDocument();
    expect(
      cancel,
      "the abandoned action must be aborted, not left holding the surface busy",
    ).toHaveBeenCalled();
    inflight.release();
  });

  it("lets the user out of a password change that never comes back", async () => {
    const inflight = deferred();
    vi.spyOn(hostedHubController, "setPassword").mockImplementation(async () => {
      hostedAccountStore.setState({ actionStatus: "setting-password" });
      await inflight.promise;
    });
    const cancel = vi
      .spyOn(hostedHubController, "cancelAccountAction")
      .mockImplementation(() =>
        hostedAccountStore.setState({ actionStatus: "idle", errorMessage: null }),
      );

    await mount();
    await page.getByRole("button", { name: "Set or change" }).click();
    await page.getByLabelText("New password").fill("correct horse battery staple");
    await page.getByLabelText("Confirm password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Save password" }).click();

    await userEvent.keyboard("{Escape}");

    await expect.element(page.getByLabelText("New password")).not.toBeInTheDocument();
    expect(cancel).toHaveBeenCalled();
    inflight.release();
  });

  it("drops the typed password when a step-up is abandoned", async () => {
    vi.spyOn(hostedHubController, "setPassword").mockImplementation(async (input) => {
      hostedAccountStore.setState({
        errorMessage: input.totpCode === undefined ? STEP_UP_MESSAGE : null,
      });
    });

    await mount();
    await page.getByRole("button", { name: "Set or change" }).click();
    await page.getByLabelText("New password").fill("correct horse battery staple");
    await page.getByLabelText("Confirm password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Save password" }).click();
    await expect.element(page.getByText("Confirm the password change")).toBeVisible();

    // Escape targets the step-up prompt; the password form stays open behind it.
    await userEvent.keyboard("{Escape}");

    await expect.element(page.getByText("Confirm the password change")).not.toBeInTheDocument();
    await expect.element(page.getByLabelText("New password")).toHaveValue("");
    await expect.element(page.getByLabelText("Confirm password")).toHaveValue("");
  });

  /* --------------------------------------------------------- passkey adds */

  it("does not invite a second ceremony when only the confirming re-read failed", async () => {
    // `addPasskey` publishes its error *after* it commits: the credential is
    // enrolled and the forced re-read that would prove it failed. Leaving the
    // form open with the label in it makes the obvious next click a second
    // ceremony, and a second credential.
    const addPasskey = vi.spyOn(hostedHubController, "addPasskey").mockImplementation(async () => {
      hostedAccountStore.setState({
        passkeysStatus: "stale",
        errorMessage: "The Hub could not be reached.",
      });
    });

    await mount();
    await page.getByRole("button", { name: "Add passkey" }).click();
    await page.getByLabelText("Name (optional)").fill("Work laptop");
    await page.getByRole("button", { name: "Create passkey" }).click();

    await expect.element(page.getByText("The Hub could not be reached.")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Create passkey" }))
      .not.toBeInTheDocument();
    expect(addPasskey).toHaveBeenCalledOnce();

    // Reopening starts from a blank form rather than a primed resubmit.
    await page.getByRole("button", { name: "Add passkey" }).click();
    await expect.element(page.getByLabelText("Name (optional)")).toHaveValue("");
    expect(addPasskey).toHaveBeenCalledOnce();
  });

  it("does not invite a second ceremony when the enrolment could not be confirmed", async () => {
    const addPasskey = vi.spyOn(hostedHubController, "addPasskey").mockImplementation(async () => {
      // The read succeeded and did not show the credential. The runtime says so
      // rather than claiming the ceremony failed, and neither may this surface.
      hostedAccountStore.setState({
        passkeysStatus: "ready",
        errorMessage: HOSTED_PASSKEY_UNCONFIRMED_MESSAGE,
      });
    });

    await mount();
    await page.getByRole("button", { name: "Add passkey" }).click();
    await page.getByLabelText("Name (optional)").fill("Work laptop");
    await page.getByRole("button", { name: "Create passkey" }).click();

    await expect.element(page.getByText(HOSTED_PASSKEY_UNCONFIRMED_MESSAGE)).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Create passkey" }))
      .not.toBeInTheDocument();
    expect(addPasskey).toHaveBeenCalledOnce();
  });

  it("keeps the add form open when nothing was enrolled", async () => {
    // The complement of the two above: a refusal that reached the surface
    // before anything committed leaves the form where it was, with the label
    // the user typed, because retrying is the right move here.
    vi.spyOn(hostedHubController, "addPasskey").mockImplementation(async () => {
      hostedAccountStore.setState({
        passkeysStatus: "ready",
        errorMessage: "That credential is already registered.",
      });
    });

    await mount();
    await page.getByRole("button", { name: "Add passkey" }).click();
    await page.getByLabelText("Name (optional)").fill("Work laptop");
    await page.getByRole("button", { name: "Create passkey" }).click();

    await expect.element(page.getByRole("button", { name: "Create passkey" })).toBeVisible();
    await expect.element(page.getByLabelText("Name (optional)")).toHaveValue("Work laptop");
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
    const attributes = domAttributeSnapshot();
    for (const code of RECOVERY_CODES) {
      expect(persisted, `recovery code ${code} reached a persisted store`).not.toContain(code);
      expect(attributes, `recovery code ${code} reached a DOM attribute`).not.toContain(code);
      expect(window.location.href).not.toContain(code);
    }

    await page.getByRole("button", { name: "Copy codes" }).click();
    expect(clipboard).toEqual([RECOVERY_CODES.join("\n")]);
  });

  it("clears freshly minted recovery codes only on the explicit acknowledgement", async () => {
    vi.spyOn(hostedHubController, "regenerateRecoveryCodes").mockImplementation(async () => {
      hostedHubStore.setState({ recoveryCodes: [...RECOVERY_CODES] });
      hostedAccountStore.setState({ errorMessage: null });
    });

    await mount();

    // Control. The same three dismissals do close an ordinary dialog on this
    // surface, so what follows is a statement about the recovery-code display
    // rather than about a test that cannot dismiss anything.
    const enrollment = { secretBase32: TOTP_SECRET, provisioningUri: TOTP_URI };
    hostedHubStore.setState({ totpEnrollment: enrollment });
    await expect.element(page.getByLabelText("Two-factor setup key")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Close" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByLabelText("Two-factor setup key")).not.toBeInTheDocument();

    hostedHubStore.setState({ totpEnrollment: enrollment });
    await expect.element(page.getByLabelText("Two-factor setup key")).toBeVisible();
    await pressOutsideDialog();
    await expect.element(page.getByLabelText("Two-factor setup key")).not.toBeInTheDocument();

    // Subject. By the time these render the Hub has already invalidated every
    // code the user had saved, so an accidental exit destroys the only copy of
    // the replacement and leaves the account holding codes nobody has.
    await page.getByRole("button", { name: "Generate new codes" }).click();
    await page.getByRole("button", { name: "Replace codes" }).click();
    await expect.element(page.getByText(RECOVERY_CODES[0])).toBeVisible();

    await expect.element(page.getByRole("button", { name: "Close" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await pressOutsideDialog();

    await expect.element(page.getByText(RECOVERY_CODES[0])).toBeVisible();
    expect(hostedHubStore.getState().recoveryCodes).toEqual([...RECOVERY_CODES]);

    // One exit, and it drops the codes from the runtime rather than hiding them.
    await page.getByRole("button", { name: "I saved the codes" }).click();

    await expect.element(page.getByText(RECOVERY_CODES[0])).not.toBeInTheDocument();
    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
  });

  it("does not let a rotation that lands after teardown resurrect the codes", async () => {
    const inflight = deferred();
    const regenerate = vi
      .spyOn(hostedHubController, "regenerateRecoveryCodes")
      .mockImplementation(async () => {
        hostedAccountStore.setState({ actionStatus: "regenerating-recovery-codes" });
        await inflight.promise;
        // The response lands after the surface has gone: the runtime publishes
        // the new set into the slot teardown has already emptied.
        hostedHubStore.setState({ recoveryCodes: [...RECOVERY_CODES] });
        hostedAccountStore.setState({ actionStatus: "idle", errorMessage: null });
      });

    await mount();
    await page.getByRole("button", { name: "Generate new codes" }).click();
    await page.getByRole("button", { name: "Replace codes" }).click();
    expect(regenerate).toHaveBeenCalledOnce();

    await teardown();
    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
    // The display claim is gone, so nothing here would hold the hosted root's
    // full-screen takeover back if the codes came back.
    expect(useRecoveryCodeDisplayStore.getState().claims).toBe(0);

    inflight.release();
    await (regenerate.mock.results[0]?.value as Promise<void>);
    await Promise.resolve();

    expect(
      hostedHubStore.getState().recoveryCodes,
      "a dismissed secret was written back to the runtime slot",
    ).toEqual([]);
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
    // The whole serialised document, attributes included — text alone would
    // miss a secret parked in one.
    const serialized = document.documentElement.outerHTML;
    expect(serialized).not.toContain(TOTP_SECRET);
    expect(serialized).not.toContain("otpauth:");
    for (const code of RECOVERY_CODES) expect(serialized).not.toContain(code);
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

    // The QR carries the provisioning URI — secret and all — and is the one
    // place it could reach an attribute. It is drawn as inline SVG path data,
    // so no attribute, and therefore no request, ever carries it.
    const attributes = domAttributeSnapshot();
    expect(attributes, "the provisioning URI reached a DOM attribute").not.toContain(TOTP_SECRET);
    expect(attributes).not.toContain("otpauth:");

    await page.getByRole("button", { name: "Cancel" }).click();

    expect(hostedHubStore.getState().totpEnrollment).toBeNull();
    await expect.element(page.getByLabelText("Two-factor setup key")).not.toBeInTheDocument();
    expect(document.documentElement.outerHTML).not.toContain(TOTP_SECRET);
  });

  it("clears the address once the Hub has accepted it", async () => {
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async () => {
      hostedAccountStore.setState({ errorMessage: null });
    });

    await mount();
    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();

    await expect.element(page.getByText(/Request accepted by the Hub/i)).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Email address" })).toHaveValue("");
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
