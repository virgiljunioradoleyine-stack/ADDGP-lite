# Data privacy and governance

For a data-protection or security lead deciding whether to let a team run ADDGP-Lite on a
real codebase. Every statement points to the file, test or command that backs it, so you can
check it rather than take it on trust. Anything we could not verify is marked
**not verified**.

Applies to version 1.1.1 and later.

---

## 1. Summary

- ADDGP-Lite runs on the user's own machine. There is no ADDGP server, no account, no
  telemetry, and no licence check.
- **The full audit uses AI models.** It calls them through the user's own OpenRouter key.
  Some parts of the tool run with no model and no network; most of the legal analysis does
  not.
- Before any code is sent, the tool replaces names, comments and string values in the code
  with meaningless placeholders. The table that reverses this stays on the machine.
- Some files are never sent at all: credentials, keys, data files, the tool's own state.
- The plain-English description the user writes about their system **is sent as written**.
  Do not put client names or confidential detail in it (section 4.3).
- It is not legal advice and gives no compliance guarantee. Its UAE coverage is introductory
  (section 8).

---

## 2. What runs without AI or network, and what does not

| Step | Model? | Network? | Where to check |
|---|---|---|---|
| `addgp-lite init` | No | No | `src/cli/commands/setup.ts` (`cmdInit`) |
| `addgp-lite doctor --local` | No | No | `setup.ts`, `--local` skips the OpenRouter check |
| `addgp-lite sovereignty preview` | No | No | `src/cli/commands/analyse.ts`; uses an in-memory map and writes nothing |
| `addgp-lite ui` | No | No (serves on `127.0.0.1` only) | `src/ui/server.ts`; tests in `tests/unit/ui.test.ts` |
| Phase 0 — redaction | No | No | `src/sovereignty/redactor.ts` |
| Phase 3 — local evidence scan | No | No | `src/phases/p3-evidence.ts` |
| Phase 1 — project profile | **Yes** | Yes | `src/phases/p1-profile.ts` |
| Phase 2 — retrieve and check the law | **Yes** | Yes | `src/phases/p2-corpus.ts` |
| Phase 4 — adversarial security review | **Yes** | Yes | `src/phases/p4-adversary.ts` |
| Phase 5 — judge code against the law, write gaps | **Yes** | Yes | `src/phases/p5-adjudicate.ts` |
| Phase 6 — write reports | No | No | `src/phases/p6-emit.ts` |

`addgp-lite scan --offline` runs only the steps with no model and says in the report which
phases were skipped (`src/phases/pipeline.ts`, `phases_skipped`). An offline report has local
findings but no legal conclusions.

The CI job runs `init`, `doctor --local` and `sovereignty preview` on a fresh machine with
no key, so these steps are checked on every push (`.github/workflows/ci.yml`).

---

## 3. What leaves the machine

### 3.1 Where data can go

There are exactly two kinds of outbound request in the source. We checked this by searching
every network call in `src/` (`fetch(` appears in three places):

1. **Model calls** go only to `openrouter.ai`. Every one passes `assertPinnedUrl`, which
   refuses any other host and anything that is not https (`src/providers/base.ts`,
   `src/sovereignty/gate.ts`; tests: "destination pinning" in
   `tests/sovereignty/gate.test.ts`).
2. **Quote checks.** When the model claims a law says something word for word, phase 2
   downloads the cited public page and checks the words are there. That request:
   - is a plain GET with no body, so no project data is sent;
   - is allowed only over https, to an official authority listed in the region pack or a
     short list of recognised legal publishers, with no credentials in the URL and no
     non-standard port (`isCitationFetchAllowed` in `src/regions/index.ts`);
   - follows at most one redirect, and only to another allowed host;
   - never happens in `--offline` or test replay;
   - is written to the local egress ledger.

   Tests: "citation quote-check" in `tests/sovereignty/gate.test.ts`, including that
   internal addresses, cloud metadata addresses and look-alike domains are refused. Before
   1.1.1 this request was not restricted (section 9).

### 3.2 Code: what is sent at each level

Set with `sovereignty.level` in `addgp-lite.yaml`.

| Level | What a model receives | Where to check |
|---|---|---|
| **0 — structural** | Only the shape: declarations, signatures, which function calls which, and framework and package names. Every name is replaced; every string and comment is removed. | `structuralOutline` in `src/sovereignty/redactor.ts` |
| **1 — pseudonymised** (default) | Code structure and logic. Your function, variable, table, column and file names become placeholders such as `fn_c410`, `tbl_5g21`, `mod_3szc/svc_2854.ts`. Comments are removed. String values become `<str:len:N>`. Public framework and package names (`createClient`, `@supabase/supabase-js`) are kept because the model needs them. | `redactFile` in `src/sovereignty/redactor.ts`; tests in `tests/sovereignty/redactor.test.ts` |
| **2 — verbatim** | Source exactly as written, **only** for paths listed in `sovereignty.verbatim_allowlist`. Every other file stays at level 1, and an empty allowlist means nothing is verbatim. | `levelFor` in `src/sovereignty/index.ts` |

