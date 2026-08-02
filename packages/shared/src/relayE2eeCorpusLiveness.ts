/**
 * READ-LIVENESS FOR THE §16.3 FIXTURE CORPUS.
 *
 * TEST SUPPORT ONLY. Nothing in a shipped code path may import this module; it
 * exists so that the corpus's consuming suites can prove a property about
 * THEMSELVES that the §16.3 coverage ledger cannot express.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The ledger in `relayE2eeCorpus.test.ts` constrains the corpus's NAMES and
 * COUNTS: every §16.3 obligation resolves as a generated case or a declared
 * deferral, every committed case is claimed by exactly one obligation, and every
 * group states its size exactly. All of that is about which cases EXIST.
 *
 * None of it is about what a case SAYS. A case reduced to nothing but a `name`
 * and an empty `expected` block discharges its obligation exactly as well as one
 * whose every field is re-derived through the implementation — and an
 * independent per-leaf mutation sweep found thirty-seven committed cases in
 * precisely that state, plus two whole blocks (397 leaves of close-machine step
 * traces) that no suite read at all. That is the same false-assurance shape the
 * ledger's own partition rule was added to close, one level down: the ledger
 * reads as covering the corpus while half the corpus asserts nothing.
 *
 * Thirty-three of those cases remain contentless and are listed at the bottom of
 * this file, one by one, with the reason and the owner of the missing work. The
 * corpus manifest's `livenessCensus` carries the per-family numbers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE PER-CASE RULE ENFORCES — A FLOOR, AND ONLY A FLOOR
 * ─────────────────────────────────────────────────────────────────────────────
 * The rule the three suites enforce is: EVERY COMMITTED CASE HAS AT LEAST ONE
 * LEAF THAT SOME SUITE READS, or an entry in the table below saying who reads it
 * or that nothing does. That is a floor of one leaf per case. It is NOT a claim
 * that a case's expectations are meaningfully asserted.
 *
 * Say it plainly: a case can keep its name, keep one or two live leaves, and
 * have every other field in its `expected` block inert, and it passes. Cases in
 * exactly that state are common here — see the census's
 * `casesByLiveLeafCount` distribution, which publishes how many cases have how
 * few live leaves rather than a single reassuring number. The floor's value is
 * that hollowing a case OUT ENTIRELY fails, and that the emptiness that remains
 * is counted and named instead of silent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT
 * ─────────────────────────────────────────────────────────────────────────────
 * A LEAF is one scalar under a case's `expected` block, counting a §16.2
 * `{"$bytes": …}` wrapper as a single leaf. A leaf is LIVE when a consuming
 * suite READ it during the run: every leaf is handed to the suite through an
 * accessor that records the read, so `toEqual` over a whole sub-object marks
 * every leaf it walked, and a field nobody touches stays unmarked.
 *
 * Read-liveness is an UPPER BOUND on assertion-liveness. A suite that reads a
 * leaf and throws the value away marks it live here, and a suite that reads it
 * only to feed it back as an input marks it live too. It is not an upper bound
 * that can be evaded in the direction that matters: a leaf that no suite reads
 * cannot possibly be asserted by one, so an INERT leaf is proof of absent
 * coverage even though a LIVE leaf is only evidence of present coverage.
 *
 * NO CURRENT ASSERTION-LIVENESS FIGURE EXISTS. The only assertion-liveness
 * numbers anyone has measured were produced by an independent mutation sweep
 * against the corpus as it stood BEFORE this round, and that corpus is
 * superseded. Everything published per family is read-liveness. The manifest's
 * `livenessCensus.assertionLiveness` states this and names what refreshing it
 * would cost.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW A SUITE USES IT
 * ─────────────────────────────────────────────────────────────────────────────
 * Wrap each family as it is loaded with `watch`, run the suite's tests, and — in
 * a test that runs LAST — check the recorder. Two declaration tables follow:
 *
 *   • `E2EE_CORPUS_CASE_LIVENESS` names every case the SHARED suite does not
 *     read, says which other suite reads it, and for the cases nothing reads at
 *     all carries the reason and the owner of the missing work.
 *   • `E2EE_CORPUS_DELEGATED_LEAF_READS` names, LEAF BY LEAF, every expectation
 *     that a suite other than the shared one is the sole reader of. That table
 *     is what lets the shared suite compute the census's cross-suite UNION
 *     exactly instead of bounding it from below.
 */

