/** The restart-safe fallback; the selected address itself is never persisted. */
export const PRIVATE_MAILBOX_PRESENTATION = "your email";

/** Password reset stays enumeration-safe even when no account matches the identifier. */
export const PRIVATE_RESET_MAILBOX_PRESENTATION = "your email if the account exists";

export function mailboxCodePrompt(presentation: string): string {
  return `Enter the six-digit code sent to ${presentation}.`;
}

export function passwordResetMailboxPresentation(identifier: string, email: boolean): string {
  return email
    ? `${identifier} if an account exists for that email`
    : `the email linked to ${identifier} if that account exists`;
}
