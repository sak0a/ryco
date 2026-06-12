# Package Size Measurement

Use this workflow before pruning packages, fonts, icons, native dependencies, or desktop shell
technology. Stale kept desktop stages are useful context only; they are not current measurements.

## Web Bundle

Build the current web bundle without sourcemaps, then summarize raw, gzip, and brotli bytes:

```sh
RYCO_WEB_SOURCEMAP=0 bun --cwd apps/web run build
bun run measure:web-bundle
```

The report groups:

- initial JavaScript and CSS referenced by `index.html`
- async JavaScript and CSS chunks
- fonts
- images
- sourcemaps, if a run intentionally enabled them
- other emitted assets

Optional arguments:

```sh
bun run measure:web-bundle -- --dist apps/server/dist/client --top 100
```

Use this output to decide whether to retest `modulePreload`, lazy-load alternate font CSS, or
optimize large image/icon assets. Do not treat source asset byte sizes as emitted bundle impact
until this build report confirms them.

## Desktop Kept Stage

Run a current kept-stage build, then measure the retained stage:

```sh
HEAD=$(git rev-parse --short=12 HEAD)
OUT="$PWD/release-size-audit/$HEAD-mac-arm64"

RYCO_DESKTOP_KEEP_STAGE=true \
RYCO_DESKTOP_OUTPUT_DIR="$OUT" \
RYCO_WEB_SOURCEMAP=0 \
RYCO_SERVER_SOURCEMAP=0 \
RYCO_DESKTOP_SOURCEMAP=0 \
bun run dist:desktop:dmg:arm64

bun run measure:desktop-stage
```

`measure:desktop-stage` selects the newest `$TMPDIR/ryco-desktop-*-stage-*` directory by default.
It reads `app/package.json`, compares `rycoCommitHash` with the current `git rev-parse --short=12
HEAD`, and refuses stale stages unless `--allow-stale` is passed.

Optional arguments:

```sh
bun run measure:desktop-stage -- --stage "$TMPDIR/ryco-desktop-mac-stage-XXXXXX" --top 100
bun run measure:desktop-stage -- --stage "$TMPDIR/ryco-desktop-mac-stage-XXXXXX/app"
```

The report includes:

- staged `node_modules`
- server dist
- bundled web client
- desktop dist
- desktop resources and copied production resources
- final staged artifacts
- largest package-level `node_modules` entries
- tracked targets such as `@anthropic-ai`, `node-pty`, `sharp`/`@img`, `@github`, `@opencode-ai`,
  `effect`/`@effect`, `electron-updater`, `geist`, and `next`

## Evidence Rules

- A kept stage whose `rycoCommitHash` does not match current HEAD is stale.
- Stale stage sizes may be cited as historical context only.
- Dependency pruning, native dependency replacement, font-loading changes, asset regeneration, and
  shell migration need current measurements first.
