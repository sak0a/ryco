/** Single-flight refresh with a lifetime bound to one diagnostics target. */
export function createDiagnosticsRefresh<T>(options: {
  readonly fetch: () => Promise<T>;
  readonly onSuccess: (value: T) => void;
  readonly onError: (error: unknown) => void;
  readonly onLoading: (loading: boolean) => void;
}) {
  let disposed = false;
  let pending = false;
  return {
    async refresh() {
      if (disposed || pending) return;
      pending = true;
      options.onLoading(true);
      try {
        const value = await options.fetch();
        if (!disposed) options.onSuccess(value);
      } catch (error) {
        if (!disposed) options.onError(error);
      } finally {
        pending = false;
        if (!disposed) options.onLoading(false);
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
