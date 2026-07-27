# Relay: RPC responses larger than one data frame

**Written at `6bb0a75f4` (2026-07-27).** Browsing a node's filesystem over the Hub relay fails on
any repository large enough. This is not a filesystem feature gap and not a role problem — it is a
framing defect in the hosted relay data plane, and it silently affects every RPC whose response
exceeds 256 KiB.

Nothing here is implemented. This document exists so the fix can be built from evidence rather
than from the first plausible theory, and because the relay data plane has one authoritative owner
who should approve the approach before code lands.

---

## 1. The defect

Both ends enforce a per-frame ceiling and neither end splits a large message.

| Where          | Code                                                       | Behaviour                                                                                                 |
| -------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Node → relay   | `apps/server/src/hubConnector/RelayChannelRegistry.ts:205` | refuses `bytes.byteLength > maxDataChunkBytes`, then closes the channel with `slow_consumer`              |
| Client → relay | `packages/client-runtime/src/relay/relayEngine.ts:194`     | zeroes the payload, fails with `transfer_limit`, throws "RPC payload exceeds the negotiated relay limit." |

The ceiling is schema-capped, so no negotiated value can raise it:
`RELAY_MAX_DATA_CHUNK_BYTES = 256 * 1_024` (`packages/contracts/src/relay.ts:9`).

And the node genuinely produces responses far above it. `WorkspaceEntries.ts:28` caps a listing at
`WORKSPACE_INDEX_MAX_ENTRIES = 25_000` and slices to exactly that with `truncated: true`
(`:396-397`). **The entry cap sits above the byte ceiling, not below it** — at roughly 60–100 bytes
per entry that is ~1.5–2.5 MiB of JSON against a 256 KiB frame.

### Why it reads as "doesn't really work" rather than "always fails"

256 KiB ÷ ~80 bytes ≈ **3,200 entries**. A repository under a few thousand files fits in one frame
and works perfectly over the relay; a larger one kills the channel. That intermittency by
repository size is the signature of this bug, and it is why it has not been read as a framing
problem before.

### Observed at runtime

Driving the real `RelayChannelRegistry` with `RELAY_INITIAL_LIMITS`:

```
size=262144  accepted=true   frames=[data]                         wireBytes=262245  open=true
size=262145  accepted=false  frames=[channel.close(slow_consumer)] wireBytes=108     open=false
```

The ceiling is **262,144 payload bytes inclusive**, CBOR frame overhead is 101 bytes, and one byte
over destroys the channel. The receiver never sees the payload at all — 108 bytes reach the wire,
which is the `channel.close` alone.

**This repository's own file browser already exceeds the limit today.** Measured over its real
file list: 2,968 entries → 340,057 bytes, **1.3× the ceiling**, first breach at ~2,268 entries
(114.6 B/entry). Browsing `node_modules/.bun` via `filesystem.browse` breaches it too — 1,359
directories → 270,032 bytes.

### It is not a filesystem bug

Two different RPCs get called "file listing" and only one is the file browser:

- **`projects.listEntries`** — the file browser. Capped at `WORKSPACE_INDEX_MAX_ENTRIES = 25_000`,
  ~11× above the byte ceiling. 25,000 entries ≈ 2.9 MB. This is the bad one.
- **`filesystem.browse`** — the path picker. Returns directories only
  (`WorkspaceEntries.ts:708` filters on `pointsToDirectory`), so it breaches at ~1,300–4,200
  entries. Real but rarer.
- **`projects.searchEntries`** — safe, and the only one that is:
  `PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200` is genuinely below the ceiling.

Any RPC whose response exceeds 256 KiB has this defect. Framing it as a filesystem problem
understates it.

### The bug in the bug: the close reason is wrong

The registry closes with **`slow_consumer`**, which describes backpressure — a peer that cannot
keep up. The actual condition is an oversized frame, and `transfer_limit` is the stable reason
already used for the _identical_ inbound check at `RelayChannelRegistry.ts:273`, already present
in `RELAY_MINOR_2_CLOSE_REASONS`.

**This mislabel is very likely why the defect was never diagnosed from Hub telemetry.** It reads
as a network problem rather than "the node emitted a frame that is too large". Correcting it is a
one-line, wire-legal observability fix and is the recommended first change — independent of, and
far smaller than, the chunking work.

Two further details worth having right:

- The registry's `send()` **returns `false`**; it does not throw. The throw is one level up at
  `HubConnectorLive.ts:78-79` — `"Relay channel output is full."` — a defect that kills the RPC
  server fiber.
- One RPC response is unconditionally one relay frame:
  `RpcSerialization.json` is `encode: (response) => JSON.stringify(response)` with
  `includesFraming: false`, and `RpcByteSession.ts:55-63` hands the whole encoded response to the
  sink in a single call.

---

## 2. The fix: chunk inside the opaque payload

**No wire-format change. No protocol version bump. No Hub change.**

The earlier proposal was to switch the relay serializer from `RpcSerialization.json` to `ndjson`,
because ndjson buffers partial input across `decode` calls. That is a wire-format change between
node and client, requiring `RELAY_PROTOCOL_MINOR` negotiation, and it has a latent correctness bug:
a multi-byte UTF-8 sequence split across a chunk boundary decodes incorrectly, because each frame
is decoded as text on arrival.