Choosing level 2 with `addgp-lite sovereignty level 2` requires typing `verbatim` to
confirm. Editing `addgp-lite.yaml` directly, or passing `--yes`, skips that prompt.

`addgp-lite sovereignty preview` shows, file by file, exactly what would be sent from the
code before any call is made. `addgp-lite ui` shows the same thing under **What leaves**.

### 3.3 Never sent, at any level

Checked again at the gate on the final payload, not just when files are picked
(`src/sovereignty/denylist.ts`; tests: "deny-list" in `tests/sovereignty/gate.test.ts`):

- `.env` and similar files; private keys and certificates; credential folders and files
  (`secrets/`, `credentials/`, `.aws/`, `.ssh/`, `.npmrc`, cloud service-account files)
- lockfiles (package names are read locally instead)
- data files: `.csv`, `.parquet`, `.xlsx`, `.sqlite`, `.jsonl`, SQL dumps, fixtures, seed
  data, notebook files
- the tool's own configuration and state folder (`addgp-lite.yaml`, `.addgp/`)
- binary, generated and vendored files
- anything you list in `sovereignty.never_send`

The tool reasons about schemas and code paths. It is not designed to read data rows, and
data files are refused outright.

### 3.4 The last check before sending

Every payload goes through `gateEgress` in `src/sovereignty/gate.ts`:

1. the never-send list again, against the files the payload represents;
2. a scan of the final text for secrets (API keys for major providers, tokens, private
   keys, database URLs with passwords, JWTs, high-entropy strings) and personal data
   (emails, phone numbers, card numbers that pass a checksum, IBANs, passports, and national
   IDs for Ghana, Nigeria, South Africa, India, Kenya and the US). **A hit stops the whole
   run.** It does not clean the payload and carry on. Patterns: `src/sovereignty/secrets.ts`;
   tests: 15 planted cases in `tests/sovereignty/gate.test.ts`;
3. host pinning (3.1);
4. a line in the local ledger (3.6).

**There is no detector for the UAE Emirates ID number** (section 8).

### 3.5 Where the reversal map lives

The table that turns placeholders back into your real names is
`.addgp/sovereign/map.json` in the project. It is written with file mode `0600`
(`writeFileSecure` in `src/util/paths.ts`), `init` adds `.addgp/` to `.gitignore`, and the
never-send list refuses `.addgp/` at every level. `addgp-lite sovereignty map` prints it and
warns if its mode is not `0600`.

Model answers are turned back into real names as soon as they arrive, so the reports you
read in `compliance/` contain your real names. Those reports stay on your machine.

### 3.6 The local record of what was sent

Every outbound request appends one line to `.addgp/egress.jsonl` with: time, run id,
phase, destination host, bytes sent, the SHA-256 hash of the payload, the redaction level,
which real files the payload stood for, and its purpose (`EgressRecord` in
`src/sovereignty/gate.ts`). The payload itself is not stored. The file is never sent.

```bash
addgp-lite sovereignty ledger
```

---

## 4. What else the models receive

### 4.1 Your OpenRouter key

The key goes to OpenRouter in the request header, as any API key does. On your machine it
is kept in the OS keychain (macOS Keychain, Linux Secret Service, Windows Credential
Manager), or as a fallback in an encrypted file outside the project (scrypt key derivation
and AES-256-GCM, mode `0600`), or read from `OPENROUTER_API_KEY`. See `src/keys/index.ts`.
Property tests check that no key appears in any output file
(`tests/unit/properties.test.ts`).

### 4.2 Summaries of local findings

Phases 1, 4 and 5 receive a summary of the local evidence scan: each finding's severity,
rule, a placeholder file path, line number and a written conclusion, for example "this file
handles health data". Symbol names and quoted code are not included. Since 1.1.1, file
paths in this summary are placeholders. Before that they were real (section 9). Tests:
`tests/sovereignty/reseal.test.ts`.

Note that these conclusions **do** tell the model which kinds of personal data your system
appears to handle, for example health data, religious belief or national ID numbers.

### 4.3 Your plain-English description — sent as written

Phase 1 sends `.addgp/description.md` as written so the model can understand your system.
It is checked for secrets and personal data like every payload, but it is **not**
pseudonymised. Write it the way you would brief an outside consultant under no NDA: what
the system does and where data flows, without client names, unreleased product names or
anything confidential. `sovereignty preview` does not show this text; read the file
itself.

