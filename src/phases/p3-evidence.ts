import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config/index.ts";
import type { Paths } from "../util/paths.ts";
import { readText, walk, type WalkedFile } from "../util/fswalk.ts";
import { matchAny } from "../util/glob.ts";
import { sha256Short, hashObject } from "../util/hash.ts";
import { gitHistoryBlobs, gitShowBlob, isGitRepo } from "../util/git.ts";
import { lex, langForExt, type Lang } from "../sovereignty/lexer.ts";
import { findSecrets, findPii, lineOf } from "../sovereignty/secrets.ts";
import { DATA } from "../generated/embedded.ts";
import type { EvidenceBundle, EvidenceFinding } from "../schemas/index.ts";
import { nowIso } from "../util/time.ts";

/* ───────────────────────────── embedded data ───────────────────────────── */

interface PiiCategory {
  name: string;
  special: boolean;
  terms: string[];
  regions?: string[];
}
interface ArtifactSpec {
  key: string;
  label: string;
  patterns: string[];
}
interface Lexicon {
  categories: PiiCategory[];
  compliance_artifacts: ArtifactSpec[];
}
interface Advisory {
  id: string;
  ecosystem: string;
  package: string;
  vulnerable: string;
  severity: string;
  cwe: string;
  summary: string;
}
interface VulnDb {
  advisories: Advisory[];
  note: string;
  sources: string[];
}

const LEXICON = DATA["pii-lexicon"] as Lexicon;
const VULNDB = DATA.vulndb as VulnDb;

/* ───────────────────────────── framework detection ───────────────────────────── */

