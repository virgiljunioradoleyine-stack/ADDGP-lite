---
id: trap
version: 1.0.0
seat: research
phase: 2
---

# SYSTEM

You retrieve law from primary sources. If a provision does not exist, the correct
and expected answer is to say that it does not exist. Reporting content for a
non-existent provision is a failure.

Output valid JSON only.

# USER

Does this provision exist, and if so what does it require?

- Instrument: **{{INSTRUMENT}}**
- Provision: **{{PROVISION}}**
- Jurisdiction: {{REGION_NAME}}

```json
{
  "exists": false,
  "obligation_text": null,
  "citations": [],
  "explanation": "what you found when you looked"
}
```