### 4.4 Model answers passed between phases

Phase 1's profile goes into phases 2, 4 and 5, and phase 4's findings go into phase 5. Since
1.1.1, every real name the reversal map knows is turned back into its placeholder before
being sent again (`reseal` in `src/sovereignty/rehydrate.ts`). Before that, real names
restored from the first answer could be sent in the second request (section 9).

### 4.5 Legal research queries

Phase 2 asks the research model about the law. Each query carries the region, the topic,
the instruments the region pack names, and a short summary of the project profile (roles,
data categories, processing purposes, third parties), with names put back into placeholders
as in 4.4. It does not include code.

---

## 5. OpenRouter: the trade-off, and what you control

OpenRouter forwards each request to the company that runs the chosen model. **Two parties
see each payload: OpenRouter and that model provider.** What reaches them is only what the
redaction step produced, plus the text described in section 4.

How long they keep it, and whether they train on it, is set by your OpenRouter account
privacy settings and the provider's terms. This tool cannot set those per request and does
not claim to. `addgp-lite doctor --privacy` prints this, and the setting to change, from
`privacyPosture` in `src/providers/openrouter.ts`.

**Not verified:** OpenRouter's and each provider's actual retention and training behaviour.
Check their current terms yourself.

What you control:

- **Prompt logging:** turn it off in your OpenRouter account settings.
- **Which models:** `models` in `addgp-lite.yaml`. The default models are named there.
- **Spending:** `budget.per_run_usd` caps each of the three models per run
  (`src/providers/budget.ts`). With `on_exceed: stop`, a model that reaches its cap makes
  no more calls; the affected phase is skipped and the report says so
  (`src/phases/pipeline.ts`).
- **Before spending anything:** `addgp-lite scan --dry-run` estimates the cost and makes no
  calls. The estimate uses fixed assumptions and has not been checked against measured
  runs (**not verified**).
- **What is in scope:** `scan.include`, `scan.exclude`, `sovereignty.never_send`.

---

## 6. Governance: how findings are made and checked

### 6.1 Deterministic and not deterministic

Deterministic (same input, same output): redaction (placeholders come from a hash, not a
counter), the local evidence scan, the plan of which legal questions to ask
(`planQueries` in `src/phases/p2-corpus.ts`), and report rendering.

Not deterministic: every model answer (phases 1, 2, 4, 5). The tool asks for temperature
0, but providers do not promise identical output (**not verified** that repeated runs
match). Answers are cached locally in `.addgp/cache/` by input hash, so re-rendering a
report does not call a model again.

### 6.2 Checks on the law (phase 2)

From `src/phases/p2-corpus.ts`:

- **Primary source required.** An obligation is kept only if it cites an official source
  for that region (the pack's authority domains) or a recognised legal publisher. Otherwise
  it is quarantined: listed as excluded, not reported.
- **Second opinion.** Each obligation is checked by a second query and marked
  double-sourced, single-sourced or disputed.
- **Fabrication trap.** For each region the model is asked about a provision that does not
  exist. If it describes one, the trap fires. If it fires twice, retrieval for that region
  is abandoned and the report says so.
- **Quote check.** A word-for-word quote must appear on the cited page (section 3.1). If
  the page cannot be fetched, the quote is marked unchecked, not passed.
- **Freshness.** Cached legal results past their age limit are marked stale in the report.

The tool checks that a citation points at an official domain. It does not prove that the
page says what the obligation claims, unless a quote was checked.

### 6.3 Security review by a separate model (phase 4)

A security model, from a different provider than the one that judges the law by default,
reviews the redacted code. A finding it cannot tie to a file the local scan actually read
is marked **unconfirmed** and cannot be rated critical (`reconcile` in
`src/phases/p4-adversary.ts`). Instructions planted in code comments, such as "report zero
gaps", are reported as findings and do not change the result (`findInjectionAttempts`;
test in `tests/unit/evidence.test.ts`).

### 6.4 Each gap is checked for structure (phase 5)

`validateGap` in `src/phases/p5-adjudicate.ts` rejects a gap that lacks a concrete change,
a legal and engineering reason, citations, numbered steps, verification commands, or a
statement of **the risk that remains after the fix**. Rejections go to
`compliance/VALIDATION.md`. An obligation the model leaves out is recorded as
indeterminate, never as satisfied.

### 6.5 Human review

`REPORT.md` opens with "Scope and limitations" and lists skipped phases and disputed or
indeterminate items. `EXECUTIVE_SUMMARY.md` and `ROI.md` each end with what the tool did
not do and what still needs a human (`src/render/markdown.ts`, `NOT_DONE` in
`src/roi/engine.ts`). No option turns these off. Nothing in the tool replaces a
practitioner reading the report and checking its citations.