/** The suites that consume the §16.3 corpus. Each verifies its own claims. */
export type E2eeCorpusReader = "shared" | "node" | "noise";

/**
 * A committed case whose liveness the SHARED suite cannot establish, together
 * with what does establish it.
 *
 * Cases absent from this table are claimed by the shared suite and must be live
 * there. That default is deliberate: it makes the table the exception list, so
 * it stays short enough to read and every entry is a statement someone had to
 * write down rather than a silence.
 */
export interface E2eeCorpusLivenessClaim {
  readonly file: string;
  readonly case: string;
  /**
   * `shared` never appears — that is the default. `node` and `noise` name the
   * suite that reads the case; `decorative` says NOTHING reads it and the case
   * stands for its own existence alone.
   */
  readonly reader: Exclude<E2eeCorpusReader, "shared"> | "decorative";
  /**
   * Required on every `decorative` entry: why the case carries no live leaf, and
   * who owns making it live. "No live leaf, and nobody said why" is the state
   * this table exists to make unrepresentable.
   */
  readonly reason?: string;
}

function isBytesLeaf(value: object): boolean {
  if (Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "$bytes";
}

/** A leaf is a scalar, a `null`, or a §16.2 `{"$bytes": …}` wrapper. */
function isLeaf(value: unknown): boolean {
  return value === null || typeof value !== "object" || isBytesLeaf(value);
}

/** Every leaf path under one `expected` block, in the census's own counting. */
export function e2eeExpectedLeafPaths(expected: unknown): readonly string[] {
  const paths: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (isLeaf(value)) {
      paths.push(path);
      return;
    }
    const container = value as Record<string, unknown>;
    for (const key of Object.keys(container)) {
      walk(container[key], path === "" ? key : `${path}.${key}`);
    }
  };
  walk(expected, "");
  return paths;
}

/**
 * A structural copy of `value` in which every LEAF is an accessor that reports
 * its own path the first time it is read.
 *
 * Containers are rebuilt lazily and memoized, so reading one field of a large
 * block does not mark its siblings, and an array stays a real array — its
 * `length` follows from defining the index properties on it.
 */
function watched(value: unknown, path: string, onRead: (path: string) => void): unknown {
  if (isLeaf(value)) return value;
  const source = value as Record<string, unknown>;
  const target = (Array.isArray(value) ? [] : {}) as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const child = source[key];
    const childPath = path === "" ? key : `${path}.${key}`;
    if (isLeaf(child)) {
      Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        get: () => {
          onRead(childPath);
          return child;
        },
      });
      continue;
    }
    let memo: unknown;
    let built = false;
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get: () => {
        if (!built) {
          memo = watched(child, childPath, onRead);
          built = true;
        }
        return memo;
      },
    });
  }
  return target;
}

interface WatchedCase {
  readonly name: string;
  readonly expected?: unknown;
}

interface WatchedFamily {
  readonly cases: readonly WatchedCase[];
}

/** Per-file, per-case sets of the leaf paths a suite has read so far. */
export class E2eeCorpusLivenessRecorder {
  readonly #reads = new Map<string, Map<string, Set<string>>>();
  readonly #leaves = new Map<string, Map<string, readonly string[]>>();

  /**
   * Returns `family` with every case's `expected` block replaced by a watched
   * copy. The returned value is structurally identical for every purpose a test
   * has — the same keys, the same order, the same values — so a suite reads it
   * exactly as it read the parsed JSON.
   */
  watch<T extends WatchedFamily>(file: string, family: T): T {
    const perCase = new Map<string, Set<string>>();
    const perCaseLeaves = new Map<string, readonly string[]>();
    this.#reads.set(file, perCase);
    this.#leaves.set(file, perCaseLeaves);
    const cases = family.cases.map((entry) => {
      if (entry.expected === undefined) return entry;
      const seen = new Set<string>();
      perCase.set(entry.name, seen);
      perCaseLeaves.set(entry.name, e2eeExpectedLeafPaths(entry.expected));
      return {
        ...entry,
        expected: watched(entry.expected, "", (path) => seen.add(path)),
      };
    });
    return { ...family, cases } as unknown as T;
  }

