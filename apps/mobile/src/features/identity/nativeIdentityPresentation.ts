/** The restart-safe fallback; the selected address itself is never persisted. */
export const PRIVATE_MAILBOX_PRESENTATION = "your email";

export function mailboxCodePrompt(presentation: string): string {
  return `Enter the six-digit code sent to ${presentation}.`;
}