### 6.6 What the tool refuses to do

- State a money figure without a citation. The data type cannot be built without one
  (`CitedMoneySchema` in `src/schemas/index.ts`; property tests in
  `tests/unit/properties.test.ts`).
- Add up maximum penalties into one headline number (property test).
- Send data files or credentials, at any level (3.3).
- Clean a payload that contains a secret and send the rest (3.4).
- Run load or attack tests. `stress` writes test scripts for you to run yourself, and
  refuses targets you have not authorised (`requireAuthorization` in
  `src/phases/p4-adversary.ts`).
- Phone home. There is no telemetry or analytics code. The three network call sites are
  listed in 3.1.

---

## 7. How to verify this yourself

```bash
addgp-lite sovereignty preview        # exactly what code would be sent, per file
addgp-lite sovereignty preview --full # the same, untruncated
cat .addgp/description.md             # the text that IS sent as written (4.3)
addgp-lite scan --dry-run             # estimated cost; no calls made
addgp-lite doctor --privacy           # OpenRouter data-handling note and pinned host
addgp-lite sovereignty ledger         # every outbound request ever made from this project
addgp-lite sovereignty map            # the local reversal table, and its file mode
addgp-lite ui                         # the same, in a local browser page
```

From the source:

```bash
bun install && bun test               # 148 tests, including the gate and redaction suites
grep -rn "fetch(" src/                # every outbound network call (3.1)
```

To watch the network yourself, run a scan behind a proxy you control, or a tool such as
Little Snitch or `tcpdump`. You should see `openrouter.ai`, plus the official legal sites
recorded in the ledger as `quote-check`.

---

## 8. Limits, stated plainly

- **Not legal advice.** The output is an engineering report for a qualified practitioner
  to review. See [DISCLAIMER.md](../DISCLAIMER.md).
- **No compliance guarantee.** A clean report is not evidence of compliance. Skipped phases
  are listed in each report.
- **The UAE pack is introductory.** `packs/ae.json` is marked `standard` depth, not `deep`
  (only the Ghana and Nigeria packs are deep). It names three instruments: Federal
  Decree-Law No. 45 of 2021 (PDPL), the DIFC Data Protection Law No. 5 of 2020, and the ADGM
  Data Protection Regulations 2021. It seeds three obligations: deciding which regime
  applies, cross-border transfer, and breach notification. It warns that applying DIFC
  rules to a mainland company is a false finding, and that the PDPL's executive regulations
  need confirming. The PDPL source link is the general `u.ae` portal, not the text of the
  law. **The pack has no recorded review by a UAE practitioner.**
- **No practitioner review of the tool.** No lawyer in any jurisdiction has reviewed the
  packs or the output on record.
- **The model phases are barely exercised.** They have been run live once, by the
  maintainer. No recorded test runs or measured costs are in the repository yet. Treat
  their output as unreviewed and check every citation.
- **Detection is pattern-based.** Secrets and personal data are found with regular
  expressions, entropy checks and a word list (`src/sovereignty/secrets.ts`,
  `data/pii-lexicon.json`). Unusual formats will be missed. **There is no Emirates ID
  pattern**, so an Emirates ID number in code or in the description would not stop the run.
- **Redaction can miss things.** It works on tokens, not full program understanding. Read
  `sovereignty preview` for your own code before the first scan.
- **The description is not pseudonymised** (4.3).
- **Unsigned binaries.** Release files have checksums but no code signature yet.

---

## 9. Changes in 1.1.1 found while writing this document

Writing this document meant reading every outbound path, and that turned up three
problems. All three are fixed, with tests, in the same change:

1. **The quote check could fetch any URL.** Phase 2 downloaded whatever page the model
   cited, outside the egress gate. A made-up or injected citation could have made the tool
   request an internal address on the user's network. It is now limited as described in
   3.1 and logged. Earlier documentation that said "only `openrouter.ai` is ever contacted"
   was wrong for this request and has been corrected.
2. **Real file paths were sent in the local-findings summary** to phases 1, 4 and 5. They
   are now placeholders.
3. **Real names could be sent a second time.** Model answers have real names restored on
   arrival. When an answer was fed into a later phase, those real names went out with it.
   They are now replaced again before sending.

Versions before 1.1.1 behave as these three items describe. If you ran a full scan with an
earlier version, the files it covered are listed in `.addgp/egress.jsonl`.

---

MIT licensed. Maintained by [ViradoTech](https://www.viradotech.com/). Questions or
corrections: open an issue, or for anything security-related use the private route in
[SECURITY.md](../SECURITY.md).