  /** How many of a case's leaves have been read. */
  liveLeafCount(file: string, caseName: string): number {
    return this.#reads.get(file)?.get(caseName)?.size ?? 0;
  }

  /** WHICH of a case's leaves have been read, so several suites' runs can be unioned. */
  liveLeafPaths(file: string, caseName: string): readonly string[] {
    return [...(this.#reads.get(file)?.get(caseName) ?? [])];
  }

  /** How many leaves a case carries at all. */
  leafCount(file: string, caseName: string): number {
    return this.#leaves.get(file)?.get(caseName)?.length ?? 0;
  }

  /**
   * WHICH leaves a case carries at all, taken from the PARSED file before it was
   * instrumented — so asking this question does not itself mark anything live.
   * It is what lets a suite check that a leaf path someone wrote down by hand
   * names a leaf that really exists.
   */
  leafPaths(file: string, caseName: string): readonly string[] {
    return this.#leaves.get(file)?.get(caseName) ?? [];
  }

  /**
   * Every family file this recorder was handed. Derived rather than hardcoded so
   * that a suite which starts consuming another family is covered by the checks
   * written against this list without anyone remembering to extend it.
   */
  watchedFiles(): readonly string[] {
    return [...this.#leaves.keys()];
  }

  /** The per-family census this suite can account for, as measured numbers. */
  census(): readonly {
    readonly file: string;
    readonly cases: number;
    readonly leaves: number;
    readonly liveLeaves: number;
    readonly liveCases: number;
  }[] {
    return [...this.#leaves].map(([file, perCase]) => {
      let leaves = 0;
      let liveLeaves = 0;
      let liveCases = 0;
      for (const [caseName, paths] of perCase) {
        const live = this.liveLeafCount(file, caseName);
        leaves += paths.length;
        liveLeaves += live;
        if (live > 0) liveCases += 1;
      }
      return { file, cases: perCase.size, leaves, liveLeaves, liveCases };
    });
  }

  /** Every case this recorder saw and no test read a leaf of. */
  inertCases(file: string): readonly string[] {
    return [...(this.#leaves.get(file)?.keys() ?? [])].filter(
      (caseName) => this.liveLeafCount(file, caseName) === 0,
    );
  }
}

/**
 * THE EXEMPTION LIST.
 *
 * One entry per committed case whose liveness the shared suite does not
 * establish. Every other committed case must carry AT LEAST ONE leaf the shared
 * suite reads, and a test asserts exactly that in both directions — an entry
 * naming a case that IS live in the shared suite fails just as loudly as a case
 * that is live nowhere. One leaf is the whole requirement: a case that keeps its
 * name and a single live leaf satisfies it with the rest of its `expected` block
 * inert.
 *
 * `decorative` entries are the ones to read. Each is a case the corpus commits,
 * the ledger claims, and NOTHING asserts: it proves only that someone wrote the
 * name down. They are listed rather than counted so that the number is a
 * deliberate, reviewable figure instead of a silence, and every one of them
 * names the work that would make it live and who owns it.
 */
export const E2EE_CORPUS_CASE_LIVENESS: readonly E2eeCorpusLivenessClaim[] = [
  {
    file: "f03-capability-statement.json",
    case: "non-canonical-transcript-encoding",
    reader: "decorative",
    reason:
      "States `canonicalDecode`, `envelopeOverTheNonCanonicalBytesDiffers`, `verifiesUnderTheCanonicalSignature`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "prekey-cross-signature-lifted-from-another-statement",
    reader: "decorative",
    reason:
      "States `crossSignatureReconstructionVerifies`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "advertised-identity-fingerprint-disagrees-with-the-advertised-identity-key",
    reader: "decorative",
    reason:
      "States `crossSignatureReconstructionVerifies`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "hub-origin-exactly-at-the-bound",
    reader: "decorative",
    reason:
      "States `canonicalizationAccepted`, `encoderAccepted`, `expectedAccepted`, `selfCheckOnAConformingArtifact`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "hub-origin-one-byte-over-the-bound",
    reader: "decorative",
    reason:
      "States `canonicalizationAccepted`, `encoderAccepted`, `expectedAccepted`, `selfCheckOnAConformingArtifact`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "suite-registry-exactly-at-max-entries",
    reader: "decorative",
    reason:
      "States `encoderAccepted`, `expectedAccepted`, `transcriptBytes`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "suite-registry-one-entry-over-max-entries",
    reader: "decorative",
    reason:
      "States `encoderAccepted`, `expectedAccepted`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "transcript-exactly-at-the-transcript-bound",
    reader: "decorative",
    reason:
      "States `signingEnvelopeAccepted`, `expectedAccepted`, `selfCheck`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "transcript-one-byte-over-the-transcript-bound",
    reader: "decorative",
    reason:
      "States `signingEnvelopeAccepted`, `expectedAccepted`, `selfCheck`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "oversized-statement",
    reader: "decorative",
    reason:
      "States `selfCheck`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "oversized-carrier",
    reader: "decorative",
    reason:
      "States `selfCheck`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "malformed-continuity-id-wrong-prefix",
    reader: "decorative",
    reason:
      "States `encoderRejects`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "malformed-continuity-id-too-short",
    reader: "decorative",
    reason:
      "States `encoderRejects`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "malformed-continuity-id-out-of-alphabet",
    reader: "decorative",
    reason:
      "States `encoderRejects`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "malformed-continuity-id-empty",
    reader: "decorative",
    reason:
      "States `encoderRejects`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "continuity-id-unresolved-at-startup",
    reader: "decorative",
    reason:
      "States `selfCheck`, `advertisementUnavailable`, `fatalUnderEffectiveRequireE2EE`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f03-capability-statement.json",
    case: "protocol-range-excludes-the-implemented-version-fails-the-node-self-check",
    reader: "decorative",
    reason:
      "States `selfCheck`; no consuming suite reads any of it. Owned by the F3 statement harness: the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    file: "f04-prekey-certificates.json",
    case: "valid-node-agreement-prekey-certificate",
    reader: "decorative",
    reason:
      "States `transcript`, `transcriptBytes`, `transcriptSha256`, `identityFingerprint`, `agreementFingerprint`, `crossSignature`, `crossSignatureReconstructionVerifies`, `withinDirectSigningBound`; no consuming suite reads any of it. Owned by the F4 certificate harness: reconstructing the §7.3 node transcript and re-verifying its cross-signature here is per-family harness work not taken on in this round.",
  },
  {
    file: "f04-prekey-certificates.json",
    case: "node-certificate-at-the-maximum-hub-origin-accepted-and-within-S9",
    reader: "decorative",
    reason:
      "States `transcript`, `transcriptBytes`, `directSigningTranscriptMaxBytes`, `satisfiesS9`; no consuming suite reads any of it. Owned by the F4 certificate harness: reconstructing the §7.3 node transcript and re-verifying its cross-signature here is per-family harness work not taken on in this round.",
  },
  {
    file: "f04-prekey-certificates.json",
    case: "node-certificate-cross-signature-lifted-from-another-hub-origin",
    reader: "decorative",
    reason:
      "States `crossSignatureReconstructionVerifies`; no consuming suite reads any of it. Owned by the F4 certificate harness: reconstructing the §7.3 node transcript and re-verifying its cross-signature here is per-family harness work not taken on in this round.",
  },
  {
    file: "f04-prekey-certificates.json",
    case: "node-certificate-carried-identity-fingerprint-disagrees-with-the-identity-key",
    reader: "decorative",
    reason:
      "States `crossSignatureReconstructionVerifies`; no consuming suite reads any of it. Owned by the F4 certificate harness: reconstructing the §7.3 node transcript and re-verifying its cross-signature here is per-family harness work not taken on in this round.",
  },
  {
    file: "f04-prekey-certificates.json",
    case: "node-certificate-carried-agreement-fingerprint-disagrees-with-the-agreement-key",
    reader: "decorative",
    reason:
      "States `crossSignatureReconstructionVerifies`; no consuming suite reads any of it. Owned by the F4 certificate harness: reconstructing the §7.3 node transcript and re-verifying its cross-signature here is per-family harness work not taken on in this round.",
  },
  {
    file: "f04-prekey-certificates.json",
    case: "node-certificate-prekey-id-substituted-after-signing",
    reader: "decorative",
    reason:
      "States `crossSignatureReconstructionVerifies`; no consuming suite reads any of it. Owned by the F4 certificate harness: reconstructing the §7.3 node transcript and re-verifying its cross-signature here is per-family harness work not taken on in this round.",
  },
  {
    file: "f04-prekey-certificates.json",
    case: "node-certificate-usage-fields-are-not-carrier-supplied",
    reader: "decorative",
    reason:
      "States `crossSignatureReconstructionVerifies`, `reconstructedUsageDh`, `reconstructedUsageHash`; no consuming suite reads any of it. Owned by the F4 certificate harness: reconstructing the §7.3 node transcript and re-verifying its cross-signature here is per-family harness work not taken on in this round.",
  },
  {
    file: "f04-prekey-certificates.json",
    case: "client-certificate-at-the-maximum-namespace-accepted-and-within-S9",
    reader: "decorative",
    reason:
      "States `transcript`, `transcriptBytes`, `directSigningTranscriptMaxBytes`, `satisfiesS9`, `signingInputMaxBytes`, `satisfiesS2`; no consuming suite reads any of it. Owned by the F4 certificate harness: reconstructing the §7.3 node transcript and re-verifying its cross-signature here is per-family harness work not taken on in this round.",
  },
  {
    file: "f16-authorization-context.json",
    case: "suite-list-strip-after-the-hello-was-hashed",
    reader: "decorative",
    reason:
      "States `nodeAccepted`, `serverAccept`, `clientVerdict`, `disposition`, `clientEmitsNoRecord`, `closeReason`; no consuming suite reads any of it. Owned by the client-phase handshake harness: the verdict is the CLIENT's §8.8 step-4 decision over a stripped suite list, and no client handshake exists in this repository to drive it.",
  },
  {
    file: "f17-key-material-validation.json",
    case: "p256-public-key-valid-control",
    reader: "decorative",
    reason:
      "States `validationAccepted`; no consuming suite reads any of it. Owned by the F17 key-material harness: the validators and `verifyE2eeSignature` are reachable here, and driving each encoding through them is per-family harness work not taken on in this round.",
  },
  {
    file: "f17-key-material-validation.json",
    case: "ed25519-public-key-y-at-the-field-prime",
    reader: "decorative",
    reason:
      "States `validation`, `verificationVerdict`; no consuming suite reads any of it. Owned by the F17 key-material harness: the validators and `verifyE2eeSignature` are reachable here, and driving each encoding through them is per-family harness work not taken on in this round.",
  },
  {
    file: "f17-key-material-validation.json",
    case: "ed25519-public-key-y-above-the-field-prime",
    reader: "decorative",
    reason:
      "States `validation`, `verificationVerdict`; no consuming suite reads any of it. Owned by the F17 key-material harness: the validators and `verifyE2eeSignature` are reachable here, and driving each encoding through them is per-family harness work not taken on in this round.",
  },
  {
    file: "f17-key-material-validation.json",
    case: "ed25519-signature-with-a-canonically-encoded-identity-r-control",
    reader: "decorative",
    reason:
      "States `verificationVerdict`; no consuming suite reads any of it. Owned by the F17 key-material harness: the validators and `verifyE2eeSignature` are reachable here, and driving each encoding through them is per-family harness work not taken on in this round.",
  },
  {
    file: "f17-key-material-validation.json",
    case: "ed25519-signature-with-a-non-canonically-encoded-identity-r",
    reader: "decorative",
    reason:
      "States `verificationVerdict`, `pinnedPrimitiveUnderZip215Relaxation`, `differsFromTheControlOnlyInTheEncodingOfR`; no consuming suite reads any of it. Owned by the F17 key-material harness: the validators and `verifyE2eeSignature` are reachable here, and driving each encoding through them is per-family harness work not taken on in this round.",
  },
  {
    file: "f17-key-material-validation.json",
    case: "ed25519-signature-scalar-at-the-group-order",
    reader: "decorative",
    reason:
      "States `verificationVerdict`; no consuming suite reads any of it. Owned by the F17 key-material harness: the validators and `verifyE2eeSignature` are reachable here, and driving each encoding through them is per-family harness work not taken on in this round.",
  },
  {
    file: "f17-key-material-validation.json",
    case: "ed25519-signature-scalar-above-the-group-order",
    reader: "decorative",
    reason:
      "States `verificationVerdict`; no consuming suite reads any of it. Owned by the F17 key-material harness: the validators and `verifyE2eeSignature` are reachable here, and driving each encoding through them is per-family harness work not taken on in this round.",
  },
  {
    file: "f15-noise-core-vectors.json",
    case: "cacophony/Noise_IK_25519_ChaChaPoly_SHA256",
    reader: "noise",
  },
  {
    file: "f15-noise-core-vectors.json",
    case: "cacophony/Noise_NX_25519_ChaChaPoly_SHA256",
    reader: "noise",
  },
  {
    file: "f15-noise-core-vectors.json",
    case: "snow/Noise_IK_25519_ChaChaPoly_SHA256",
    reader: "noise",
  },
  {
    file: "f15-noise-core-vectors.json",
    case: "snow/Noise_NX_25519_ChaChaPoly_SHA256",
    reader: "noise",
  },
];

/**
 * THE CROSS-SUITE READ ATTRIBUTION.
 *
 * The census in the corpus manifest reports, per family, how many expectation
 * leaves are live — and "live" is a UNION over three suites that run in two
 * packages and never share a process. No single suite can recompute a union it
 * only sees half of, so the census's per-family number used to be constrained
 * from BELOW only: the shared suite checked that the published figure was at
 * least what it alone read. A figure that drifted UPWARD — the direction in
 * which a published coverage number misleads — passed.
 *
 * This table closes that. It names, leaf path by leaf path, every expectation
 * that a suite OTHER than the shared one is the sole reader of. With it the
 * shared suite computes the union exactly:
 *
 *     union(family) = |leaves the shared suite read| + |paths attributed here|
 *
 * and asserts EQUALITY against the census. Three independent checks stop the
 * attribution from being inflated to prop a number up:
 *
 *   • the shared suite rejects any path that is not a real leaf of that case
 *     (checked against the file as parsed, before instrumentation);
 *   • the shared suite rejects any path IT reads, so nothing is counted twice;
 *   • the naming suite asserts it really does read every path attributed to it —
 *     `node` in apps/server, `noise` in relayE2eeNoise.test.ts. A path listed
 *     here and read by nobody fails there.
 *
 * REGENERATING IT: run the three consuming suites with the recorder in place and
 * take, per case, the paths some other suite read that the shared suite did not.
 * The failure messages name the case and the path, so a drift is a mechanical
 * fix rather than a re-derivation.
 */
export interface E2eeCorpusDelegatedLeafReads {
  readonly file: string;
  readonly case: string;
  readonly reader: Exclude<E2eeCorpusReader, "shared">;
  /** `expected`-relative leaf paths, sorted, that ONLY `reader` reads. */
  readonly paths: readonly string[];
}

export const E2EE_CORPUS_DELEGATED_LEAF_READS: readonly E2eeCorpusDelegatedLeafReads[] = [
  {
    file: "f10-mode-machine.json",
    case: "node-deadline-after-row-n3-is-q8-under-effective-require-e2ee",
    reader: "node",
    paths: ["action", "closeReason", "deliveredToTheRpcParser", "nextState"],
  },
  {
    file: "f10-mode-machine.json",
    case: "node-deadline-after-row-n3-is-q8-under-the-compatibility-default",
    reader: "node",
    paths: ["action", "closeReason", "deliveredToTheRpcParser", "nextState"],
  },
  {
    file: "f10-mode-machine.json",
    case: "node-deadline-n8-does-not-fire-under-the-compatibility-default",
    reader: "node",
    paths: ["action", "channelStaysOpen", "fatal", "recordsOnTheWire", "row"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n1-legacy-json-under-effective-require-e2ee",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n10-an-envelope-failing-a-step-3-check",
    reader: "node",
    paths: ["closeReason", "deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n11-a-negotiation-record-after-e2ee",
    reader: "node",
    paths: ["closeReason", "deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n11-an-absent-first-byte-after-e2ee",
    reader: "node",
    paths: ["closeReason", "deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n11-legacy-json-after-e2ee",
    reader: "node",
    paths: ["closeReason", "deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n12-legacy-json-in-legacy",
    reader: "node",
    paths: ["deliveredToTheRpcParser", "fatal"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n13-a-negotiation-record-in-legacy",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n13-an-envelope-in-legacy",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n14-an-unknown-first-byte-in-legacy",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n16-an-undersized-connection-under-the-compatibility-default",
    reader: "node",
    paths: ["fatal"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n16-no-conforming-statement-under-the-compatibility-default",
    reader: "node",
    paths: ["fatal"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n17-legacy-json-on-a-channel-that-never-advertised",
    reader: "node",
    paths: ["deliveredToTheRpcParser", "fatal"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n2-legacy-json-locks-legacy-and-counts-one-peer-legacy-occurrence",
    reader: "node",
    paths: ["deliveredToTheRpcParser", "fatal"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n3-client-hello-runs-the-responder-and-enters-e2ee",
    reader: "node",
    paths: ["deliveredToTheRpcParser", "fatal", "rpcOutputBeforeTheImplicitFinish"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n4-a-hello-with-no-advertisement-emitted",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n4-a-second-hello-on-the-channel",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n5-a-misdirected-negotiation-record-in-negotiating",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n6-an-envelope-before-establishment",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n7-an-absent-first-byte-in-negotiating",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n7-an-unknown-first-byte-in-negotiating",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n8-the-handshake-deadline-under-effective-require-e2ee",
    reader: "node",
    paths: ["deliveredToTheRpcParser"],
  },
  {
    file: "f10-mode-machine.json",
    case: "row-n9-an-authenticated-envelope-is-delivered-to-the-rpc-parser",
    reader: "node",
    paths: ["deliveredToTheRpcParser", "fatal", "rpcOutputBeforeTheImplicitFinish"],
  },
  {
    file: "f15-noise-core-vectors.json",
    case: "cacophony/Noise_IK_25519_ChaChaPoly_SHA256",
    reader: "noise",
    paths: [
      "handshakeHash",
      "handshakeMessages.0",
      "handshakeMessages.1",
      "transportMessages.0",
      "transportMessages.1",
      "transportMessages.2",
      "transportMessages.3",
    ],
  },
  {
    file: "f15-noise-core-vectors.json",
    case: "cacophony/Noise_NX_25519_ChaChaPoly_SHA256",
    reader: "noise",
    paths: [
      "handshakeHash",
      "handshakeMessages.0",
      "handshakeMessages.1",
      "transportMessages.0",
      "transportMessages.1",
      "transportMessages.2",
      "transportMessages.3",
    ],
  },
  {
    file: "f15-noise-core-vectors.json",
    case: "snow/Noise_IK_25519_ChaChaPoly_SHA256",
    reader: "noise",
    paths: [
      "handshakeMessages.0",
      "handshakeMessages.1",
      "transportMessages.0",
      "transportMessages.1",
    ],
  },
  {
    file: "f15-noise-core-vectors.json",
    case: "snow/Noise_NX_25519_ChaChaPoly_SHA256",
    reader: "noise",
    paths: [
      "handshakeMessages.0",
      "handshakeMessages.1",
      "transportMessages.0",
      "transportMessages.1",
    ],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "a-combined-narrow-and-widen-command-is-a-withdrawal",
    reader: "node",
    paths: [
      "counts.abortedHandshakes",
      "counts.legacy",
      "counts.nxE2ee",
      "counts.suiteWithdrawn",
      "policyAfter.requireE2EE",
      "policyAfter.suiteRegistry.0",
      "policyAfter.suiteRegistry.1",
      "policyGenerationAfter",
    ],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "a-hello-reaching-step-2-after-the-durable-commit-is-refused-there",
    reader: "node",
    paths: [
      "channelEstablishedBehindTheSweep",
      "counts.abortedHandshakes",
      "counts.legacy",
      "counts.nxE2ee",
      "counts.suiteWithdrawn",
      "disposition",
      "policyReadAtStepTwo.requireE2EE",
      "policyReadAtStepTwo.suiteRegistry.0",
      "row",
    ],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "a-negotiating-channel-is-not-swept-and-then-fails-closed-on-a-refused-hello",
    reader: "node",
    paths: ["counts.abortedHandshakes", "counts.legacy", "counts.nxE2ee", "counts.suiteWithdrawn"],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "a-negotiating-channel-is-not-swept-and-then-fails-closed-on-legacy-json",
    reader: "node",
    paths: ["counts.abortedHandshakes", "counts.legacy", "counts.nxE2ee", "counts.suiteWithdrawn"],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "a-suite-leaving-the-registry-closes-the-ik-channel-established-on-it",
    reader: "node",
    paths: [
      "isWithdrawal",
      "policyAfter.requireE2EE",
      "policyAfter.suiteRegistry.0",
      "policyGenerationAfter",
    ],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "a-suite-leaving-the-registry-closes-the-nx-channel-established-on-it",
    reader: "node",
    paths: [
      "isWithdrawal",
      "policyAfter.requireE2EE",
      "policyAfter.suiteRegistry.0",
      "policyGenerationAfter",
    ],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "a-widening-closes-nothing-and-still-advances-the-policy-generation",
    reader: "node",
    paths: [
      "counts.abortedHandshakes",
      "counts.legacy",
      "counts.nxE2ee",
      "counts.suiteWithdrawn",
      "isWithdrawal",
      "policyAfter.requireE2EE",
      "policyAfter.suiteRegistry.0",
      "policyAfter.suiteRegistry.1",
    ],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "require-approved-client-e2ee-false-to-true-over-a-legacy-an-nx-and-an-ik-channel",
    reader: "node",
    paths: [
      "counts.abortedHandshakes",
      "counts.legacy",
      "counts.nxE2ee",
      "counts.suiteWithdrawn",
      "effectiveRequireE2EEAfter",
      "isWithdrawal",
      "policyAfter.requireE2EE",
      "policyAfter.suiteRegistry.0",
      "policyGenerationAfter",
    ],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "require-e2ee-false-to-true-over-a-legacy-an-nx-and-an-ik-channel",
    reader: "node",
    paths: [
      "counts.abortedHandshakes",
      "counts.legacy",
      "counts.nxE2ee",
      "counts.suiteWithdrawn",
      "handshakeRejectOnTheLegacyChannel",
      "isWithdrawal",
      "policyAfter.requireE2EE",
      "policyAfter.suiteRegistry.0",
      "policyGenerationAfter",
    ],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "step-c-counts-broken-out-by-class",
    reader: "node",
    paths: ["eachChannelDispatchedExactlyOnce", "isWithdrawal"],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "the-row-n3-race-with-the-in-flight-enumeration-attempted-first",
    reader: "node",
    paths: [
      "oneConsistentSnapshot",
      "outcomeIsOneOf.0.disposition",
      "outcomeIsOneOf.0.reachedRowN3",
      "outcomeIsOneOf.1.disposition",
      "outcomeIsOneOf.1.reachedRowN3",
      "sameOutcomeInBothEnumerationOrders",
      "totalChannelsAccountedFor",
    ],
  },
  {
    file: "f18-node-admission-policy.json",
    case: "the-row-n3-race-with-the-live-channel-enumeration-attempted-first",
    reader: "node",
    paths: [
      "oneConsistentSnapshot",
      "outcomeIsOneOf.0.disposition",
      "outcomeIsOneOf.0.reachedRowN3",
      "outcomeIsOneOf.1.disposition",
      "outcomeIsOneOf.1.reachedRowN3",
      "sameOutcomeInBothEnumerationOrders",
      "totalChannelsAccountedFor",
    ],
  },
];
