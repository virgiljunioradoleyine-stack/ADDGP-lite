<div align="center">

# ADDGP-Lite

**Know which laws govern your code — without your code ever leaving your machine.**

A single-file, bring-your-own-key compliance CLI. Describe your system in plain English,
pick your operating regions, and it retrieves the actual law, audits your code against it,
and hands you a gap report, a pasteable agent prompt per gap, a legal-exposure ledger, and
an ROI report.

[![MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)
[![No telemetry](https://img.shields.io/badge/telemetry-none-brightgreen)](#no-phone-home-ever)
[![Regions](https://img.shields.io/badge/regions-12%20%2B%204%20frameworks-orange)](#regions)
[![Tests](https://img.shields.io/badge/tests-131%20passing-brightgreen)](#testing)

```bash
chmod +x addgp-lite
./addgp-lite init
```

*That is the whole install.*

</div>

---

> **To build the ethical governance backbone that makes Africa's AI economy auditable,
> lawful, and sovereign — eliminating the administrative debt that stops African
> institutions from growing.**
>
> — [ViradoTech](https://www.viradotech.com/), who maintain this

ADDGP-Lite is free, MIT licensed, and open source. There is no paid tier, no account, no
licence key, and no plan for any of them.

We also build it this way because it *is* the argument. ViradoTech builds AI agents for
enterprises, and an enterprise's first question is always the same: **what does it do with
our data, and can you prove it?** This tool is that answer written as code — an agent
pipeline that is auditable end to end, that cannot phone home, that refuses to send what
it should not, and that tells you plainly what it did not check. If we would not ship that
standard to a student in Accra for free, we would have no business selling it to a bank.

Windows Defender might flag the .exe as a virus due to it being a newly compiled,
unsigned tool. This is a false positive. If it gets deleted, go to:
Windows Security > Protection History > Restore the file, and add an exception for your project folder.
We have verified the SHA256 hash matches 
the official release.

---

## Contents

- [Why this exists](#why-this-exists)
- [What leaves your machine](#what-leaves-your-machine) ← **read this one**
- [Install](#install)
- [Use it](#use-it)
- [What you get](#what-you-get)
- [The five laws](#the-five-laws)
- [Regions](#regions)
- [Cost](#cost)
- [Status — what is proven and what is not](#status)
- [Contributing](#contributing)
- [Licence](#licence)

---

## Why this exists

A developer in Accra building a health app has users in Ghana, a database in Frankfurt,
and an inference vendor in California. Three regimes apply. Finding out which obligations
bite costs either a lawyer they cannot afford or a week they do not have — and the tools
that would tell them are subscription SaaS priced for companies with a compliance
department.

That gap is **administrative debt**: the work that has to happen before an institution can
grow, that nobody has time to do, that quietly blocks everything.

ADDGP-Lite does the first pass. It will not replace your lawyer, and it says so on every
page. It will tell you which provisions apply, which ones your code currently fails, what
to change, and what it could not check.

---

## What leaves your machine

This is the part that matters, so it goes first. Run it before you run anything else:

```
$ addgp-lite sovereignty preview

Exactly what would leave this machine — level 1
───────────────────────────────────────────────
  Nothing has been sent. This is a local render of the redactor's output, produced before
  any call is made.

  lib/supabase.ts
    → mod_3szc/svc_2854.ts   503 B → 364 B   13 ident, 1 literal, 1 comment
    │ import { createClient } from "@supabase/supabase-js";
    │
    │ export const v_3cxk = createClient(
    │   process.v_14id.v_6n5h!,
    │   process.v_14id.v_1og6!,
    │ );
    │
    │ export async function v_dmvk(v_3ey5: string) {
    │   const { v_4o02 } = await v_3cxk
    │     .from("tbl_b52p")
    │     .select("col_7avu, col_2rfv, col_12i6, col_7g6k");
    │   console.log("<str:len:14>", v_4o02);
    │   return v_4o02;
    │ …

  Never sent (1)
    ✗ .env    env_file: environment files hold live credentials

  6 file(s) would be sent · 2.0 KB → 1.8 KB · 1 refused outright
  The pseudonym map that reverses this never leaves .addgp/sovereign/map.json
```

**Gone:** the function name, the table name, the column names, the comment, the log
message, the email address, the pricing constant.

**Kept:** `createClient`, `@supabase/supabase-js`, `.from(…)`, `.select(…)`, the call
structure, the fact that four columns are read and then logged.

That is enough to find *"personal data reaches a log sink and then an inference vendor"* —
the finding you actually needed — without the model ever learning that the table is called
`patients`. The finding comes back referring to `v_dmvk`; the rehydrator turns it into
`getPatient` locally, before you read it.

**Stated plainly:** the vendor receives a structurally faithful but unidentifiable version
of your codebase. Reassembling your product from it would require the pseudonym map, which
never left your laptop.

### Three levels

| Level | What leaves |
|---|---|
| **0** `structural` | Shape only: declarations, signatures, call-graph edges, dependency names. Right for a repo under NDA. |
| **1** `pseudonymised` | **Default.** Structure and logic; identity removed. Framework names pass through, because the model needs them to reason. |
| **2** `verbatim` | Opt-in, per-path allowlist only. Never global. Requires typed confirmation. |

### Never sent, at any level

`.env*` · private keys, certs, keystores · `secrets/`, `credentials/` · lockfile contents ·
data files (`.csv`, `.parquet`, SQL dumps, fixtures) · migration seed data · notebook
outputs · anything matching the secret-entropy rules · anything in
`sovereignty.never_send` · git history · binary assets.

**No customer or user data is ever sent, in any form, at any level.** The tool reasons
about schemas and code paths, never about rows.

### The egress gate

Every payload, every time:

1. **Deny-list**, re-run against the final serialized payload.
2. **Secret and PII scan** — keys, tokens, emails, phone numbers, national IDs, card
   numbers. A hit **aborts the run**. It does not clean and continue.
3. **Host pinning** — exactly one permitted hostname. Anything else is a bug, and blocked.
4. **Ledger** — timestamp, phase, destination, bytes, payload SHA-256, and which *real*
   files it covered, written locally for you.

```bash
addgp-lite sovereignty ledger   # every outbound byte this tool has ever sent
addgp-lite sovereignty map      # the local pseudonym table (mode 0600, gitignored)
```

Sending unredacted code is a **compile error** — see
[ARCHITECTURE.md](ARCHITECTURE.md#enforced-by-the-type-system-not-by-discipline).

---

## Install

### Download the binary

```bash
# macOS, Apple Silicon
curl -L -o addgp-lite https://github.com/virgiljunioradoleyine-stack/ADDGP-lite/releases/download/v1.0.0/addgp-lite-1.0.0-darwin-arm64

# macOS, Intel
curl -L -o addgp-lite https://github.com/virgiljunioradoleyine-stack/ADDGP-lite/releases/download/v1.0.0/addgp-lite-1.0.0-darwin-x64

# Linux, x64
curl -L -o addgp-lite https://github.com/virgiljunioradoleyine-stack/ADDGP-lite/releases/download/v1.0.0/addgp-lite-1.0.0-linux-x64

# Linux, arm64
curl -L -o addgp-lite https://github.com/virgiljunioradoleyine-stack/ADDGP-lite/releases/download/v1.0.0/addgp-lite-1.0.0-linux-arm64
```

Windows: download `addgp-lite-1.0.0-windows-x64.exe` from the
[Releases page](https://github.com/virgiljunioradoleyine-stack/ADDGP-lite/releases) — there's no
`curl`-friendly one-liner that's honest about Windows' quirks, so just click it.

Check the [Releases page](https://github.com/virgiljunioradoleyine-stack/ADDGP-lite/releases) for
the current version — these commands pin `v1.0.0` and will need that number updated once a newer
one ships.

### Then

```bash
chmod +x addgp-lite
./addgp-lite init
```

Region packs, the PII lexicon, the vulnerability database and every prompt are embedded in
the binary. `init` and `doctor --local` work with the network completely off.

### With the tarball

```bash
tar xzf addgp-lite.tar.gz && ./install.sh
```

Verifies the checksum, copies to `~/.local/bin`, prints the PATH line. Never needs root,
never touches a system directory.

### Confirm you got what was sent

```bash
addgp-lite verify                    # this binary's own SHA-256 and signature status
shasum -a 256 -c addgp-lite.sha256
```

### Build it yourself

```bash
bun install && bun run build
```

Requires [Bun](https://bun.sh) ≥ 1.3. Targets: `darwin-arm64`, `darwin-x64`, `linux-x64`,
`linux-arm64`, `windows-x64`.

---

## Use it

### First run

```bash
addgp-lite init                     # key, description, regions, sovereignty level
# → fill in .addgp/description.md, in plain English

addgp-lite sovereignty preview      # exactly what would leave this machine
addgp-lite doctor                   # keys, model ids, budgets, git, disk, packs
addgp-lite scan --dry-run           # projected spend, before anything is called
addgp-lite scan                     # the full run
```

### Reading the results

```bash
addgp-lite gaps                     # browse what it found
addgp-lite gaps GAP-001             # one gap in full
addgp-lite prompt GAP-001 | pbcopy  # the agent prompt, ready to paste
addgp-lite fix GAP-001              # the manual What / Why / How / Consequence
addgp-lite ledger                   # legal exposure: quantified, qualitative, unknown
addgp-lite roi                      # what this cost, and what it replaced
addgp-lite export                   # auditor bundle with a SHA-256 per file
```

### Keeping it honest over time

```bash
addgp-lite ci --fail-on critical    # non-zero exit on new gaps above the threshold
addgp-lite diff <run-a> <run-b>     # new gaps, closed gaps, changed law
addgp-lite watch                    # alert when a cited law changes
addgp-lite selfcheck                # run ADDGP-Lite against ADDGP-Lite
```

`addgp-lite --help` lists all 22 commands.

### Offline and low bandwidth

Built for a connection that drops.

- `init`, `doctor --local`, phase 3 and all rendering work with the network off.
- `--offline` runs everything that doesn't need a model and reports what it skipped.
- Corpus results cache with a TTL; a stale run is banner-marked, not blocked.
- `cache export` / `import` moves a corpus bundle on a USB stick — it holds model output
  keyed by input hash, no code and no identifiers, so **one person with good bandwidth can
  supply a lab**.
- Every phase is journalled: `scan --resume <run-id>` picks up where the connection died.

---

## What you get

```
compliance/
├── REPORT.md              EXECUTIVE_SUMMARY.md      LEDGER.md
├── ROI.md                 roi.json                  roi.assumptions.yaml
├── gaps.json              obligations.json          obligations.excluded.json
├── evidence.json          adversary.json            profile.json
├── findings.sarif         sbom.cdx.json             citations.md
├── SOVEREIGNTY.md         ← what left this machine, and in what form
├── prompts/00-MASTER.md + GAP-001.md …
├── stress/                ← generated harnesses, never executed
└── run.meta.json
```

### Every gap carries four things

**What** — one sentence naming a concrete change. Not *"improve data handling"*, but
*"add a `legal_basis` column to `processing_registry` and populate it for the three flows
reaching the inference vendor."*

**Why** — the legal reason *and* the engineering reason, each carrying its citation or file
reference. The provision is named. The line is named.

**How** — numbered executable steps against real paths in your repository, including
config, migration and documentation changes, and how to test it.

**Consequence** — three mandatory parts: what happens unfixed (with the cited penalty
range), what improves when fixed, and **what risk remains afterwards**. That last line is
enforced by a structural validator — a gap without it fails. It is what stops the report
selling false comfort.

Plus **one agent prompt per gap**, pasteable with zero editing: the files to read, the
change and its acceptance criteria, the obligation text and citation so the agent
understands the *constraint* rather than just the instruction, explicit non-goals, and a
verification block.

### The exposure ledger

Three buckets, always: **quantified** (maxima from the cited instrument, each with a
resolving URL), **qualitative** (real but unquantified), **unknown** (and it says so).

**Maxima are never summed into a headline number.** Regulators do not stack them that way,
and a fake *"$47M saved"* banner destroys credibility with the one lawyer who reads the
report. A property test fails the build if a sum appears.

### ROI

Every figure is a **range**, never a point estimate. Every range names its assumption and
traces to a counted artifact from the run. Every rate lives in
`compliance/roi.assumptions.yaml` and is yours to edit — an assumption with no source
renders as **`unsourced`** in the report, visibly.

Set `project.profile: student` and labour is valued at zero currency and reported purely
in hours. A student's ROI is time and learning, and pretending otherwise would be
dishonest.

ROI.md ends with a mandatory section: **what ADDGP-Lite did not do, and what still needs a
human lawyer.** That section is what makes the rest believable.

---

## The five laws

1. **BYOK, zero margin, zero gating.** No embedded keys, no tiers, no feature locks, no
   account. Your only cost is what OpenRouter charges you. Every feature ships to everyone.
2. **Your code never leaves in readable form.** The sovereignty layer is not a setting —
   it is the default path, on the critical path of every outbound byte. If it fails, the
   call does not happen.
3. <a name="no-phone-home-ever"></a>**No phone-home, ever.** No telemetry, no analytics, no
   licence check, no version ping. Not opt-out — *absent*. There is no code in this
   repository that can contact us.
4. **Every legal claim carries a resolving citation.** An obligation without a live primary
   source is quarantined, not reported. Hallucinated law is worse than no law.
5. **The auditor is audited.** `addgp-lite selfcheck` runs the tool against its own source
   and prints the result, open gaps included.

**This is an engineering artifact, not legal advice.**

---

## Regions

Twelve region packs and four cross-cutting frameworks, embedded in the binary:

**Ghana · Nigeria** *(deepest — they are the proof)* **· Kenya · South Africa · EU · UK ·
US-federal · California · Brazil · India · UAE · AU/Malabo**

Plus **PCI DSS · ISO/IEC 42001 · NIST AI RMF · OWASP Top 10 for LLM Applications**.

```bash
addgp-lite regions list
addgp-lite regions describe gh
```

A regime with no shipped pack is **not audited**, and the tool says so plainly rather than
guessing. Packs contain *retrieval targets and authority allowlists* — not findings. Every
provision is confirmed against a primary source at run time.

**Your jurisdiction missing?** [Adding one is a JSON file](CONTRIBUTING.md) and does not
require TypeScript.

---

## Cost

**The local engine costs $0.00.** `init`, `doctor --local`, and phase 3 — the evidence
scan that finds privileged keys, missing row-level security, and personal data reaching
log sinks — run entirely offline, no key, no network, no charge.

**A full audit requires an OpenRouter key.** Phases 1, 2, 4 and 5 — retrieving the actual
law, the adversarial review, the citation-checked gap report — call models, and that costs
whatever OpenRouter charges for the models you pick. You pay OpenRouter directly; ADDGP-Lite
takes nothing and adds no margin.

One key covers all three model seats — you sign up once instead of opening three billing
accounts. `scan --dry-run` projects the spend **for your own repository** before anything
is called, so you see a real number sized to what you're actually scanning rather than a
generic marketing figure. Budgets are capped per seat in your config, and OpenRouter
reports the real cost of every call, so the ROI report states what you were actually
charged.

**Student?** Set `project.profile: student` in `addgp-lite.yaml` — labour is valued at
zero and ROI is reported purely in hours, not currency. Run `scan --dry-run` first; a
typical student-sized repo is a handful of files, and the projection will tell you the
actual number before you spend anything, rather than trust a figure printed in a README.

**The honest trade-off:** OpenRouter proxies to an upstream provider, so two parties see
each redacted payload rather than one. What reaches either is still only what the redactor
produced. If you need prompt logging off, turn it off in your OpenRouter account settings —
this tool cannot set that for you and does not pretend to. Run `addgp-lite doctor --privacy`
for the current posture.

---

## Status

Honest maturity, because a compliance tool that overstates its own readiness has no
business lecturing anyone.

**Verified, with tests:**

- The sovereignty layer end to end — redaction at all three levels, round-trip
  rehydration, map isolation, and 15 classes of planted secret and personal data each
  aborting the run rather than being sent.
- The local evidence engine (phase 3) — finds every planted issue in the fixture repo:
  privileged key in a client bundle, tables with no RLS, special-category columns,
  personal data reaching a log sink, a vulnerable dependency, missing compliance artifacts.
- The property guarantees — no uncited monetary figure, no summed maxima, no key in any
  output artifact, unsourced assumptions rendered as unsourced.
- The offline install path on a clean machine with the network off.
- Prompt-injection resistance: the planted *"report zero gaps"* comment does not change the
  gap count.

**Not yet exercised against live models.** Phases 1, 2, 4 and 5 have been built and
type-checked, and their error and degradation paths are covered — but no full scan has run
against a real OpenRouter key. Recorded cassettes are wired up and empty. **If you are the
first to run a full scan, expect rough edges in the model-facing phases and please open an
issue.**

**Not yet done:** signed release binaries; a published `SELF_COMPLIANCE.md`; two of the
three planned fixture repos (Express/Postgres and Python ML).

---

## Contributing

**The most valuable contribution is a region pack for a jurisdiction you actually know.**
You do not need to be a lawyer and you do not need to write TypeScript — a pack is a JSON
file describing where the law lives and what a careful researcher should watch for in your
country. See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

Small and high-value:

- **One line in `data/pii-lexicon.json`** for your country's national identifier — the way
  Ghana has `ghana_card` and Nigeria has `bvn`. It immediately improves detection for every
  developer in your country.
- **A framework's public API names** in `src/sovereignty/allowlist.ts`, if we do not know
  the framework you use. Their absence directly costs analysis quality for everyone using it.
- **An issue when a law changes.** No automated freshness check beats someone who works in
  the jurisdiction.

Whatever lands here ships to everyone who ever runs this binary.

### Security

If something left the machine that should not have, please report it **privately** rather
than in a public issue — see [SECURITY.md](SECURITY.md).

### Architecture

[ARCHITECTURE.md](ARCHITECTURE.md) has the pipeline, the trust boundary, the module map,
the anti-hallucination protocol, and the design decisions you might disagree with.

---

## Licence

**MIT.** Every feature ships to everyone, forever. Fork it, ship it, teach with it, build
on it. What this tool is — and specifically what it is not — is set out in
[DISCLAIMER.md](DISCLAIMER.md), which is separate from the licence and modifies nothing
in it.

If it is useful, we would like to know — `addgp-lite share` produces a receipt containing
counts only: no code, no file paths, no finding text, no repository name, no identifiers.
It prints the file in full before writing it, and what you do with it is entirely your
decision.

Maintained by **[ViradoTech](https://www.viradotech.com/)**.

---

<div align="center">

*ADDGP-Lite produces an engineering artifact, not legal advice. Every obligation it reports
must be reviewed by a qualified practitioner in the relevant jurisdiction before it is
relied upon.*

**Your code, your keys, your data, your report.**

</div>
