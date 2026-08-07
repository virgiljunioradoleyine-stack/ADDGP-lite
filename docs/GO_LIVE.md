# Go live

Everything that has to happen on **your** machine, in order. Nothing here can be done from
a CI container or an agent session — each step either needs a key, a private signing key,
or repository-owner rights.

Roughly 30 minutes, most of it waiting for builds.

---

## 1. Rotate the OpenRouter key

If a key has ever been pasted into a chat, a terminal recording, a screenshot or an issue,
it is compromised regardless of whether the message was deleted. Delete it at
<https://openrouter.ai/keys> and mint a new one.

```bash
addgp-lite keys set     # stored 0600, local only
```

---

## 2. Run the tool against itself

This is the first live end-to-end run — the four model-facing phases have never touched a
real key.

```bash
git clone https://github.com/virgiljunioradoleyine-stack/ADDGP-lite
cd ADDGP-lite && bun install
bun run src/cli/main.ts selfcheck
```

**Expect rough edges.** This is the step most likely to surface a bug, which is exactly
why it comes before the release and not after.

Two things you will see, and what they mean:

- **"23 committed credentials found."** Correct. They are the planted secrets in
  `tests/sovereignty/gate.test.ts` that the gate is tested against. They are reported and
  never transmitted. Worth a line in `SELF_COMPLIANCE.md` saying so, since anyone reading
  it will wonder.
- **A gap list about ADDGP-Lite itself.** Ship it with the open gaps visible. A compliance
  tool that hides its own findings is worth nothing.

Then record the cassettes, so CI can replay a full scan for free:

```bash
ADDGP_CASSETTE_MODE=record bun run src/cli/main.ts scan
```

**Read the cassettes before committing them.** They hold model output derived from a
redacted payload — they should contain pseudonyms and never a real identifier.

```bash
git add SELF_COMPLIANCE.md tests/golden/cassettes && git commit
```

---

## 3. Create the signing keypair

```bash
minisign -G -p minisign.pub -s minisign.key
```

**Generate this yourself, on your own machine, and nowhere else.** A signature answers one
question — *did this file come from the person it claims to come from?* If the private key
was generated inside a container, pasted into a chat, or handled by anything other than
you, the answer becomes "someone, possibly you" and the signature stops meaning anything.
This is the one step in this document that cannot be delegated, and it is deliberately not
automated.

- `minisign.key` → password manager or encrypted volume. **Never committed.** If it leaks:
  revoke publicly, rotate, re-sign.
- `minisign.pub` → commit it, put it in the release notes, put it on the ViradoTech site.
  People need it to check you.

Verify it works before you rely on it:

```bash
echo test > /tmp/t && minisign -Sm /tmp/t -s minisign.key && minisign -Vm /tmp/t -p minisign.pub
```

---

## 4. Build and sign

```bash
bun run release
```

Five platforms, checksums, `SHA256SUMS`, and the hand-over tarball. The script extracts the
tarball and verifies it against its own checksum file before reporting success; if that
fails it exits non-zero and there is no release.

```bash
cd release
for f in addgp-lite-1.0.0-*; do
  case "$f" in *.sha256|*.minisig) continue;; esac
  minisign -Sm "$f" -s ~/path/to/minisign.key
done
```

Then check it the way a stranger will — from the tarball, not the build directory:

```bash
cd /tmp && rm -rf v && mkdir v && cd v
tar xzf ~/ADDGP-lite/release/addgp-lite-1.0.0-*.tar.gz
shasum -a 256 -c addgp-lite.sha256
./install.sh && addgp-lite --version

mkdir demo && cd demo && git init -q .
env -u HTTPS_PROXY -u HTTP_PROXY addgp-lite init --yes --regions gh,ng,eu
env -u HTTPS_PROXY -u HTTP_PROXY addgp-lite doctor --local
env -u HTTPS_PROXY -u HTTP_PROXY addgp-lite sovereignty preview
```

All three offline commands must work with no network. If any reaches for the network, that
is a release blocker — it breaks the Accra-first promise, which is the whole point.

---

## 5. Make the repository public

**Settings → General → Danger Zone → Change visibility → Public.**

Before you click it, two settings worth changing:

- **Rename the default branch.** It is currently `claude/software-build-sublwz`, which
  reads like an abandoned agent branch. Settings → Branches → pencil icon → `main`. GitHub
  redirects the old name, so nothing breaks.
- **Confirm the sidebar says "MIT license".** It should now that `LICENSE` is pure MIT
  text. If it still says "Other", something has been appended to it again.

Then, on the repository home page (right sidebar, ⚙ next to *About*):

- **Description:** *Describe your system in plain English, pick your regions, get the law
  that applies and the gaps in your code. Your code never leaves your machine readable.*
- **Topics:** `compliance` `privacy` `gdpr` `data-protection` `africa` `ghana` `nigeria`
  `sovereignty` `cli` `openrouter` `ai-governance` `bun` `typescript`
- Tick **Releases**, untick **Packages** and **Environments**.

Discussions and Issues are already enabled.

---

## 6. Publish the release

```bash
gh release create v1.0.0 \
  --title "ADDGP-Lite 1.0.0" \
  --notes-file docs/release-notes/v1.0.0.md \
  release/addgp-lite-1.0.0-* \
  release/SHA256SUMS \
  minisign.pub
```

If you signed in step 3, delete the "**These binaries are not signed**" paragraph from
`docs/release-notes/v1.0.0.md` first and replace it with the verification command:

```bash
minisign -Vm addgp-lite-1.0.0-<platform> -P <contents of minisign.pub>
```

Then **download from the release page** — not from `release/` — and re-run the checksum and
the offline path. A signature over the file you meant to upload proves nothing about the
file that actually uploaded.

---

## 7. Open Discussions

Discussions → **Announcements** → new discussion. Paste
[DISCUSSIONS_WELCOME.md](DISCUSSIONS_WELCOME.md) from the line marked `# Welcome to
ADDGP-Lite` down. Pin it.

Create these categories first, or the routing table in that post points nowhere:

| Category | Format |
|---|---|
| 📣 Announcements | Announcement |
| 💬 General | Open discussion |
| 💡 Ideas | Open discussion |
| 🙏 Q&A | Question / Answer |
| 🌍 Region packs | Open discussion |
| 🎉 Show and tell | Open discussion |

---

## 8. Then stop and wait

Do not promote it the day it goes public. Give it a week of being findable, and let the
first stranger who runs it tell you what breaks. The single most valuable thing that can
happen to this project early is one honest issue from someone in a jurisdiction you do not
know.
