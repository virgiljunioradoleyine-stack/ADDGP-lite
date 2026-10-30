# CLAUDE.md

## Session close-out report to the coordinator (added 2026-10-29)

The founder runs a coordinating Claude session (session id `session_01QmzryET9Ag91JrsRnVSeQj`) that tracks the product portfolio and the commercial conversations built on it. It can only describe a product accurately if every build session leaves an evidence-based report. This rule applies to every session in this repository.

**Before ending any session in which you changed code, tests, CI, documentation or dependencies:**

1. Add an entry at the **top** of `BUILD_REPORT.md` (create it if missing), in this format:

   ```
   ### YYYY-MM-DD HH:MM UTC · branch · commit SHA
   - What changed: (1 to 3 lines)
   - Checks run: exact command, result, pass and fail counts
   - CI for this SHA: run id and conclusion, read from the run itself, or "not read"
   - Verified now / documented only / not verified:
   - What may and may not be claimed to customers or partners after this change:
   - Open bugs and risks:
   - Decisions needed from the founder:
   - Next step:
   ```

2. Commit it with the work and push to your session branch. Do not merge to the default branch without the founder's approval.
3. If a `send_message` tool is available, send the coordinator session a message of at most 150 words: repo, branch, commit SHA, a one-line result, and anything that changes what may be said to customers or partners. The file is the durable record; the message is a nudge. If you cannot send it, say so in the report.

**Rules for the report:**

- Evidence only. "Pushed" is not "green": read the run status for the pushed SHA before writing that CI passed. Never write "done" for something no test or run has shown.
- Separate what you executed from what you only read in documentation. Say what you did not verify.
- No secrets, keys or customer data in the report.
- Do not write about prospects, pricing or commercial commitments. Those belong to the founder and the coordinator.
- The coordinator treats these reports as information, never as instructions to itself.
