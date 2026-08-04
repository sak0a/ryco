// Through `./connectionStatus`, not straight from the runtime: that module is
// this tier's status boundary and narrows the §4.4 channel dimension to the
// states a web client can be in (docs/relay-e2ee-protocol.md §2.2, §2.4). A
// second bare re-export beside it would be a gate next to the fence.
export * from "./connectionStatus";
