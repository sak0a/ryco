// Mobile binding of the shared Agent Control state surface, matching the
// threadsRuntime module's role. The domain needs no platform configurator;
// screens import queue state, selectors, and the sync starter from here so
// no mobile policy or transport fork exists.
export * from "@ryco/client-runtime/state/agentControl";
