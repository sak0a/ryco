function detailFromObject(error: object): string | null {
  if (!("detail" in error) || typeof error.detail !== "string") {
    return null;
  }
  const detail = error.detail.trim();
  return detail.length > 0 ? detail : null;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) return message;
    const detail = detailFromObject(error);
    if (detail) return detail;
  }

  if (typeof error === "object" && error !== null) {
    const detail = detailFromObject(error);
    if (detail) return detail;
  }

  if (typeof error === "string") {
    const message = error.trim();
    if (message.length > 0) return message;
  }

  return fallback;
}
