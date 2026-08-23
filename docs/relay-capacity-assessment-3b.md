# Wave 3b relay capacity assessment

- Date: 2026-08-21
- Assessment revision: `e4c4d214f`
- Scope: the proposed Wave 3b bound of two or three concurrent hosted connections per client

## Verdict

**The Wave 3b bound fits the documented relay budgets, with conditions.** A hosted environment
adds one relay client connection and one channel. It does not add a node connection: each online
node already owns one outbound relay connection and multiplexes up to eight channels over it.
Two or three idle hosted connections reserve no 8 MiB queues merely by existing, use at most 0.59%
of the 512 client-connection/channel limit per client, and consume 10% or 15% of the 20-token
upgrade burst bucket for that client's external peer address.

The capacity gate is discharged for a named bound of **three** only if Wave 3b keeps the mitigations
in its plan:

1. scope leases land before the bound is raised;
2. only mounted work acquires a connection, and unretained connections are released in background;
3. foreground reconnects are staggered rather than all attempted at once;
4. the five-node fixture asserts the bound and release behavior; and
5. connection acquisition never starts unrelated high-volume work.

This is not a claim that every combination of 512 admitted channels can simultaneously hold its
per-connection hard queue maximum. The 256 MiB process budget is deliberately smaller than the sum
of all possible 8 MiB connection maxima. It applies backpressure and closes a slow consumer before
that sum is reached. Fully saturated bidirectional queues cease to fit at 17 channels when every
channel targets a different node, or at 29 channels when channels are packed eight per node. That
is a slow-consumer saturation boundary, not an idle-connection boundary.

The residual risk is synchronized reconnect churn from several clients behind one NAT, plus real
traffic on the retained channels. The hosted screenshot fallback is the concrete traffic risk in
the next public pin: measured local PNGs would consume the 50 MiB per-channel transfer budget in
about 18 phone frames or 10 tablet frames. It is substantially heavier than Wave 3b's idle
connection cost and needs its own transfer-budget/product treatment; it does not justify keeping
3b gated on an unrelated production recovery drill.

## Inputs and accounting model

The Hub defaults assessed here are:

| Budget                          |                           Default | What Wave 3b consumes                                                  |
| ------------------------------- | --------------------------------: | ---------------------------------------------------------------------- |
| Relay upgrade burst             | 20 tokens, refilling at 1 token/s | one token per WebSocket upgrade                                        |
| Client connections              |                               512 | one per active hosted environment                                      |
| Node connections                |                               256 | no incremental connection; the enrolled node connection already exists |
| Global channels                 |                               512 | one per active hosted environment                                      |
| Channels per node               |                                 8 | one on each target node                                                |
| Per-connection queue hard limit |                             8 MiB | actual queued/native-buffered bytes, not a reservation                 |
| Aggregate queue budget          |                           256 MiB | actual queued/native-buffered bytes across the process                 |
| Per-channel transfer budget     |                            50 MiB | data-payload bytes in both directions for the channel lifetime         |

The upgrade bucket is keyed by the socket peer address. It is therefore **per external peer**, not
one global 20-token bucket. Clients on separate networks do not compete for it; clients behind one
NAT do. Existing upgrades or reconnecting nodes behind that same address consume some of the burst
headroom.

Let:

- `P` be the number of simultaneously foregrounded clients behind one external peer address;
- `C` be the bound per client, either 2 or 3;
- `A = P × C` be active client connections and channels; and
- `M` be the number of distinct target nodes.

Then Wave 3b's direct cost is:

```text
upgrade burst                         = P × C tokens per peer address
client connections and channels       = A = P × C
incremental node connections           = 0
maximum bidirectional hard-queue sum   = 8 MiB × (A + M)
```

The last line is an adversarial ceiling in which every client-side destination queue and every
target-node destination queue is simultaneously at its hard maximum. It is not memory reserved by
the connections. Since one node admits at most eight channels and one client does not connect to
the same node twice, the most tightly packed topology has
`M = max(C, ceil(A / 8))`. The most dispersed topology has `M = A`.

## Per-client cost

