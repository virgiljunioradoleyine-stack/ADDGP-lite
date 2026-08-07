# Contributing to ADDGP-Lite

The most valuable contribution to this project is **a region pack for a jurisdiction
you actually know**. You do not need to be a lawyer, and you do not need to write
TypeScript.

If you have ever had to work out what your country's data protection law requires of
a piece of software, you already know something this project needs.

---

## The rule that governs everything here

**A pack contains retrieval targets, not findings.**

Nothing in `packs/` is ever reported to a user as law. A pack tells the tool *where to
look* and *which sources count as authoritative*. At run time, phase 2 retrieves the
actual provision, verifies it against a primary source, re-queries it independently,
and quarantines anything it cannot resolve.

This matters because of Law 4 of the project: *every legal claim carries a resolving
citation, and hallucinated law is worse than no law.* If you write a provision number
into a pack and it turns out to be wrong, the tool will not repeat it — it will fail to
confirm it and exclude it with a reason. That is the design working.

So: contribute what you know, mark what you are unsure of, and let the verification
protocol do the rest.

---

## Adding a region pack

### 1. Copy the closest existing pack

`packs/gh.json` (Ghana) and `packs/ng.json` (Nigeria) are the deepest and the best
templates. Copy one to `packs/<your-iso-code>.json`.

### 2. Fill in the shape

```jsonc
{
  "id": "tz",                    // short id the user types: `regions add tz`
  "name": "Tanzania",
  "kind": "region",              // "region" or "framework"
  "depth": "standard",           // "deep" once it has been reviewed by someone local
  "currency": "TZS",

  "regulator": {
    "name": "Personal Data Protection Commission",
    "url": "https://..."
  },

  // Hosts that count as a PRIMARY source for this regime. This is the most
  // important field in the file: an obligation whose citation is not on this
  // list (or a recognised legal publisher) is quarantined, not reported.
  // Put the gazette, the regulator, the legislature, the courts. Not blogs,
  // not law-firm briefings, not news sites.
  "authorities": ["pdpc.go.tz", "parliament.go.tz", "gazette.go.tz"],

  "instruments": [
    {
      "id": "tz-pdpa-2022",
      "name": "Personal Data Protection Act, 2022",
      "type": "act",             // act | regulation | directive | treaty | standard | guidance
      "in_force": true,
      "url": "https://..."       // must resolve
    }
  ],

  // What a retrieval query for this facet should pay attention to in THIS
  // jurisdiction. Write these as notes to a careful researcher who does not
  // know the country. The local knowledge goes here.
  "facet_hints": {
    "registration": "Tanzania requires registration of data controllers; confirm the current threshold, fee and renewal period with the Commission.",
    "cross_border": "Confirm the conditions for transfer outside Tanzania and whether the Commission has issued an adequacy list."
  },

  "seed_obligations": [
    {
      "id": "tz-pdpa-registration",
      "provision": "Registration of data controllers",   // a heading is fine if you are unsure of the section number
      "title": "Register with the Commission",
      "facets": ["registration"],
      "applies_when": ["processes personal data of individuals in Tanzania"],
      "testable_as": [
        "evidence of a current registration certificate",
        "a renewal date tracked somewhere the team will see it"
      ],
      "note": "Optional. Anything the retrieval phase should be careful about."
    }
  ],

  "notes": "Optional. Anything a reviewer of this pack should know."
}
```

### 3. The facets you can write hints for

`personal_data` · `special_categories` · `children` · `biometrics` · `cross_border` ·
`automated_decisions` · `ai_classification` · `breach_notification` · `registration` ·
`dpia` · `retention` · `security_of_processing` · `ropa` · `processor_terms` ·
`consent_marketing` · `data_subject_rights` · `dpo` · `governance` · `enforcement`

You do not need to fill in all of them. Fill in the ones where your jurisdiction does
something **different from the obvious**, and leave the rest — the tool has a sensible
default description for each.

Facet hints are where local knowledge is worth the most. "Ghana operates a data
controller registration regime that startups routinely miss" is worth more than a
paragraph restating the definition of personal data.

### 4. Rebuild and check it

```bash
bun run embed          # packs are embedded into the binary at build time
bun test               # the pack schema is validated
bun run src/cli/main.ts regions describe tz
```

`regions describe` prints exactly what a user will see. If it reads badly, fix it there.

