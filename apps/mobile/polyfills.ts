// Hermes (React Native's JS engine) does not yet provide the explicit-resource-
// management well-known symbols (`Symbol.dispose` / `Symbol.asyncDispose`) that
// the Effect runtime uses when it constructs scopes/layers. Without them, the
// first Effect runtime construction throws "undefined is not a function". Define
// them (guarded) before any Effect code loads. Must be imported first in the app
// entry, before `./src/App`.
const globalSymbol = Symbol as unknown as {
  dispose?: symbol;
  asyncDispose?: symbol;
};

if (typeof globalSymbol.dispose !== "symbol") {
  globalSymbol.dispose = Symbol.for("Symbol.dispose");
}
if (typeof globalSymbol.asyncDispose !== "symbol") {
  globalSymbol.asyncDispose = Symbol.for("Symbol.asyncDispose");
}

type ArrayCompatibilityPrototype = {
  toSorted?: (
    this: ReadonlyArray<unknown>,
    compareFn?: (left: unknown, right: unknown) => number,
  ) => Array<unknown>;
  toReversed?: (this: ReadonlyArray<unknown>) => Array<unknown>;
};

/**
 * Install the change-array-by-copy methods used by the mobile app and shared
 * client runtime. `index.ts` imports this module before the application graph.
 * The supported Hermes development client does not expose these ES2023 methods
 * yet. Without them, the first populated project/thread snapshot fails during
 * render with `undefined is not a function`.
 */
export function installArrayCompatibilityPolyfills(prototype: ArrayCompatibilityPrototype): void {
  if (typeof prototype.toSorted !== "function") {
    Object.defineProperty(prototype, "toSorted", {
      configurable: true,
      enumerable: false,
      writable: true,
      value(
        this: ReadonlyArray<unknown>,
        compareFn?: (left: unknown, right: unknown) => number,
      ): Array<unknown> {
        // eslint-disable-next-line unicorn/no-array-sort -- This is the toSorted compatibility implementation.
        return Array.from(this).sort(compareFn);
      },
    });
  }

  if (typeof prototype.toReversed !== "function") {
    Object.defineProperty(prototype, "toReversed", {
      configurable: true,
      enumerable: false,
      writable: true,
      value(this: ReadonlyArray<unknown>): Array<unknown> {
        // eslint-disable-next-line unicorn/no-array-reverse -- This is the toReversed compatibility implementation.
        return Array.from(this).reverse();
      },
    });
  }
}

installArrayCompatibilityPolyfills(Array.prototype);
