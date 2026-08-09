# Disclaimer

**ADDGP-Lite produces an engineering artifact, not legal advice.**

Nothing produced by this software constitutes legal advice, and no lawyer-client
relationship is created by using it. Every obligation it reports must be reviewed by a
qualified practitioner in the relevant jurisdiction before it is relied upon.

This is not boilerplate bolted on for safety. It is a description of what the tool
actually does and does not do:

**What it does.** It retrieves the text of instruments you are plausibly subject to,
verifies each provision against a primary source, checks your code for patterns that
conflict with them, and tells you what it found — with the citation attached to every
claim, so you can check it yourself.

**What it does not do.** It does not know your contracts, your data processing
agreements, your regulator's enforcement posture, your sector's supervisory guidance, or
the facts of your particular processing. It cannot weigh a defence, assess a risk
appetite, or tell you what a court would do. It has never seen your organisation.

**What it does about that gap.** Every report and every ROI output ends with a mandatory
section listing what still requires a human lawyer. That section is not optional and
cannot be suppressed by a flag. If it says something needs counsel, that is the tool
telling you the honest limit of what it checked — treat it as the most important part of
the output, not the disclaimer at the end.

Monetary figures are never stated without a citation to a primary source, and ranges are
used rather than point estimates, because a precise-looking number carries a confidence
that no automated system has earned.

**What to actually do with the output.** Take the `compliance/prompts/` folder to a coding
agent — each prompt is ready to paste, with the obligation text and citation attached so
the agent understands the constraint, not just the instruction. Take `compliance/LEDGER.md`
and the citations in `compliance/REPORT.md` to your lawyer — every claim resolves to a
primary source they can check in minutes instead of researching from nothing. The tool did
the retrieval and the first pass; the judgment calls — what a court would actually do, what
risk your organisation is willing to carry — stay with the humans in both of those rooms.

---

The licence terms for this software are in [LICENSE](LICENSE) and are separate from this
notice. Nothing here modifies them.