### 5. Open a pull request

Tell us in the description:

- **Which parts you are confident about**, and which are your best guess.
- **Whether you have practised, studied, or worked under this regime**, or whether you
  are going from public sources. Both are welcome; we just need to know which.
- **Anything in motion** — a bill in progress, rules not yet commenced, a regulator
  that has just been constituted.

We will not ask you to certify anything. Nobody is relying on your pack as legal
advice, because the tool never presents it as such.

### What makes a pack `deep`

A pack is marked `"depth": "deep"` when someone who works under that regime has read it
and said it reflects practice — not just statute. Ghana and Nigeria are deep. If you can
do that for your jurisdiction, say so in the PR and we will mark it.

---

## Other ways to contribute

### Report a law that changed

Open an issue with the **Law changed** template. Include the instrument, what changed,
and a link to a primary source. This is genuinely useful: the corpus is only as good as
its freshness, and no automated check beats a person who works in the jurisdiction.

### Add to the PII lexicon

`data/pii-lexicon.json` maps identifier names to data categories. If your country has a
national identifier with a distinctive column name — the way Ghana has `ghana_card`,
Nigeria has `bvn` and `nin`, India has `aadhaar` — add it. This is a one-line change that
immediately improves detection for every user in your country.

Mark `"special": true` if the identifier is treated as sensitive in your regime, and list
the affected region ids.

### Improve the detectors

`src/sovereignty/secrets.ts` holds the patterns that stop a secret or a national ID from
ever leaving the machine. If you know a format we do not detect, add it — with a test in
`tests/sovereignty/gate.test.ts` proving it aborts the run.

**Be careful about false positives here.** A pattern that matches too eagerly will abort
runs on clean code, and users will disable the thing that protects them. Every pattern
needs both a positive test and a negative one.

### Improve the framework allowlist

`src/sovereignty/allowlist.ts` lists identifiers that are *not* pseudonymised, because
the model needs them to reason. If you use a framework we do not know, its public API
names belong here — and their absence is directly costing analysis quality for everyone
who uses that framework.

The rule for adding: it must be a name that exists in a public framework, standard
library, or protocol. If a name could plausibly be someone's domain vocabulary, it does
not belong on this list.

---

## Working on the code

```bash
bun install
bun run embed          # packs, prompts and data → src/generated/embedded.ts
bun test
bun x tsc --noEmit
bun run build          # single self-contained binary
```

### Two rules that are not negotiable

**No prompt string is ever written inline in TypeScript.** Every prompt is a versioned
file in `prompts/`, loaded at runtime and hashed into the cache key. This is what makes
runs reproducible and prompts reviewable by someone who is not a programmer — which
matters when the prompt is instructing a model about law.

**No provider client accepts a raw payload.** `providers/base.ts` takes a `SealedPayload`
and nothing else, and only `sovereignty/seal.ts` can construct one. Sending unredacted
code is a compile error, not a code-review question. If you find yourself wanting to
widen this, that is the signal to stop and open an issue instead.

### The sovereignty suite is security-critical

`tests/sovereignty/` gates the build. If you change the redactor, the deny-list, the
detectors, or the egress gate, the tests must still pass — and a change that weakens a
protection needs to say so explicitly in the PR description.

### Things we will push back on

- Anything that phones home. There is no telemetry in this tool and there will not be.
- Anything that gates a feature behind a licence, an account, or a paid tier. Every
  feature ships to everyone.
- A monetary figure that is not traceable to a cited instrument.
- A finding that cannot be located in a file, or a legal claim without a resolving URL.

These are not style preferences. They are the reasons a stranger can be handed this
binary and trust it.

---

## Code of conduct

Be decent. Assume the person you are replying to knows something you do not — which,
given this project spans law across twelve jurisdictions and code across a dozen
ecosystems, is almost always true.

Report anything that needs reporting to the maintainers via a private issue or the
contact in `SECURITY.md`.

---

## Who maintains this

ADDGP-Lite is maintained by **ViradoTech**, whose mission is to build the ethical
governance backbone that makes Africa's AI economy auditable, lawful, and sovereign —
eliminating the administrative debt that stops African institutions from growing.

The tool is MIT licensed and free forever. There is no paid tier and no plan for one.

If your pack, your fix, or your lexicon entry lands here, it ships to everyone who ever
runs this binary. That is the point.