| Bound | Upgrade burst |  Client slots | Global channels | Fully queued ceiling across distinct target nodes |
| ----: | ------------: | ------------: | --------------: | ------------------------------------------------: |
|     2 |    2/20 = 10% | 2/512 = 0.39% |   2/512 = 0.39% |          `8 MiB × (2 clients + 2 nodes) = 32 MiB` |
|     3 |    3/20 = 15% | 3/512 = 0.59% |   3/512 = 0.59% |          `8 MiB × (3 clients + 3 nodes) = 48 MiB` |

At idle, the queue term is approximately zero. Queue ownership is acquired only when a frame is
enqueued and is released after native buffering drains or the connection closes.

## Plausible private-alpha populations

Five testers is a plausible early cohort. Eight is the useful upper scenario because eight
simultaneous channels to one node is itself the documented per-node limit. Ten shows the first
meaningful burst/queue boundary. The queue column assumes channels are packed onto the fewest nodes
allowed by the eight-channel per-node limit; the dispersed case is addressed below.

| Clients `P` | Bound `C` | Active channels `A` | One-peer burst | Global channel use | Minimum nodes `M` | All queues at hard max |
| ----------: | --------: | ------------------: | -------------: | -----------------: | ----------------: | ---------------------: |
|           5 |         2 |                  10 |    10/20 = 50% |     10/512 = 1.95% |                 2 |         96 MiB = 37.5% |
|           5 |         3 |                  15 |    15/20 = 75% |     15/512 = 2.93% |                 3 |       144 MiB = 56.25% |
|           8 |         2 |                  16 |    16/20 = 80% |     16/512 = 3.13% |                 2 |       144 MiB = 56.25% |
|           8 |         3 |                  24 |   24/20 = 120% |     24/512 = 4.69% |                 3 |       216 MiB = 84.38% |
|          10 |         2 |                  20 |   20/20 = 100% |     20/512 = 3.91% |                 3 |       184 MiB = 71.88% |
|          10 |         3 |                  30 |   30/20 = 150% |     30/512 = 5.86% |                 4 |      272 MiB = 106.25% |

The one-peer burst column is intentionally pessimistic: every client shares one NAT, starts from a
full bucket, and upgrades at the same instant. With separate peer addresses, each client consumes
only 2 or 3 of its own 20 tokens. When one peer does exceed the bucket, the earliest possible tail
is one additional upgrade per second: a 24-upgrade burst needs at least four seconds for the last
four tokens, and a 30-upgrade burst needs at least ten seconds. Wave 3b already requires staggered
foreground wake-up; that requirement is what keeps this boundary from becoming a reconnect storm.

The exact stop points are:

- per peer address, 10 clients at a bound of 2 fill the burst bucket and client 11 exceeds it;
  6 clients at a bound of 3 use 18 tokens and client 7 reaches 21 and exceeds it;
- the ninth simultaneous channel to one node exceeds the per-node channel limit;
- globally, 256 clients at a bound of 2 fill 512 client/channel slots; at a bound of 3, 170 clients
  use 510 and client 171 reaches 513;
- with every destination queue simultaneously at 8 MiB and nodes packed as tightly as allowed,
  14 two-connection clients reach exactly 256 MiB and client 15 exceeds it; 9 three-connection
  clients reach 248 MiB and client 10 exceeds it; and
- with one distinct target node per channel, 16 channels reach exactly 256 MiB, so the 17th ceases
  to fit. That is 8 two-connection clients versus 9, or 5 three-connection clients versus 6.

The queue stop points do not mean the corresponding connection should be rejected at admission.
The process does not pre-reserve 8 MiB per connection. They mean that a simultaneous, bidirectional,
all-slow-consumer scenario cannot grant every connection its local maximum; the process-wide
reservation fails closed first, as designed. These arithmetic boundaries assume no unrelated queue
ownership, so real headroom is smaller whenever other relay traffic is already buffered.

## What scope leases change

Without leases, a naive multi-connect implementation can retain `P × C` connections until process
exit, including nodes with no mounted consumer. Scope leases do not lower Wave 3b's hard foreground
maximum by themselves: the plan defines lifetime as retained scopes **plus LRU recency**, still
bounded by `C`. A warmed foreground client may therefore keep all `C` slots in both designs.