const FRAMEWORK_SIGNATURES: { name: string; deps?: string[]; files?: string[] }[] = [
  { name: "Next.js", deps: ["next"], files: ["next.config.js", "next.config.mjs", "next.config.ts"] },
  { name: "React", deps: ["react"] },
  { name: "Express", deps: ["express"] },
  { name: "Fastify", deps: ["fastify"] },
  { name: "NestJS", deps: ["@nestjs/core"] },
  { name: "Django", deps: ["django", "Django"], files: ["manage.py"] },
  { name: "Flask", deps: ["flask", "Flask"] },
  { name: "FastAPI", deps: ["fastapi"] },
  { name: "Rails", files: ["Gemfile", "config/routes.rb"] },
  { name: "Laravel", files: ["artisan"] },
  { name: "Spring", files: ["pom.xml", "build.gradle"] },
  { name: "Supabase", deps: ["@supabase/supabase-js", "supabase"] },
  { name: "Prisma", deps: ["prisma", "@prisma/client"], files: ["prisma/schema.prisma"] },
  { name: "Drizzle", deps: ["drizzle-orm"] },
  { name: "SQLAlchemy", deps: ["sqlalchemy", "SQLAlchemy"] },
  { name: "Mongoose", deps: ["mongoose"] },
  { name: "TypeORM", deps: ["typeorm"] },
  { name: "OpenAI SDK", deps: ["openai"] },
  { name: "Anthropic SDK", deps: ["@anthropic-ai/sdk", "anthropic"] },
  { name: "LangChain", deps: ["langchain", "@langchain/core"] },
  { name: "Hugging Face", deps: ["transformers", "@huggingface/inference"] },
  { name: "scikit-learn", deps: ["scikit-learn", "sklearn"] },
  { name: "PyTorch", deps: ["torch"] },
  { name: "TensorFlow", deps: ["tensorflow"] },
  { name: "Stripe", deps: ["stripe"] },
  { name: "Docker", files: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"] },
  { name: "Terraform", files: ["main.tf"] },
  { name: "Kubernetes", files: ["k8s", "kubernetes"] },
  { name: "GitHub Actions", files: [".github/workflows"] },
  { name: "Vercel", files: ["vercel.json"] },
];

const DATA_STORE_SIGNATURES: { name: string; deps?: string[]; hints?: RegExp }[] = [
  { name: "PostgreSQL", deps: ["pg", "postgres", "psycopg2", "psycopg2-binary", "asyncpg"], hints: /postgres(?:ql)?:\/\// },
  { name: "MySQL", deps: ["mysql", "mysql2", "pymysql"], hints: /mysql:\/\// },
  { name: "MongoDB", deps: ["mongodb", "mongoose", "pymongo"], hints: /mongodb(?:\+srv)?:\/\// },
  { name: "Redis", deps: ["redis", "ioredis"], hints: /redis:\/\// },
  { name: "SQLite", deps: ["sqlite3", "better-sqlite3"] },
  { name: "Supabase (Postgres)", deps: ["@supabase/supabase-js"] },
  { name: "Firebase", deps: ["firebase", "firebase-admin"] },
  { name: "DynamoDB", deps: ["@aws-sdk/client-dynamodb", "boto3"] },
  { name: "S3 / object storage", deps: ["@aws-sdk/client-s3"], hints: /s3:\/\// },
  { name: "Elasticsearch", deps: ["@elastic/elasticsearch", "elasticsearch"] },
];

/* ───────────────────────────── rule helpers ───────────────────────────── */

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter).padStart(3, "0")}`;
}

function finding(f: Omit<EvidenceFinding, "id" | "snippet_hash"> & { snippet?: string }): EvidenceFinding {
  const { snippet, ...rest } = f;
  return {
    id: nextId("EV"),
    snippet_hash: sha256Short(snippet ?? `${f.file}:${f.line}:${f.rule_id}`),
    ...rest,
  };
}

/* ───────────────────────────── the engine ───────────────────────────── */

export interface EvidenceOptions {
  cfg: Config;
  paths: Paths;
  /** limit to these repo-relative paths (scan --since) */
  only?: string[];
  /** history scanning is slow on big repos; on by default because a deleted key is still a leaked key */
  scanHistory?: boolean;
}

/**
 * Phase 3 — local, free, and the only stage that sees the real code.
 *
 * §5.6: this is where all identifier-semantic analysis happens, because a column
 * called `ssn` is a signal and phases 4-5 will never see that name. Everything
 * here is expressed onward as a CONCLUSION, never as a quotation.
 */
export function runEvidence(opts: EvidenceOptions): EvidenceBundle {
  counter = 0;
  const { cfg, paths } = opts;
  const root = paths.root;

  const files = walk(root, {
    include: cfg.scan.include,
    exclude: cfg.scan.exclude,
    maxFileKb: cfg.scan.max_file_kb,
  }).filter((f) => (opts.only ? opts.only.includes(f.path) : true));

  const findings: EvidenceFinding[] = [];
  const languages: Record<string, number> = {};
  let loc = 0;

  const manifests = readManifests(root);
  const frameworks = detectFrameworks(root, manifests.deps);
  const dataStores = new Set<string>();

  for (const f of files) {
    const source = readText(f.abs, f.ext);
    if (source === null) continue;
    const lang = langForExt(f.ext);
    const lines = source.split("\n").length;
    loc += lines;
    languages[lang] = (languages[lang] ?? 0) + lines;

    scanFile(f, source, lang, findings, dataStores, cfg);
  }

  // Repository-level checks
  findings.push(...scanSecretsInHistory(root, opts.scanHistory ?? true));
  findings.push(...dependencyVulnerabilities(manifests));
  findings.push(...licenseInventory(manifests));
  const artifacts = complianceArtifacts(root, files);
  findings.push(...artifactFindings(artifacts));

  for (const s of DATA_STORE_SIGNATURES) {
    if (s.deps?.some((d) => manifests.deps.has(d))) dataStores.add(s.name);
  }

  return {
    generated_at: nowIso(),
    root_hash: hashObject(files.map((f) => `${f.path}:${f.size}`)),
    file_count: files.length,
    loc,
    languages,
    frameworks,
    data_stores: [...dataStores].sort(),
    findings,
    sbom_component_count: manifests.components.length,
    compliance_artifacts: artifacts,
  };
}

/* ───────────────────────────── per-file scanning ───────────────────────────── */

const LOGGING_CALL = /\b(?:console\.(?:log|info|warn|error|debug)|logger?\.(?:log|info|warn|error|debug|trace)|print|println|printf|fmt\.Print\w*|log\.(?:Print\w*|Info|Error|Debug|Warn))\s*\(/;
const AI_CALL = /\b(?:openai|anthropic|claude|gemini|cohere|mistral|groq|together|replicate|huggingface|bedrock|vertex)\b|\bchat\.completions\.create\b|\bmessages\.create\b|\bgenerateContent\b|\bInvokeModel\b|\bcreateChatCompletion\b/i;
const HTTP_CLIENT = /\b(?:fetch|axios|httpx|requests\.(?:get|post|put|patch|delete)|urllib|got|superagent|node-fetch|HttpClient)\s*[.(]/;
const AUTH_HINT = /\b(?:jwt|jsonwebtoken|passport|next-auth|authjs|clerk|auth0|firebase\.auth|supabase\.auth|session|bcrypt|argon2|scrypt|oauth|saml|oidc)\b/i;
const DELETE_HINT = /\b(?:delete_?account|deleteUser|erase|purge|anonymi[sz]e|right_to_be_forgotten|hard_?delete|soft_?delete)\b/i;
const RETENTION_HINT = /\b(?:retention|ttl|expires_?at|expiry|purge_?after|delete_?after|max_?age)\b/i;
const CONSENT_HINT = /\b(?:consent|opt_?in|opt_?out|preferences?|gdpr|do_?not_?sell|global_?privacy_?control|gpc)\b/i;
const AUDIT_HINT = /\b(?:audit_?log|audit_?trail|activity_?log|event_?log)\b/i;

function scanFile(
  f: WalkedFile,
  source: string,
  lang: Lang,
  out: EvidenceFinding[],
  dataStores: Set<string>,
  cfg: Config,
): void {
  const tokens = lex(source, lang);

  /* -- secrets in working-tree files -- */
  for (const hit of findSecrets(source)) {
    out.push(
      finding({
        rule_id: `secret.${hit.rule}`,
        kind: "secret",
        title: `${hit.label} committed in source`,
        file: f.path,
        line: lineOf(source, hit.index),
        severity: hit.severity === "critical" ? "critical" : "high",
        conclusion:
          `A ${hit.label} is present in a tracked source file. Whatever it protects must be treated as ` +
          `compromised and rotated; the value itself is never transmitted by this tool.`,
        meta: { detector: hit.rule },
        snippet: `${f.path}:${hit.rule}:${hit.index}`,
      }),
    );
  }

  /* -- literal personal data in source (a fixture with real rows, a hardcoded record) -- */
  for (const hit of findPii(source)) {
    if (hit.rule === "phone_e164" && !/\bphone|tel|mobile|msisdn/i.test(source)) continue;
    out.push(
      finding({
        rule_id: `pii_literal.${hit.rule}`,
        kind: "pii_symbol",
        title: `${hit.label} appears as a literal value in source`,
        file: f.path,
        line: lineOf(source, hit.index),
        severity: hit.severity === "critical" ? "high" : "medium",
        conclusion:
          `A literal ${hit.label} is embedded in source. If this is real personal data it is being ` +
          `processed outside any consent or retention control, and it is in version control history.`,
        meta: { detector: hit.rule },
        snippet: `${f.path}:${hit.rule}:${hit.index}`,
      }),
    );
  }

  /* -- PII-bearing symbols, matched on identifier names (the §5.6 trick) -- */
  const identifiers = new Map<string, number>();
  for (const t of tokens) {
    if (t.kind !== "ident" && t.kind !== "string") continue;
    const words = t.kind === "string" ? t.value.split(/[\s,;:'"()]+/) : [t.value];
    for (const w of words) {
      const norm = normaliseSymbol(w);
      if (norm && !identifiers.has(norm)) identifiers.set(norm, t.line);
    }
  }

  const seenCategories = new Set<string>();
  for (const cat of LEXICON.categories) {
    for (const term of cat.terms) {
      const line = identifiers.get(term);
      if (line === undefined) continue;
      if (seenCategories.has(cat.name)) break;
      seenCategories.add(cat.name);
      out.push(
        finding({
          rule_id: `pii_symbol.${slug(cat.name)}`,
          kind: "pii_symbol",
          title: `${cat.name}${cat.special ? " (special category)" : ""} handled here`,
          file: f.path,
          line,
          severity: cat.special ? "high" : "medium",
          conclusion:
            `This file handles ${cat.name}${cat.special ? ", which is a special or sensitive category in most of the selected regimes" : ""}. ` +
            `Identified from a symbol name read locally; the name itself is not transmitted.`,
          meta: { category: cat.name, special: cat.special, regions: cat.regions ?? [] },
          snippet: `${f.path}:${cat.name}`,
        }),
      );
      break;
    }
  }

  const specialHere = [...seenCategories].filter(
    (n) => LEXICON.categories.find((c) => c.name === n)?.special,
  );

  /* -- personal data reaching a log sink -- */
  if (seenCategories.size > 0 && LOGGING_CALL.test(source)) {
    const line = lineOf(source, source.search(LOGGING_CALL));
    out.push(
      finding({
        rule_id: "logging.pii_in_log_sink",
        kind: "logging",
        title: "Personal data and a logging call occur in the same scope",
        file: f.path,
        line,
        severity: specialHere.length ? "high" : "medium",
        conclusion:
          `This file both handles personal data (${[...seenCategories].slice(0, 3).join(", ")}) and writes to a log sink. ` +
          `Logs are usually retained longer than the data itself, are replicated to third parties, and are ` +
          `rarely covered by a deletion path — verify that these fields are not among the values logged.`,
        meta: { categories: [...seenCategories], special: specialHere },
        snippet: `${f.path}:logging`,
      }),
    );
  }

  /* -- AI / inference call sites -- */
  if (AI_CALL.test(source)) {
    const line = lineOf(source, source.search(AI_CALL));
    const vendor = source.match(AI_CALL)?.[0] ?? "unknown";
    out.push(
      finding({
        rule_id: "ai.call_site",
        kind: "ai_call_site",
        title: "Inference vendor call site",
        file: f.path,
        line,
        severity: seenCategories.size ? "high" : "info",
        conclusion:
          `This file calls an inference vendor (${vendor}).` +
          (seenCategories.size
            ? ` It also handles personal data (${[...seenCategories].slice(0, 3).join(", ")}), so personal data may reach the vendor — ` +
              `which requires a lawful basis, a processor agreement, and a transfer basis if the vendor is in another jurisdiction.`
            : ` No personal-data symbols were detected in the same file.`),
        meta: { vendor, personal_data_in_scope: [...seenCategories] },
        snippet: `${f.path}:ai`,
      }),
    );
  }

  /* -- outbound HTTP to third parties -- */
  const externalUrls = [...source.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)]
    .map((m) => m[1]!.toLowerCase())
    .filter((h) => !/^(?:localhost|127\.|0\.0\.0\.0|example\.|schema\.org|www\.w3\.org)/.test(h));
  if (externalUrls.length && HTTP_CLIENT.test(source)) {
    const hosts = [...new Set(externalUrls)];
    out.push(
      finding({
        rule_id: "crossborder.third_party_call",
        kind: "crossborder",
        title: "Outbound call to a third-party host",
        file: f.path,
        line: lineOf(source, source.search(HTTP_CLIENT)),
        severity: seenCategories.size ? "medium" : "info",
        conclusion:
          `This file makes outbound requests to ${hosts.length} third-party host(s). Each recipient of personal data ` +
          `is a processor or a separate controller, and each needs a contract and — where it sits in another ` +
          `jurisdiction — a transfer basis.`,
        meta: { hosts: hosts.slice(0, 10), personal_data_in_scope: [...seenCategories] },
        snippet: `${f.path}:http`,
      }),
    );
  }

  /* -- auth surface -- */
  if (AUTH_HINT.test(source)) {
    out.push(
      finding({
        rule_id: "auth.surface",
        kind: "auth",
        title: "Authentication or session handling",
        file: f.path,
        line: lineOf(source, source.search(AUTH_HINT)),
        severity: "info",
        conclusion: "This file participates in authentication or session handling.",
        meta: {},
        snippet: `${f.path}:auth`,
      }),
    );
  }

  /* -- retention, deletion, consent, audit signals -- */
  const signal = (re: RegExp, rule: string, kind: EvidenceFinding["kind"], title: string, conclusion: string) => {
    if (!re.test(source)) return;
    out.push(
      finding({
        rule_id: rule,
        kind,
        title,
        file: f.path,
        line: lineOf(source, source.search(re)),
        severity: "info",
        conclusion,
        meta: {},
        snippet: `${f.path}:${rule}`,
      }),
    );
  };
  signal(RETENTION_HINT, "retention.mechanism", "retention", "Retention or expiry mechanism",
    "A retention, TTL or expiry mechanism is implemented here.");
  signal(DELETE_HINT, "retention.deletion_path", "retention", "Deletion or anonymisation path",
    "A deletion, purge or anonymisation path is implemented here.");
  signal(CONSENT_HINT, "consent.mechanism", "data_flow", "Consent or preference handling",
    "Consent or privacy-preference handling is implemented here.");
  signal(AUDIT_HINT, "audit.log", "logging", "Audit log", "An audit or activity log is implemented here.");

  /* -- SQL schema and storage -- */
  if (lang === "sql" || /\.(?:prisma|graphql)$/.test(f.path) || /CREATE\s+TABLE/i.test(source)) {
    dataStores.add("SQL schema present");
    out.push(...schemaFindings(f, source));
  }

  /* -- IaC and platform misconfiguration -- */
  out.push(...iacFindings(f, source, cfg));
}

function normaliseSymbol(word: string): string | null {
  const w = word.trim();
  if (!w || w.length > 48) return null;
  // camelCase and PascalCase → snake_case, so `ghanaCardNumber` matches `ghana_card_number`
  const snake = w
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s.]+/g, "_")
    .toLowerCase();
  return /^[a-z0-9_]+$/.test(snake) ? snake : null;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/* ───────────────────────────── schema analysis ───────────────────────────── */

function schemaFindings(f: WalkedFile, source: string): EvidenceFinding[] {
  const out: EvidenceFinding[] = [];

  // Row-level security on Postgres/Supabase
  const hasTables = /CREATE\s+TABLE/i.test(source);
  const hasRls = /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(source);
  const hasPolicy = /CREATE\s+POLICY/i.test(source);
  if (hasTables && !hasRls) {
    out.push(
      finding({
        rule_id: "iac.rls_absent",
        kind: "iac_misconfig",
        title: "Tables defined without row level security",
        file: f.path,
        line: lineOf(source, source.search(/CREATE\s+TABLE/i)),
        severity: "high",
        conclusion:
          "Tables are created in this file and row level security is never enabled. On a platform where the " +
          "database is reachable from the client (Supabase, PostgREST and similar), that means any holder of " +
          "the anon key can read every row.",
        meta: { has_policy: hasPolicy },
        snippet: `${f.path}:rls`,
      }),
    );
  }
  if (hasRls && !hasPolicy) {
    out.push(
      finding({
        rule_id: "iac.rls_no_policy",
        kind: "iac_misconfig",
        title: "Row level security enabled with no policy defined",
        file: f.path,
        line: lineOf(source, source.search(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)),
        severity: "medium",
        conclusion:
          "RLS is enabled but no policy is created in this file. That denies all access by default, which is " +
          "safe but usually means the policies live elsewhere — confirm they exist and are scoped correctly.",
        meta: {},
        snippet: `${f.path}:rls_nopolicy`,
      }),
    );
  }

  // Columns holding special-category data with no obvious protection
  for (const m of source.matchAll(/^\s*"?([a-z_][a-z0-9_]*)"?\s+(text|varchar|char|jsonb?|bytea)/gim)) {
    const col = normaliseSymbol(m[1]!);
    if (!col) continue;
    const cat = LEXICON.categories.find((c) => c.special && c.terms.includes(col));
    if (!cat) continue;
    out.push(
      finding({
        rule_id: "storage.special_category_column",
        kind: "storage",
        title: `Special-category column stored in plain type: ${cat.name}`,
        file: f.path,
        line: lineOf(source, m.index ?? 0),
        severity: "high",
        conclusion:
          `A column holding ${cat.name} is declared with an unencrypted column type. Most of the selected ` +
          `regimes require additional safeguards for this category, and several require it to be unreadable at rest.`,
        meta: { category: cat.name, regions: cat.regions ?? [] },
        snippet: `${f.path}:${col}`,
      }),
    );
  }

  return out;
}

/* ───────────────────────────── IaC and platform ───────────────────────────── */

function iacFindings(f: WalkedFile, source: string, cfg: Config): EvidenceFinding[] {
  const out: EvidenceFinding[] = [];
  const add = (
    rule: string,
    title: string,
    severity: EvidenceFinding["severity"],
    conclusion: string,
    at: number,
  ) =>
    out.push(
      finding({
        rule_id: rule,
        kind: "iac_misconfig",
        title,
        file: f.path,
        line: lineOf(source, at),
        severity,
        conclusion,
        meta: {},
        snippet: `${f.path}:${rule}`,
      }),
    );

  // service_role / admin keys reachable from a client bundle
  const clientBundle =
    /(?:^|\/)(?:app|pages|src\/app|src\/pages|components|client|public|web)\//.test(f.path) &&
    !/(?:^|\/)(?:api|server|lib\/server|actions)\//.test(f.path);
  const serviceRole = /service_role|SERVICE_ROLE|SUPABASE_SERVICE|admin[_-]?key|ADMIN_KEY|SECRET_KEY/.test(source);
  const publicEnv = /\b(?:NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_|EXPO_PUBLIC_)\w*(?:SERVICE_ROLE|SECRET|ADMIN|PRIVATE)\w*/.test(source);
  if (publicEnv || (clientBundle && serviceRole)) {
    add(
      "iac.privileged_key_in_client",
      "Privileged key reachable from the client bundle",
      "critical",
      "A privileged credential (service_role, admin or secret key) is referenced from code that ships to the " +
        "browser, or is exposed through a public environment-variable prefix. Anything shipped to a client is " +
        "public: this key must be treated as disclosed and rotated, and the call moved server-side.",
      Math.max(0, source.search(/service_role|SERVICE_ROLE|NEXT_PUBLIC_\w*(?:SERVICE_ROLE|SECRET|ADMIN)/)),
    );
  }

  // permissive CORS
  if (/(?:Access-Control-Allow-Origin["'\s:=]+\*)|(?:origin\s*:\s*["']\*["'])|(?:cors\(\s*\{\s*origin\s*:\s*true)/i.test(source)) {
    add(
      "iac.permissive_cors",
      "Wildcard CORS origin",
      "medium",
      "The service allows any origin. Combined with cookie or token auth this permits cross-site requests to " +
        "read authenticated responses.",
      source.search(/Access-Control-Allow-Origin|origin/i),
    );
  }

  // public storage buckets
  if (/(?:acl\s*=\s*["']public-read["'])|(?:public_?access_?block\s*=\s*false)|(?:"public"\s*:\s*true)|(?:allUsers)/i.test(source)) {
    add(
      "iac.public_bucket",
      "Object storage exposed publicly",
      "high",
      "A storage bucket or object is configured for public read. If user uploads land here they are readable by " +
        "anyone with the URL, which is a disclosure of personal data rather than a hosting choice.",
      source.search(/public-read|allUsers|public_?access/i),
    );
  }

  // unpinned CI actions
  if (/\.github\/workflows\//.test(f.path)) {
    for (const m of source.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@(\S+)/g)) {
      const ref = m[2]!;
      if (!/^[0-9a-f]{40}$/.test(ref)) {
        add(
          "iac.unpinned_action",
          `CI action not pinned to a commit: ${m[1]}@${ref}`,
          "medium",
          `The workflow uses ${m[1]}@${ref}, a mutable reference. Whoever controls that tag controls what runs ` +
            `with your CI secrets. Pin to a full commit SHA.`,
          m.index ?? 0,
        );
      }
    }
  }

  // missing security headers in a web app config
  if (/next\.config|middleware\.(?:ts|js)|helmet|nginx\.conf|vercel\.json/.test(f.path)) {
    const hasCsp = /Content-Security-Policy/i.test(source);
    const hasHsts = /Strict-Transport-Security/i.test(source);
    if (!hasCsp || !hasHsts) {
      const missing = [!hasCsp && "Content-Security-Policy", !hasHsts && "Strict-Transport-Security"].filter(Boolean);
      add(
        "iac.missing_security_headers",
        `Security headers not set here: ${missing.join(", ")}`,
        "low",
        `This configuration file does not set ${missing.join(" or ")}. Absent CSP, a single injected script can ` +
          `exfiltrate whatever the page can read, including personal data rendered for the signed-in user.`,
        0,
      );
    }
  }

  // Dockerfile running as root
  if (/(?:^|\/)Dockerfile/.test(f.path) && !/^\s*USER\s+(?!root)/im.test(source)) {
    add(
      "iac.container_runs_as_root",
      "Container image runs as root",
      "medium",
      "No non-root USER is set, so the process runs as root inside the container. That turns a code-execution " +
        "bug into a container-level compromise.",
      0,
    );
  }

  // debug mode on
  if (/\b(?:DEBUG|debug)\s*[=:]\s*(?:True|true|1)\b/.test(source) && !/\.test\.|\.spec\./.test(f.path)) {
    add(
      "iac.debug_enabled",
      "Debug mode enabled in configuration",
      "medium",
      "Debug mode is enabled. Debug handlers typically render stack traces, environment variables and query " +
        "contents to the browser, which is a disclosure path for both secrets and personal data.",
      source.search(/\b(?:DEBUG|debug)\s*[=:]/),
    );
  }

  // TLS verification disabled
  if (/(?:verify\s*=\s*False)|(?:rejectUnauthorized\s*:\s*false)|(?:NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0)|(?:InsecureSkipVerify\s*:\s*true)/.test(source)) {
    add(
      "iac.tls_verification_disabled",
      "TLS certificate verification disabled",
      "high",
      "Certificate verification is switched off for outbound requests. Anything sent over that connection, " +
        "including personal data and credentials, is readable by a network attacker.",
      source.search(/verify\s*=\s*False|rejectUnauthorized|InsecureSkipVerify|NODE_TLS_REJECT/),
    );
  }

  void cfg;
  return out;
}

/* ───────────────────────────── manifests, SBOM, vulns ───────────────────────────── */

export interface Component {
  name: string;
  version: string;
  ecosystem: string;
  license?: string;
}

interface Manifests {
  deps: Set<string>;
  components: Component[];
  licenses: Map<string, string>;
}

function readManifests(root: string): Manifests {
  const deps = new Set<string>();
  const components: Component[] = [];
  const licenses = new Map<string, string>();

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readText(pkgPath, ".json") ?? "{}") as Record<string, unknown>;
      if (typeof pkg.license === "string") licenses.set("(this project)", pkg.license);
      for (const field of ["dependencies", "devDependencies"]) {
        const obj = pkg[field] as Record<string, string> | undefined;
        if (!obj) continue;
        for (const [name, range] of Object.entries(obj)) {
          deps.add(name);
          components.push({ name, version: cleanVersion(range), ecosystem: "npm" });
        }
      }
    } catch {
      /* malformed manifest is itself not a compliance finding */
    }
  }

  const req = readTextAt(root, "requirements.txt");
  if (req) {
    for (const line of req.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9._-]+)\s*(?:[<>=!~]+\s*([0-9][^\s;#]*))?/);
      if (!m?.[1] || line.trim().startsWith("#")) continue;
      deps.add(m[1]);
      components.push({ name: m[1], version: m[2] ?? "*", ecosystem: "PyPI" });
    }
  }

  const pyproject = readTextAt(root, "pyproject.toml");
  if (pyproject) {
    for (const m of pyproject.matchAll(/^\s*["']?([A-Za-z0-9._-]+)["']?\s*=\s*["']\^?~?=?([0-9][^"']*)["']/gm)) {
      deps.add(m[1]!);
      components.push({ name: m[1]!, version: m[2]!, ecosystem: "PyPI" });
    }
  }

  const gomod = readTextAt(root, "go.mod");
  if (gomod) {
    for (const m of gomod.matchAll(/^\s*([\w.\-/]+)\s+v([\w.\-+]+)/gm)) {
      deps.add(m[1]!);
      components.push({ name: m[1]!, version: m[2]!, ecosystem: "Go" });
    }
  }

  return { deps, components, licenses };
}

function readTextAt(root: string, rel: string): string | null {
  const p = join(root, rel);
  return existsSync(p) ? readText(p, rel.slice(rel.lastIndexOf("."))) : null;
}

function cleanVersion(range: string): string {
  return range.replace(/^[\^~>=<\s]+/, "").trim() || "*";
}

/** Naive but honest semver-ish comparison; only used for `<x.y.z` advisory ranges. */
function versionLessThan(version: string, bound: string): boolean {
  const norm = (v: string) => v.replace(/[^0-9.]/g, "").split(".").map((n) => Number(n) || 0);
  const a = norm(version);
  const b = norm(bound);
  if (!a.length || !b.length) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}

function dependencyVulnerabilities(m: Manifests): EvidenceFinding[] {
  const out: EvidenceFinding[] = [];
  for (const c of m.components) {
    for (const adv of VULNDB.advisories) {
      if (adv.ecosystem !== c.ecosystem || adv.package !== c.name) continue;
      const bound = adv.vulnerable.replace(/^</, "");
      if (c.version === "*" || !versionLessThan(c.version, bound)) continue;
      out.push(
        finding({
          rule_id: `dep.${adv.id}`,
          kind: "dependency_vuln",
          title: `${c.name}@${c.version}: ${adv.summary}`,
          file: c.ecosystem === "npm" ? "package.json" : "requirements.txt",
          line: 0,
          severity: adv.severity as EvidenceFinding["severity"],
          conclusion:
            `${c.name}@${c.version} is below ${bound}, the fixed version for ${adv.id} (${adv.cwe}). ` +
            `${adv.summary} Checked against the advisory set embedded in this binary, which is a small ` +
            `high-signal list rather than a full mirror — run a live SCA tool as well.`,
          meta: { advisory: adv.id, cwe: adv.cwe, fixed_in: bound, ecosystem: c.ecosystem },
          snippet: `${c.name}@${c.version}:${adv.id}`,
        }),
      );
    }
  }
  return out;
}

const COPYLEFT = /^(?:AGPL|GPL|LGPL|SSPL|OSL|EUPL|CDDL|MPL)/i;

function licenseInventory(m: Manifests): EvidenceFinding[] {
  const out: EvidenceFinding[] = [];
  for (const [name, license] of m.licenses) {
    if (!COPYLEFT.test(license)) continue;
    out.push(
      finding({
        rule_id: "license.copyleft",
        kind: "license",
        title: `Copyleft license declared: ${license}`,
        file: "package.json",
        line: 0,
        severity: "info",
        conclusion:
          `${name} declares ${license}. This is a distribution question rather than a data-protection one, ` +
          `but it belongs in the same review: it constrains how this code may be combined and shipped.`,
        meta: { license },
        snippet: `${name}:${license}`,
      }),
    );
  }
  return out;
}

/* ───────────────────────────── git history ───────────────────────────── */

function scanSecretsInHistory(root: string, enabled: boolean): EvidenceFinding[] {
  if (!enabled || !isGitRepo(root)) return [];
  const out: EvidenceFinding[] = [];
  const blobs = gitHistoryBlobs(root, 3000);
  const seen = new Set<string>();
  let scanned = 0;

  for (const b of blobs) {
    if (scanned > 800) break;
    if (!/\.(?:ts|js|tsx|jsx|py|rb|go|java|php|cs|rs|sh|yml|yaml|json|env|toml|conf|ini|tf)$/i.test(b.path)) continue;
    const content = gitShowBlob(root, b.sha);
    scanned++;
    if (!content) continue;
    for (const hit of findSecrets(content)) {
      const key = `${b.path}:${hit.rule}:${hit.excerpt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        finding({
          rule_id: `secret.history.${hit.rule}`,
          kind: "secret",
          title: `${hit.label} present in git history`,
          file: b.path,
          line: 0,
          severity: "critical",
          conclusion:
            `A ${hit.label} exists in a historical git object for this path. Removing it from the current ` +
            `working tree does not remove it from history — anyone with a clone still has it. Rotate the ` +
            `credential; rewriting history alone is not sufficient once the repo has been pushed or shared.`,
          meta: { detector: hit.rule, blob: b.sha.slice(0, 8) },
          snippet: key,
        }),
      );
    }
  }
  return out;
}

/* ───────────────────────────── compliance artifacts ───────────────────────────── */

function complianceArtifacts(root: string, files: WalkedFile[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  // Look across the whole repo, not just scanned paths: policies usually live
  // outside src/ and a missing ROPA is a finding regardless of scan.include.
  const all = walk(root, { maxFileKb: 2048 }).map((f) => f.path.toLowerCase());
  const inScope = files.map((f) => f.path.toLowerCase());
  const universe = [...new Set([...all, ...inScope])];

  for (const spec of LEXICON.compliance_artifacts) {
    out[spec.key] = universe.some((p) => matchAny(p, spec.patterns.map((s) => s.toLowerCase())));
  }
  return out;
}

/**
 * §6.3 — presence AND absence of compliance artifacts. The absence findings are
 * the ones that turn into gaps, so each says what the missing document is for.
 */
const ARTIFACT_WHY: Record<string, { severity: EvidenceFinding["severity"]; why: string }> = {
  privacy_policy: { severity: "high", why: "Almost every regime in scope requires notice to data subjects, and several make a policy that does not match the code an enforceable misrepresentation." },
  dpa: { severity: "high", why: "A processor contract with mandatory terms is required before a third party processes personal data on your behalf — including an inference vendor." },
  ropa: { severity: "medium", why: "Records of processing activities are the first document a regulator asks for, and are mandatory above low thresholds in several regimes." },
  dpia: { severity: "medium", why: "An impact assessment is mandatory for high-risk processing: automated decisions, large-scale special-category data, systematic monitoring." },
  retention_policy: { severity: "high", why: "Storage limitation is a principle in every data protection regime in scope; without a stated period and a deletion path it cannot be demonstrated." },
  incident_runbook: { severity: "high", why: "Breach notification deadlines run from awareness, not from readiness — 72 hours in the EU, and as little as 6 hours for CERT-In. A runbook written after the breach is written too late." },
  subject_request_handler: { severity: "medium", why: "Access, correction and deletion requests carry statutory response deadlines." },
  consent_store: { severity: "medium", why: "Where consent is the lawful basis it must be demonstrable, which means a record per subject per purpose." },
  audit_log: { severity: "medium", why: "Accountability and security-of-processing duties both assume you can show who accessed personal data and when." },
  deletion_path: { severity: "high", why: "The right to erasure and the storage-limitation principle both require deletion to actually complete, including derived copies." },
  ai_documentation: { severity: "medium", why: "AI system documentation is required for high-risk systems under the EU AI Act and expected by ISO/IEC 42001 and the NIST AI RMF." },
  security_policy: { severity: "low", why: "A stated security policy is expected by most frameworks and by enterprise procurement." },
  terms: { severity: "low", why: "Terms of service establish the contractual basis relied on by several processing purposes." },
  cookie_policy: { severity: "low", why: "Cookie consent is enforced separately from general data protection law in the UK and EU." },
};

function artifactFindings(artifacts: Record<string, boolean>): EvidenceFinding[] {
  const out: EvidenceFinding[] = [];
  for (const spec of LEXICON.compliance_artifacts) {
    const present = artifacts[spec.key] ?? false;
    const meta = ARTIFACT_WHY[spec.key];
    if (present) {
      out.push(
        finding({
          rule_id: `artifact.present.${spec.key}`,
          kind: "artifact_present",
          title: `${spec.label} found`,
          file: "(repository)",
          line: 0,
          severity: "info",
          conclusion:
            `A file matching the ${spec.label} pattern exists. Presence is not the same as adequacy — ` +
            `this tool confirms the artifact exists, not that its contents are correct.`,
          meta: { artifact: spec.key },
          snippet: `artifact:${spec.key}:present`,
        }),
      );
    } else {
      out.push(
        finding({
          rule_id: `artifact.absent.${spec.key}`,
          kind: "artifact_absent",
          title: `No ${spec.label} found`,
          file: "(repository)",
          line: 0,
          severity: meta?.severity ?? "low",
          conclusion:
            `No file matching the ${spec.label} pattern was found anywhere in the repository. ` +
            (meta?.why ?? "") +
            ` If this document exists outside version control, that is worth recording — but a compliance ` +
            `artifact nobody in the repository can find is one nobody will maintain.`,
          meta: { artifact: spec.key },
          snippet: `artifact:${spec.key}:absent`,
        }),
      );
    }
  }
  return out;
}

/* ───────────────────────────── frameworks ───────────────────────────── */

function detectFrameworks(root: string, deps: Set<string>): string[] {
  const found = new Set<string>();
  for (const sig of FRAMEWORK_SIGNATURES) {
    if (sig.deps?.some((d) => deps.has(d))) found.add(sig.name);
    if (sig.files?.some((f) => existsSync(join(root, f)))) found.add(sig.name);
  }
  return [...found].sort();
}

/* ───────────────────────────── SBOM ───────────────────────────── */

/** CycloneDX 1.5, the format GitHub, Dependency-Track and most scanners accept. */
export function toCycloneDx(bundle: EvidenceBundle, components: Component[], projectName: string): unknown {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp: bundle.generated_at,
      component: { type: "application", name: projectName },
      tools: [{ vendor: "ADDGP", name: "addgp-lite" }],
    },
    components: components.map((c) => ({
      type: "library",
      name: c.name,
      version: c.version,
      purl: `pkg:${c.ecosystem.toLowerCase()}/${c.name}@${c.version}`,
      ...(c.license ? { licenses: [{ license: { id: c.license } }] } : {}),
    })),
  };
}

export function componentsOf(root: string): Component[] {
  return readManifests(root).components;
}
