# Security

ADDGP-Lite handles two things that matter: source code that has not been released, and
API keys. It is built so that neither leaves the machine — so a flaw in that guarantee
is the most serious kind of bug this project can have.

## Reporting a vulnerability

**Do not open a public issue for a sovereignty or key-handling flaw.**

Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability), or contact the maintainers at ViradoTech.

Please include: what you did, what left the machine that should not have, and the
version (`addgp-lite --version`). A failing test case is the most useful thing you can
send.

We will confirm receipt, tell you honestly whether we think it is a flaw, and credit you
in the fix unless you would rather we did not.

## What counts as a vulnerability here

Anything that breaks one of these, which the tool states as guarantees:

- **A payload leaves with something readable in it** that should have been redacted: an
  identifier, a secret, a comment, personal data, a real file path.
- **The egress gate is bypassed** — a request reaching any host other than
  `openrouter.ai`, or a payload sent without passing the gate.
- **The pseudonym map leaks** into a payload, a cache entry, an export bundle, or a
  report. It is the half that reverses everything else.
- **A key is exposed** — written to argv, a log, a stack trace, an output artifact, or
  stored world-readable.
- **A denied path is read for egress**: `.env`, keys and certs, data files, notebook
  outputs, anything in `sovereignty.never_send`.
- **The tool contacts the network when it said it would not** — during `init`,
  `doctor --local`, `--offline`, or any local phase.

## What is not a vulnerability

- **The licence check can be removed.** There is no licence check. The tool is MIT and
  free; there is nothing to bypass.
- **A model produced a wrong or incomplete finding.** That is a quality issue — please
  do open a public issue. The tool states plainly that it is not legal advice and that
  absence of a finding is not evidence of compliance.
- **Level 2 (verbatim) sends source code.** That is what it is for. It is opt-in,
  allowlist-only, and requires typed confirmation.
- **A pack cites a provision that turns out to be wrong.** Packs are retrieval targets,
  not findings; the verification protocol is what stops that reaching a report. Still
  worth an issue.

## Verifying what you were handed

```bash
addgp-lite verify                    # this binary's own SHA-256 and signature status
shasum -a 256 -c addgp-lite.sha256   # against the checksum shipped alongside it
minisign -Vm addgp-lite -P <pubkey>  # against the signature, if you were sent one
```

And before you trust it with a repository:

```bash
addgp-lite sovereignty preview       # exactly what would be sent, per file, before any call
addgp-lite sovereignty ledger        # every outbound byte it has ever sent
```

You do not have to take our word for any of this. That is the design.

## Our own posture

- No telemetry, no analytics, no licence check, no version ping. Not opt-out — absent.
- Keys in the OS keychain, or a scrypt + AES-256-GCM file at mode 0600.
- One pinned hostname; everything else blocked at the gate.
- No `eval`, no dynamic require, no unsanitised shell-out.
- Dependencies audited in CI on every change; SBOM published with each release.
- `addgp-lite selfcheck` runs the tool against its own source. Every release ships
  `SELF_COMPLIANCE.md` with its open gaps listed, not hidden.
