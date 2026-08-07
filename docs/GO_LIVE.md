# Go live

Two kinds of step here, marked as they come up:

- **🌐 Browser only** — a page you click on. No terminal, no install.
- **⌨️ Needs a terminal** — cannot be done from a button. If you don't have a computer set
  up for development and don't want one, use
  **[GitHub Codespaces](https://github.com/codespaces)**: open the repo, click **Code →
  Codespaces → Create codespace**, and you get a terminal running in a browser tab with
  the repo already cloned and Bun installable in one line. Nothing to install on your own
  machine, and it goes away when you close the tab.

Roughly 30 minutes, most of it waiting for builds.

---

## 1. 🌐 Rotate the OpenRouter key

If a key has ever been pasted into a chat, a terminal recording, a screenshot or an issue,
it is compromised regardless of whether the message was deleted. Delete it at
<https://openrouter.ai/keys> and mint a new one. Keep it somewhere for step 2.

---

## 2. ⌨️ Run the tool against itself

This is the first live end-to-end run — the four model-facing phases have never touched a
real key. If you're on Codespaces, `bun` is not preinstalled — run
`curl -fsSL https://bun.sh/install | bash && source ~/.bashrc` first.

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

## 3. ⌨️ Create the signing keypair

```bash
# install minisign first if it's not there: apt/brew/etc. have it, or see
# https://jedisct1.github.io/minisign/
minisign -G -p minisign.pub -s minisign.key
```

**Generate this yourself, somewhere you control, and nowhere else — not in a GitHub
Actions runner, not pasted into a chat.** A signature answers one question — *did this
file come from the person it claims to come from?* If the private key was ever handled by
anything other than you, the answer becomes "someone, possibly you," and the signature
stops meaning anything. This is the one step in this document that must never be
automated. A Codespace is fine for this — it is still something only you controlled the
session for — but download `minisign.key` out of it afterward and delete the Codespace;
don't leave a private key sitting in a cloud dev environment indefinitely.

- `minisign.key` → password manager or encrypted volume. **Never committed.** If it leaks:
  revoke publicly, rotate, re-sign.
- `minisign.pub` → commit it, put it in the release notes, put it on the ViradoTech site.
  People need it to check you.

Verify it works before you rely on it:

```bash
echo test > /tmp/t && minisign -Sm /tmp/t -s minisign.key && minisign -Vm /tmp/t -p minisign.pub
```

---

## 4. 🌐 Build and publish (draft) from the Actions tab

No terminal for this step — `.github/workflows/release.yml` does the whole build in the
cloud:

1. Go to **Actions → Release → Run workflow**.
2. Version: `1.0.0`. Leave **draft** checked.
3. Run it. Takes a few minutes — it typechecks, tests, cross-compiles all five platforms,
   verifies the tarball extracts and checksums correctly, tags `v1.0.0`, and opens a
   **draft** release with the binaries and `SHA256SUMS` attached.

It publishes nothing on its own — a draft is invisible to the public until you hit
**Publish** on the release page. That review step is intentional.

**This does not sign the binaries.** Signing needs `minisign.key`, and that key must never
exist inside a CI runner — anyone with write access to the repo could trigger a workflow
and exfiltrate a secret it has access to, which defeats the entire point of a signature.
Signing stays the one manual step, below.

---

## 5. ⌨️ Sign the draft's binaries (optional, needs step 3's key)

Skip this and publish unsigned if you haven't done step 3 yet — the release notes already
say plainly that unsigned binaries are checksum-only, and you can sign a later release once
you have `minisign.key` set up. If you do have it:

```bash
# download the draft's binaries from the release page, then, next to minisign.key:
for f in addgp-lite-1.0.0-*; do
  case "$f" in *.sha256) continue;; esac
  minisign -Sm "$f" -s minisign.key
done
```

Edit the draft release on the page: upload each `.minisig` file and `minisign.pub`, and in
`docs/release-notes/v1.0.0.md` swap the "these binaries are not signed" paragraph for the
verification command, then update the draft's notes to match.

---

## 6. 🌐 Publish

On the release page: check the assets are all there (five binaries, five `.sha256`,
`SHA256SUMS`, and `.minisig` files if you signed), then click **Publish release**.

**Repository visibility, the default branch name, and the About section are already
done** — you made the repo public and set those already. Nothing left to check there.

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