The relay spec makes a much cheaper approach legal. `docs/relay-protocol.md` §"Opaque data
boundary":

> `data.payload` is a CBOR byte string […] The relay routes it using `channelId` and ordering
> metadata but does not parse it as Ryco RPC, events, terminal data, attachments, JSON, text, or
> any other application format.

and, decisively for this design:

> Keeping the payload schema opaque allows later application-level end-to-end encryption without
> changing relay routing.

So an application-level chunk header **inside** `data.payload` is invisible to a conforming relay.
The bytes are reassembled before the RPC decoder ever sees them, so the serializer stays `json`
and the UTF-8 boundary problem cannot arise — the assembler concatenates bytes and decodes once.

### Shape

1. **Shared codec** — new `packages/shared/src/relayMessageChunks.ts`, importable from both
   `apps/server` and `packages/client-runtime` (both already import from `@ryco/shared`).
   Constants beside the existing limits in `packages/contracts/src/relay.ts`.
   - `splitRelayMessage(bytes, maxChunkBytes)` — returns `[bytes]` **unchanged** when it already
     fits, so the common case is byte-identical to today.
   - `RelayMessageAssembler` — `push()` returns done / pending / error, with `heldBytes` exposed
     for flow-control accounting and `reset()` zeroing the buffer.
   - `isChunkedPayload(bytes)` — a chunked payload starts with a `0x00` magic byte; a legacy JSON
     payload always starts `{` or `[`, so old and new senders are distinguishable with no
     negotiation.
2. **Receivers first, senders second.** Deploy reassembly on both ends before either end starts
   splitting. A new receiver understands an old sender (unchunked payloads pass straight through);
   an old receiver never sees a chunk because no sender emits one yet.
3. **Node** — assembler inside `RpcByteSession` (one production caller,
   `HubConnectorLive.ts:74`, relay-only, so the blast radius is contained).
4. **Client** — assembler in `relayEngine.ts`, which both `apps/web` and `apps/mobile` construct,
   so one edit covers both.

### The parts that are easy to get wrong

- **Flow-control accounting.** `queuedBytes` must include `assembler.heldBytes`, or a peer can
  hold megabytes that the backpressure logic cannot see.
- **Grace frames.** `RelayChannelRegistry.ts:276-282` counts _frames_ while paused, on the
  assumption that one message is one frame. Once a message is N frames, that budget has to become
  `ceil(RELAY_MAX_RPC_MESSAGE_BYTES / maxDataChunkBytes) + 1`.
  `RelayChannelRegistry.test.ts:156-186` pins the current behaviour and must be updated.
- **Bounded buffering.** Reject on the _first_ chunk when `totalBytes` exceeds the message ceiling,
  before allocating, so a malicious peer cannot make the receiver buffer unboundedly.
- **A UTF-8 sequence split across a chunk boundary** must round-trip. This is the test that proves
  the approach is better than ndjson, so write it explicitly.

---

## 3. Blast radius

Every consumer of the relay data path is affected by a framing change: RPC, push streams, terminal
streams. The receivers-first rollout is what keeps that safe — at no point does a sender emit a
frame its peer cannot read.

The Hub is **not** in this repository. The design deliberately requires nothing from it, and the
spec quoted in §2 is the basis for that. See §5 for the residual risk.

---

## 4. Scope of the symptom

`projects.listEntries` and `filesystem.browse` are measured and confirmed (§1). Thread and shell
snapshot replays are plausible candidates and have not been measured. The only pagination anywhere
near this RPC group is `ORCHESTRATION_REPLAY_PAGE_MAX_LIMIT = 1_000`, which covers event replay,
not these paths.

## 4.1 Recommended order

1. **Fix the close reason** — `slow_consumer` → `transfer_limit` at
   `RelayChannelRegistry.ts:219`. One line, wire-legal, no behaviour change, and it makes every
   future occurrence diagnosable from telemetry instead of looking like a network problem.
2. **Commit the reproduction** as a regression test.
3. **Then** the chunking work in §2, once §5.2 is answered.

---

## 5. What must be settled before writing code

1. ~~**Observe the failure.**~~ **Settled** — see §1. The failure was reproduced against the real
   `RelayChannelRegistry` with `RELAY_INITIAL_LIMITS`, and the exact ceiling, overhead and close
   behaviour are recorded there. That reproduction should be committed as the regression test
   (`RelayChannelRegistry.test.ts` is the natural home).
2. **Confirm the deployed Hub forwards `data.payload` byte-for-byte.** The spec says a conforming
   relay must not parse it, and the whole no-negotiation design rests on that. The spec is a strong
   normative guarantee, but it is not the same as having read the Hub's forwarding code. If the
   deployed Hub re-encodes, coalesces, or re-chunks payloads, this design needs revisiting — and
   that check has to happen in the private repo.
3. **Choose `RELAY_MAX_RPC_MESSAGE_BYTES`.** 4 MiB is a placeholder bounded above by
   `maxQueuedBytes - maxControlFrameBytes`. Measure real p99 response sizes first.
4. **Decide whether the chunk header carries a message id.** The design assumes all chunks of one
   message are pushed synchronously into the per-channel FIFO, which holds for both current send
   paths but is an invariant no test enforces. Four bytes per chunk would make it robust to a
   future interleaving sender.
