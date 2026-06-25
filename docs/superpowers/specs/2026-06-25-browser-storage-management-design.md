# In-App Browser Storage Management Design

## Goal

Make the desktop-local in-app browser's isolated profile data manageable from the UI without weakening the BrowserHost isolation model. Users should be able to inspect safe metadata for cookies and active-origin storage, delete individual cookies, and clear current-origin or whole-profile data.

## Scope

- Add BrowserService RPCs for storage inspection, clearing, and cookie deletion.
- Route all storage operations through the server-owned BrowserService and dedicated BrowserHost channel.
- Implement Electron-hosted behavior in the desktop BrowserKernel using isolated `session` APIs and current-page JavaScript for active-origin web storage metadata.
- Add a compact BrowserPanel storage inspector that resizes the native browser surface rather than overlaying it.
- Keep remote/browser-only clients unsupported for this MVP.

## Data Exposure

- Cookie inspection returns metadata only: name, domain, path, expiry, session flag, size estimate, and security flags.
- Cookie values are not returned.
- Local/session storage inspection returns key names and approximate value sizes for the active origin only.
- Cache entries are not listed. The UI can clear HTTP cache and origin storage, but Electron does not provide a reliable cache-entry inspection API suitable for this MVP.

## Actions

- Refresh storage metadata.
- Delete an individual cookie.
- Clear current-origin cookies.
- Clear current-origin localStorage/sessionStorage/IndexedDB/CacheStorage/service workers where supported.
- Clear all cookies for the isolated browser profile.
- Clear all storage/cache for the isolated browser profile.

Whole-profile destructive actions require explicit confirmation in the UI.

## Security And Reliability Notes

- Browser storage RPCs require the same desktop-local BrowserService support gate as navigation.
- The web app never calls Electron session APIs directly.
- The host validates session and tab ownership before reading or clearing data.
- Unsupported providers continue to report browser tool injection as unsupported; storage controls are a user UI surface only.
