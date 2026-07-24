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

export {};
