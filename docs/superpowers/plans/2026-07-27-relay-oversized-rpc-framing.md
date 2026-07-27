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

**Status of this claim: PROVED from constants and code paths, NOT yet observed at runtime.** See §5.

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

`projects.listEntries` and the filesystem browse are the two confirmed oversized responses.
Thread and shell snapshot replays are plausible candidates and have not been measured. If more
methods breach 256 KiB, this stops being "the filesystem doesn't work over relay" and becomes a
general relay defect, which raises its priority.

---

## 5. What must be settled before writing code

1. **Observe the failure.** Everything above is derived from constants and code paths. The
   cheapest decisive reproduction is a unit test driving an oversized buffer through
   `RelayChannelRegistry` / `relayEngine` — both already have test files
   (`RelayChannelRegistry.test.ts`, `relayEngine.test.ts`). Do this first; it is also the
   regression test.
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
