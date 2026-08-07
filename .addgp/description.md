# ADDGP-Lite

ADDGP-Lite is a command-line compliance auditing tool, distributed as a single
self-contained binary that a person hands to another person. It runs entirely on
the user's own machine.

## What it does

It reads a repository locally, retrieves the data-protection and AI law of the
jurisdictions the user selects, adjudicates the code against that law, and writes
a report: gaps with remediation steps, a legal-exposure ledger, and an ROI
analysis. It calls three model "seats" — research, security, architect — through
OpenRouter, on an API key the user supplies and pays for directly.

## What data it holds

None belonging to third parties. The tool processes only the user's own source
code, on the user's own machine, and only ever transmits a redacted form of it:
identifiers pseudonymised, string literals replaced with typed placeholders,
comments stripped, secrets dropped entirely. The reverse mapping is written to
`.addgp/sovereign/map.json` at mode 0600 and is never included in any payload,
cache entry, or export bundle.

The tool stores one credential — the user's OpenRouter API key — in the operating
system keychain where one is available, and otherwise in a scrypt + AES-256-GCM
encrypted file outside the repository at mode 0600. The key is never written to
argv, never logged, and is redacted from every stack trace.

There is no user account, no server, no database, and no personal data of any
kind belonging to anyone other than the operator of the binary.

## Where users and data are

The operator's machine, wherever that is. The project targets developers and
students in Ghana and Nigeria first, so it is built to work on a connection that
drops and with the network entirely off for everything except model calls.

The only outbound destination is `openrouter.ai`, pinned at the egress gate;
every other host is blocked. OpenRouter routes each request to an upstream model
provider, which means two parties see each redacted payload.

## Third parties and AI

OpenRouter, as the single API gateway, and whichever upstream provider serves the
configured model for each seat. Nothing else. There is no telemetry, no
analytics, no license check, and no version ping — the tool has no code capable
of contacting its authors.

## Automated decisions

None affecting any person. The tool's output is a report a human reads and acts
on; it applies no fixes and takes no action on the user's behalf. Generated load
harnesses are written to disk and never executed.

## Status

Pre-release. Distributed by hand as a signed binary with a published checksum.
