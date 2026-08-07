## What this changes

## Why

<!-- For a pack: which parts you are confident about, and which are your best guess. -->

## Checklist

- [ ] `bun run embed && bun test` passes
- [ ] `bun x tsc --noEmit` is clean
- [ ] If this touches `src/sovereignty/`: the sovereignty suite still passes, and I have
      said explicitly in this description if any protection is weakened
- [ ] If this adds a detector: it has both a positive test and a negative one
- [ ] No prompt string added inline in TypeScript (prompts live in `prompts/`)
- [ ] No telemetry, no licence gate, no monetary figure without a citation
