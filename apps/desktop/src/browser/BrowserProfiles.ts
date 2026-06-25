import * as FS from "node:fs";
import * as Path from "node:path";

import { app, session as electronSession } from "electron";
import type { Session } from "electron";
import type { BrowserProfile } from "@ryco/contracts";
import { sanitizeBrowserProfileKey } from "@ryco/shared/browser";

export class BrowserProfiles {
  private readonly sessionsByProfile = new Map<string, Session>();

  resolve(profile: BrowserProfile): Session {
    const existing = this.sessionsByProfile.get(profile.profileId);
    if (existing) return existing;

    const browserSession = profile.persistent
      ? this.resolvePersistentSession(profile)
      : electronSession.fromPartition(`ryco-browser-temp:${profile.profileId}:${Date.now()}`);

    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    this.sessionsByProfile.set(profile.profileId, browserSession);
    return browserSession;
  }

  async cleanupTemporary(profile: BrowserProfile): Promise<void> {
    if (profile.persistent) return;
    const browserSession = this.sessionsByProfile.get(profile.profileId);
    this.sessionsByProfile.delete(profile.profileId);
    await browserSession?.clearStorageData().catch(() => undefined);
  }

  private resolvePersistentSession(profile: BrowserProfile): Session {
    const profilePath = Path.join(
      app.getPath("userData"),
      "browser-profiles",
      sanitizeBrowserProfileKey(profile.profileId),
    );
    FS.mkdirSync(profilePath, { recursive: true, mode: 0o700 });
    return electronSession.fromPath(profilePath);
  }
}