What leases change is the non-evictable set and the background/reconnect floor. After background
release removes non-retained LRU entries, the live count is:

```text
post-release connections = sum over clients(min(C, distinct environments with retained scopes))
```

For eight clients that have each touched the full bound, then background with one retained
environment each:

| State                                       |  Bound 2 |  Bound 3 |
| ------------------------------------------- | -------: | -------: |
| Warm foreground maximum, leased or unleased |       16 |       24 |
| Naive unleased background/reconnect set     |       16 |       24 |
| Leased post-release retained set            |        8 |        8 |
| Background/reconnect reduction              |      50% |    66.7% |
| One-peer reconnect burst after release      | 8 tokens | 8 tokens |

At the bound of 3, background release plus leases turn the eight-client shared-NAT reconnect case
from an over-capacity 24-upgrade burst into an 8-upgrade burst. If there is no retained mounted
scope after backgrounding, the retained contribution is zero. Foregrounding must reconnect only
the retained set and stagger those attempts; reconnecting the LRU/catalog eagerly would erase the
mitigation. While foregrounded, LRU recency may fill the remaining slots again as the user opens
work, but it does so on demand rather than as one synchronized wake-up.

Wave 3b's mobile scopes do not own the web simulator preview, so leases do not reduce the existing
web screenshot fallback and must not be counted as if they did. The general invariant is still
important: merely retaining a cached environment connection must not start unrelated high-volume
work. The web fallback's mounted-panel lifecycle needs separate review with the pin.

## Measured staging observation

The existing chunk performance scripts are not network harnesses. They intentionally measure only
`prepareRelayMessage` plus `RelayMessageAssembler` in one process; they open no socket and cannot
observe connection counts, upgrade buckets, Hub queue bytes, file descriptors, RSS, or event-loop
delay. Extending their output to claim any of those would violate the scripts' stated scope.

A bounded staging observation used two already-running, enrolled local QA nodes and ordinary hosted
client connections. No production endpoint or configuration was touched.

1. Before a client opened a node, each local connector reported `activeChannels: 0` and
   `queuedBytes: 56` while retaining exactly one established outbound TLS socket.
2. One hosted client produced `activeChannels: 1` and `queuedBytes: 121` on its target node. The
   other node remained at zero channels; neither node gained another TLS socket.
3. Two visible hosted clients targeting the two nodes concurrently produced one active channel on
   each node. Three samples over 22 seconds held both at one channel; the reported outbound queues
   stayed between 56 and 121 bytes.
4. Hiding the first client released its channel. This is consistent with the lifecycle behavior
   Wave 3b's scope leases are meant to preserve.

The repeatable read-only observation seam is the bounded local status command:

```sh
node apps/server/dist/bin.mjs hub status \
  --base-dir <qa-node-base-dir> \
  --dev-url <qa-dev-url> \
  --json
```

Expected shape while one hosted client is open:

```json
{
  "state": "online",
  "protocolMajor": 1,
  "protocolMinor": 2,
  "activeChannels": 1,
  "queuedBytes": 121
}
```

The exact small queue value varies with heartbeat/control timing. This status is the node
connector's bounded local observation, not the Hub process queue metric. The staging Hub's
aggregate queue, RSS, file descriptors, event-loop delay, and client-side queue could not be
determined without authenticated aggregate metrics; no metrics credential was opened or read for
this assessment.

## Hosted screenshot fallback

The next public pin includes a hosted simulator fallback that requests a full PNG, returned as a
base64 JSON field, and schedules the next request 750 ms **after the previous request completes**.
The theoretical upper sampling rate is therefore 1.333 frames/s; real throughput is lower by the
capture, RPC, relay, decode, and paint latency.

Five direct local captures of each already-booted QA simulator produced identical sizes for their
static screens:

| Device class      | PNG bytes | Base64 bytes | Relay chunks (minimum) | Chunk payload bytes (minimum) | Share of one 8 MiB queue | Max rate at 750 ms |
| ----------------- | --------: | -----------: | ---------------------: | ----------------------------: | -----------------------: | -----------------: |
| Phone, 1206×2622  | 2,289,823 |    3,053,100 |                     12 |                     3,053,196 |                   36.40% |         3.88 MiB/s |
| Tablet, 1668×2420 | 4,177,412 |    5,569,884 |                     22 |                     5,570,060 |                   66.40% |         7.08 MiB/s |

