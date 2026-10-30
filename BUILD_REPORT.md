# BUILD_REPORT.md

Newest entry first. Written by each build session before it ends. See the "Session close-out report to the coordinator" section in `CLAUDE.md` for the format and rules.

### 2026-10-30 13:05 UTC · main (also claude/software-build-sublwz) · dbccfc5 (code), then this report commit
- What changed: added docs/DATA_PRIVACY_AND_GOVERNANCE.md (linked from README and ARCHITECTURE). While writing it, found and fixed three privacy gaps: phase 2's quote check fetched any model-cited URL outside the egress gate (now fenced to https official legal-source hosts, ledgered, off in --offline); the evidence summary sent real file paths to phases 1/4/5 (now pseudonymised); rehydrated model output was re-sent with real names (now resealed). Version 1.1.1. Earlier the same session added `addgp-lite ui` (1.1.0).
- Checks run: `bun test` → 148 pass, 0 fail. `bun x tsc --noEmit` → 0 errors.
- CI for this SHA: CI run 41059635491 on dbccfc5, completed, success (read from the run).
- Verified now / documented only / not verified: verified by tests: the fence (allowed, internal, look-alike, http, port, credential cases), reseal round trip, evidence summary has no real paths or names, UI token/host/method/CSP checks. Not verified: model-phase output quality (no live run in this session, no cassettes); OpenRouter/provider retention; dry-run cost accuracy; that temperature 0 gives repeatable output.
- What may and may not be claimed: may say model calls go only to openrouter.ai, and the one other request is a fenced, body-less GET of a cited legal page. May not say "only openrouter.ai is ever contacted". May not say the project description is pseudonymised (it is sent as written). May not claim UAE practitioner review or any certification; the UAE pack is standard depth, 3 instruments, 3 seed obligations, and there is no Emirates ID pattern.
- Open bugs and risks: v1.1.0 draft release predates the fixes and must not be published. No Emirates ID detector. Description sent un-pseudonymised by design. Binaries unsigned.
- Decisions needed from the founder: delete the v1.1.0 draft on the Releases page; approve cutting 1.1.1 via Actions → Release → 1.1.1.
- Next step: release 1.1.1; add an Emirates ID pattern; record cassettes from a real run.

