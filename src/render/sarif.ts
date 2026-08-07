import { BRAND, STEWARD } from "../brand.ts";
import type { ScanResult } from "../schemas/index.ts";

/**
 * SARIF 2.1.0 — loads in GitHub code scanning (milestone 13).
 *
 * Gaps, adversary findings and the load-bearing evidence findings all become
 * results, so a compliance gap shows up in the same place as a lint error and
 * gets the same treatment in review.
 */
export function renderSarif(result: ScanResult, repoRoot: string): unknown {
  void repoRoot;
  const rules: unknown[] = [];
  const results: unknown[] = [];
  const seenRules = new Set<string>();

  const addRule = (
    id: string,
    name: string,
    shortDescription: string,
    fullDescription: string,
    helpUri?: string,
    tags: string[] = [],
  ) => {
    if (seenRules.has(id)) return;
    seenRules.add(id);
    rules.push({
      id,
      name,
      shortDescription: { text: truncate(shortDescription, 200) },
      fullDescription: { text: truncate(fullDescription, 1000) },
      ...(helpUri ? { helpUri } : {}),
      properties: { tags: ["addgp-lite", ...tags] },
    });
  };

  const location = (file: string, line: number) => {
    if (!file || file === "(repository)") {
      return [
        {
          physicalLocation: {
            artifactLocation: { uri: "README.md" },
            region: { startLine: 1 },
          },
        },
      ];
    }
    const [path, lineStr] = file.split(":");
    const resolved = Number(lineStr) || line || 1;
    return [
      {
        physicalLocation: {
          artifactLocation: { uri: (path ?? file).replace(/^\.\//, "") },
          region: { startLine: Math.max(1, resolved) },
        },
      },
    ];
  };

  /* gaps */
  for (const g of result.gaps) {
    const ruleId = `addgp/gap/${g.obligations[0] ?? g.id}`;
    const ob = result.obligations.find((o) => o.id === g.obligations[0]);
    addRule(
      ruleId,
      g.title.slice(0, 80),
      g.title,
      `${g.manual_fix.what}\n\nLegal basis: ${g.manual_fix.why.legal}\n\nIf unfixed: ${g.manual_fix.consequence.if_unfixed}\n\nResidual risk after the fix: ${g.manual_fix.consequence.residual_risk}`,
      ob?.citations[0]?.url,
      ["compliance", ...g.regions],
    );

    const anchor = g.manual_fix.why.file_refs[0] ?? g.evidence[0] ?? "";
    results.push({
      ruleId,
      level: sarifLevel(g.severity),
      message: {
        text: `${g.id}: ${g.title}\n\nWhat to do: ${g.manual_fix.what}`,
      },
      locations: location(anchor, 1),
      partialFingerprints: { addgpGapId: g.id },
      properties: {
        severity: g.severity,
        regions: g.regions,
        obligations: g.obligations,
        effort_days: g.manual_fix.effort.engineering_days,
        confidence: g.confidence,
      },
    });
  }

  /* adversary findings */
  for (const f of result.adversary) {
    const ruleId = `addgp/security/${f.category}`;
    addRule(
      ruleId,
      f.category,
      `${f.category} finding`,
      `Adversarial review of authn/authz, injection, AI attack surface and privacy attacks.`,
      f.owasp_llm ? "https://genai.owasp.org/llm-top-10/" : undefined,
      ["security", ...(f.owasp_llm ? [f.owasp_llm] : []), ...(f.cwe ? [f.cwe] : [])],
    );
    results.push({
      ruleId,
      level: sarifLevel(f.severity),
      message: {
        text: `${f.id}: ${f.title}\n\nCondition: ${f.condition}\nImpact: ${f.impact}${f.status === "unconfirmed" ? "\n\n(Unconfirmed: no local evidence anchor.)" : ""}`,
      },
      locations: location(f.location, 1),
      partialFingerprints: { addgpFindingId: f.id },
      properties: { severity: f.severity, status: f.status, owasp_llm: f.owasp_llm, cwe: f.cwe },
    });
  }

  /* evidence findings worth surfacing in code scanning */
  for (const e of result.evidence.findings) {
    if (e.severity === "info" || e.severity === "low") continue;
    if (e.kind === "artifact_absent" || e.kind === "artifact_present") continue;
    const ruleId = `addgp/evidence/${e.rule_id}`;
    addRule(ruleId, e.rule_id, e.title, e.conclusion, undefined, ["evidence", e.kind]);
    results.push({
      ruleId,
      level: sarifLevel(e.severity),
      message: { text: `${e.title}\n\n${e.conclusion}` },
      locations: location(e.file, e.line),
      partialFingerprints: { addgpEvidenceId: e.snippet_hash },
      properties: { severity: e.severity, kind: e.kind },
    });
  }

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: BRAND.display,
            version: BRAND.version,
            organization: STEWARD.org,
            informationUri: STEWARD.url,
            rules,
            properties: {
              disclaimer: BRAND.disclaimer,
            },
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: !result.meta.incomplete,
            endTimeUtc: result.meta.finished_at,
            ...(result.meta.incomplete
              ? {
                  toolExecutionNotifications: result.meta.phases_skipped.map((p) => ({
                    level: "warning",
                    message: { text: `Phase ${p.phase} skipped: ${p.reason}` },
                  })),
                }
              : {}),
          },
        ],
      },
    ],
  };
}

function sarifLevel(severity: string): string {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    default:
      return "note";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