The chunk calculation uses the real 256 KiB data-chunk maximum and 8-byte chunk header. It is a
lower bound because it includes the base64 field but excludes the rest of the JSON RPC response,
outer relay-frame encoding, WebSocket reserve, request traffic, and (when negotiated) the 32-byte
E2EE record overhead.

The 50 MiB transfer limit counts data payloads in both directions. Ignoring the smaller request
direction and all omitted overhead gives the most favorable possible result:

```text
phone:  52,428,800 / 3,053,196 = 17 complete frames; frame 18 exceeds the budget
tablet: 52,428,800 / 5,570,060 =  9 complete frames; frame 10 exceeds the budget
```

At the theoretical 750 ms upper rate, those payloads consume 50 MiB in 12.88 seconds and 7.06
seconds respectively. Actual closure takes longer because the timer starts after each request, but
the number of frames does not improve; JSON/request/E2EE overhead makes it slightly worse. A healthy
consumer therefore reaches `transfer_limit` after seconds to tens of seconds, without any slow
consumer or queue saturation.

One in-flight measured tablet response is about 2.08% of the 256 MiB aggregate queue budget if it
has to queue in full; one phone response is about 1.14%. Those are much larger than the observed
tens of idle control bytes. The screenshot path is therefore the more important sustained-load
finding in the next pin. It needs a separate decision such as a lossy/binary stream, a lower or
adaptive cadence, delta frames, or an explicitly bounded preview session. Raising the transfer
budget alone would not address bandwidth or slow-consumer pressure.

## Capacity gate for implementation and review

Wave 3b may be built and reviewed against this gate:

- define the maximum as a named constant no greater than 3;
- land and test scope leases before raising the maximum;
- acquire only on a user opening work in an environment;
- release non-retained connections on background and do not eagerly reacquire the catalog;
- stagger reconnects so one peer address does not issue more than 20 upgrades in a burst;
- assert at most 3 active hosted connections under a five-node fixture;
- assert acquiring or retaining a connection does not start unrelated high-volume work; and
- record connection count, active scopes, reconnect attempts, and aggregate queue metrics during
  staging QA without payloads or high-cardinality identifiers.

Passing those checks discharges the concurrency risk that was previously represented by the Hub
rollout-drill gate. Production recovery qualification remains valuable for release operations, but
it measures a different risk and is not a prerequisite for the bounded client-side change.

## Wave 4 hosted-Web qualification

Hosted Web deliberately starts below the native ceiling. Its named maximum is one because the
browser can add a sustained full-PNG preview to the ordinary thread, VCS, and provider streams.
The adaptive sampler uses the measured base64 payload, schedules only after completion, retains the
750 ms floor, and suspends when either the document or preview is hidden.

For the measured 3,053,100-byte phone frame, the deterministic qualification calculation is:

| Retained environments | Active Web connections | Queued demand | Effective PNG interval | Screenshot bytes/s per visible stream | Counterfactual unbounded aggregate |
| --------------------: | ---------------------: | ------------: | ---------------------: | ------------------------------------: | ---------------------------------: |
|                     1 |                      1 |             0 |               5,824 ms |                               524,228 |                            524,228 |
|                     2 |                      1 |             1 |               5,824 ms |                               524,228 |                          1,048,456 |
|                     3 |                      1 |             2 |               5,824 ms |                               524,228 |                          1,572,684 |

The two- and three-stream aggregates are counterfactual load calculations, not approved Web
bounds: the platform ceiling prevents them. Thread/VCS/provider payload rates were not available
from a public aggregate metric, so they are not silently treated as zero. An unleased catalog
starts zero relay streams and zero connections; mounted thread detail, VCS, and provider scopes
are refcounted and are the only inputs that can acquire an environment. Under the five-node fixture
one environment connects and four wait. Backgrounding releases non-retained LRU connections;
foregrounding restores only retained demand, so the one-connection Web bound produces at most one
reconnect attempt and cannot form a reconnect storm. Raising the bound requires measured aggregate
scope traffic in the same change.
