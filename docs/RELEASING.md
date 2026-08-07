# Releasing

How a version of ADDGP-Lite gets built, signed, and handed to someone.

Distribution is **a local file**. There is no install-script host, no package registry, no
CDN. You hand someone a binary, and they can verify it is the one you sent.

---

## Before you release

### 1. The tool must pass its own scan

```bash
addgp-lite selfcheck
```

A compliance tool that cannot pass its own scan has no standing. This writes
`SELF_COMPLIANCE.md`, which ships in the tarball with its **open gaps listed, not hidden**.

**CI gate: no release if `selfcheck` reports an unresolved critical gap.**

### 2. Everything green

```bash
bun install
bun run embed          # packs, prompts and data → src/generated/embedded.ts
bun x tsc --noEmit
bun test
```

The sovereignty suite is security-critical. If any test in `tests/sovereignty/` fails, stop.

### 3. Record cassettes if the prompts changed

```bash
export OPENROUTER_API_KEY=sk-or-...
ADDGP_CASSETTE_MODE=record bun run src/cli/main.ts scan
git add tests/golden/cassettes
```

Cassettes let CI replay a full scan without spending anything. **Check them before
committing** — they hold model output derived from a redacted payload, so they should
contain pseudonyms and never a real identifier. If you recorded against a private repo,
read them.

### 4. Bump the version

`package.json` → `version`, and `src/brand.ts` → `BRAND.version`. Keep them equal.

---

## Build

### One platform, for testing

```bash
bun run build
# → dist/addgp-lite-<version>-<os>-<arch>  +  .sha256
```

### All five platforms

```bash
bun run release
```

Produces, in `release/`:

```
addgp-lite-1.0.0-darwin-arm64          + .sha256
addgp-lite-1.0.0-darwin-x64            + .sha256
addgp-lite-1.0.0-linux-x64             + .sha256
addgp-lite-1.0.0-linux-arm64           + .sha256
addgp-lite-1.0.0-windows-x64.exe       + .sha256
SHA256SUMS
addgp-lite-1.0.0-<host>.tar.gz         ← the hand-over tarball
```

The tarball contains the binary, its checksum, `install.sh`, `README.md`, `LICENSE` and
`SELF_COMPLIANCE.md`.

---

## Sign it

Releases are signed with [minisign](https://jedisct1.github.io/minisign/). Signing is what
lets someone you handed a file to confirm it came from you and not from whoever was
sitting between you.

### One-time: create a keypair

```bash
minisign -G -p minisign.pub -s minisign.key
```

- **`minisign.key` never leaves your machine and is never committed.** Keep it in a
  password manager or an encrypted volume. If it leaks, revoke publicly and rotate.
- **`minisign.pub` is published** — in the repository, in the release notes, and on the
  ViradoTech site. People need it to verify you.

### Every release

```bash
cd release
for f in addgp-lite-*; do
  case "$f" in *.sha256|*.minisig) continue;; esac
  minisign -Sm "$f" -s ~/path/to/minisign.key
done
```

Ship `minisign.pub` alongside, so `install.sh` can verify automatically.

---

## Verify the way a recipient would

Before you send anything, check it the way the person receiving it will:

```bash
cd /tmp && rm -rf verify && mkdir verify && cd verify
tar xzf ~/release/addgp-lite-1.0.0-linux-x64.tar.gz

shasum -a 256 -c addgp-lite.sha256
minisign -Vm addgp-lite -p minisign.pub

./install.sh
addgp-lite verify
addgp-lite --version
```

Then the guarantee that matters — the whole thing with no network at all:

```bash
mkdir demo && cd demo && git init -q .
env -u HTTPS_PROXY -u HTTP_PROXY addgp-lite init --yes --regions gh,ng,eu
env -u HTTPS_PROXY -u HTTP_PROXY addgp-lite doctor --local
env -u HTTPS_PROXY -u HTTP_PROXY addgp-lite sovereignty preview
```

All three must work offline. If any of them reaches for the network, that is a release
blocker, not a bug to fix later — it breaks Law 3 and the Accra-first promise with it.

---

## Publish

### GitHub release

```bash
gh release create v1.0.0 \
  --title "ADDGP-Lite 1.0.0" \
  --notes-file docs/release-notes/v1.0.0.md \
  release/addgp-lite-1.0.0-* \
  release/SHA256SUMS \
  minisign.pub
```

Include in the notes:

- **How to verify** — the checksum and signature commands, in full.
- **What changed in the packs.** Pack changes matter more than code changes to most users:
  a new jurisdiction, an instrument that commenced, a provision that moved.
- **Contributors**, by name, especially anyone who contributed a pack.
- **Known gaps** from `SELF_COMPLIANCE.md`. Do not omit these — the tool lists open gaps
  for everyone else and would be worthless if it hid its own.

### Then verify the published artifact

Download from the release page — not from your build directory — and run the checksum and
the offline path again. A signature over the file you meant to upload proves nothing about
the file that actually uploaded.

---

## Versioning

Semantic, with one addition: **pack content changes are a minor bump, not a patch.**

- **major** — a breaking change to the config schema, the gap schema, or the CLI surface.
- **minor** — a new region pack, a new detector, new obligations, a new command.
- **patch** — fixes that change no output shape.

The embedded pack date is printed by `addgp-lite doctor` and stamped into every report, so
a user can always see how old the law they are relying on is.

---

## If you need to pull a release

If a released binary leaks something it should not:

1. **Say so immediately**, in a GitHub advisory and in the release notes of the fix.
2. Delete the affected artifacts from the release page.
3. Publish the fix with the version bumped, and describe exactly what could have leaked,
   under what conditions, and to whom.
4. Tell people what to do about it — if a payload could have carried a real identifier,
   they need to know which vendor received it and when, and their own egress ledger
   (`.addgp/egress.jsonl`) tells them the rest.

The tool asks its users to trust a guarantee. The only way that survives a failure is
telling them plainly and quickly.
