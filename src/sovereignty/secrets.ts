import { entropy } from "../util/hash.ts";

export interface DetectorHit {
  rule: string;
  label: string;
  /** never the value itself — only enough to find it */
  excerpt: string;
  index: number;
  severity: "critical" | "high" | "medium";
}

interface Rule {
  id: string;
  label: string;
  re: RegExp;
  severity: "critical" | "high" | "medium";
  /** extra predicate, e.g. Luhn for card numbers */
  validate?: (m: RegExpExecArray) => boolean;
}

/* ───────────────────────────── secrets ───────────────────────────── */

export const SECRET_RULES: Rule[] = [
  { id: "aws_access_key", label: "AWS access key id", severity: "critical", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { id: "aws_secret", label: "AWS secret access key", severity: "critical", re: /\baws_secret_access_key\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi },
  { id: "github_pat", label: "GitHub token", severity: "critical", re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{22,255}\b/g },
  { id: "openai_key", label: "OpenAI API key", severity: "critical", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: "anthropic_key", label: "Anthropic API key", severity: "critical", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: "perplexity_key", label: "Perplexity API key", severity: "critical", re: /\bpplx-[A-Za-z0-9]{20,}\b/g },
  { id: "google_api_key", label: "Google API key", severity: "critical", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "slack_token", label: "Slack token", severity: "critical", re: /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/g },
  { id: "stripe_key", label: "Stripe secret key", severity: "critical", re: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g },
  { id: "twilio_key", label: "Twilio key", severity: "critical", re: /\bSK[0-9a-fA-F]{32}\b/g },
  { id: "sendgrid_key", label: "SendGrid key", severity: "critical", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
  { id: "supabase_service_role", label: "Supabase service_role key", severity: "critical", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*(?:cm9sZSI6InNlcnZpY2Vfcm9sZ|c2VydmljZV9yb2xl)[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/g },
  { id: "jwt", label: "JSON Web Token", severity: "high", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: "private_key_block", label: "private key block", severity: "critical", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g },
  { id: "certificate_block", label: "certificate block", severity: "high", re: /-----BEGIN CERTIFICATE-----/g },
  { id: "db_url_with_password", label: "database URL containing a password", severity: "critical", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@]+:[^\s@/]{3,}@[^\s/]+/gi },
  { id: "npm_token", label: "npm token", severity: "critical", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: "hf_token", label: "Hugging Face token", severity: "critical", re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { id: "generic_assignment", label: "hardcoded credential assignment", severity: "high",
    re: /\b(?:api[_-]?key|apikey|secret|password|passwd|pwd|token|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key|credential)\s*[=:]\s*['"]([^'"\s]{12,})['"]/gi,
    validate: (m) => {
      const v = m[1] ?? "";
      if (/^(?:process\.env|os\.environ|env\.|import\.meta|\$\{|<|xxx|yyy|change|your|placeholder|example|dummy|test|todo|redacted|\*+)/i.test(v)) return false;
      if (/^[A-Z_]+$/.test(v)) return false; // ENV_VAR_NAME
      return entropy(v) >= 2.6;
    },
  },
];

/* ───────────────────────────── personal data ───────────────────────────── */

function luhn(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let x = d.charCodeAt(i) - 48;
    if (alt) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export const PII_RULES: Rule[] = [
  { id: "email", label: "email address", severity: "high",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    validate: (m) => {
      const v = m[0].toLowerCase();
      // schema-ish and documentation addresses are not personal data
      return !/@(?:example\.(?:com|org|net)|test\.com|localhost|domain\.com|email\.com|sentry\.io|schema\.org|w3\.org|company\.com|acme\.com)$/.test(v)
        && !/^(?:user|test|foo|bar|admin|noreply|no-reply|hello|info|support|contact)@/.test(v);
    },
  },
  { id: "card_number", label: "payment card number", severity: "critical",
    re: /\b(?:\d[ -]*?){13,19}\b/g, validate: (m) => luhn(m[0]) },
  { id: "ghana_card", label: "Ghana Card number", severity: "critical", re: /\bGHA-\d{9}-\d\b/g },
  { id: "nigeria_nin", label: "Nigerian NIN", severity: "critical", re: /\b(?:nin|national[_\s-]?identification[_\s-]?number)\D{0,12}(\d{11})\b/gi },
  { id: "nigeria_bvn", label: "Nigerian BVN", severity: "critical", re: /\b(?:bvn|bank[_\s-]?verification[_\s-]?number)\D{0,12}(\d{11})\b/gi },
  { id: "sa_id", label: "South African ID number", severity: "critical", re: /\b(?:said|sa[_\s-]?id[_\s-]?number|id[_\s-]?number)\D{0,8}(\d{13})\b/gi },
  { id: "india_aadhaar", label: "Aadhaar number", severity: "critical", re: /\b(?:aadhaar|aadhar|uidai)\D{0,12}(\d{4}\s?\d{4}\s?\d{4})\b/gi },
  { id: "us_ssn", label: "US Social Security number", severity: "critical", re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { id: "kenya_huduma", label: "Kenyan national ID", severity: "critical", re: /\b(?:huduma|national[_\s-]?id)\D{0,10}(\d{8})\b/gi },
  { id: "passport", label: "passport number", severity: "high", re: /\bpassport(?:[_\s-]?(?:no|number))?\D{0,8}([A-Z]{1,2}\d{6,9})\b/gi },
  { id: "phone_e164", label: "phone number", severity: "medium",
    re: /(?:^|[^\w.+-])(\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4})(?![\w.-])/g,
    validate: (m) => (m[1] ?? "").replace(/\D/g, "").length >= 10 },
  { id: "iban", label: "IBAN", severity: "critical", re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    validate: (m) => /\d/.test(m[0]) && m[0].length >= 15 },
];

/* ───────────────────────────── entropy ───────────────────────────── */

const ENTROPY_MIN_LEN = 24;
const ENTROPY_THRESHOLD_B64 = 4.2;
const ENTROPY_THRESHOLD_HEX = 3.2;

/** Long high-entropy blobs that no rule named. Belt and braces for §5.4. */
export function entropyHits(text: string): DetectorHit[] {
  const hits: DetectorHit[] = [];
  const re = /[A-Za-z0-9+/=_-]{24,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = m[0];
    if (v.length < ENTROPY_MIN_LEN) continue;
    if (/^[0-9]+$/.test(v)) continue;
    if (/^(?:[a-z]+[_-])+[a-z]+$/i.test(v)) continue; // snake/kebab words
    if (/^(?:[a-z][a-z0-9]*)(?:[A-Z][a-z0-9]*){1,}$/.test(v)) continue; // camelCase
    if (isPathOfWords(v)) continue; // a URL path or an import path, not a secret
    const isHex = /^[0-9a-fA-F]+$/.test(v);
    const h = entropy(v);
    const threshold = isHex ? ENTROPY_THRESHOLD_HEX : ENTROPY_THRESHOLD_B64;
    if (h < threshold) continue;
    hits.push({
      rule: "entropy",
      label: `high-entropy string (${h.toFixed(1)} bits/char, ${v.length} chars)`,
      excerpt: `${v.slice(0, 4)}…${v.slice(-2)}`,
      index: m.index,
      severity: "high",
    });
  }
  return hits;
}

/**
 * `github.com/some-org/some-repo` and `@scope/pkg-name/sub-path` are long,
 * mixed-case, and score as high entropy — but they are paths, not secrets.
 *
 * Deliberately narrow: every segment must be alphabetic words joined by
 * separators. A base64 blob with `/` in it has digits interleaved through its
 * segments and is still caught, and so is a token in a URL query string, which
 * is the leak vector that actually matters.
 */
function isPathOfWords(v: string): boolean {
  if (!v.includes("/")) return false;
  const segments = v.split("/").filter(Boolean);
  if (segments.length < 2) return false;
  return segments.every((s) => /^[A-Za-z]+(?:[-_.][A-Za-z]+)*\d{0,4}$/.test(s));
}

function runRules(text: string, rules: Rule[]): DetectorHit[] {
  const hits: DetectorHit[] = [];
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = rule.re.exec(text)) !== null && guard++ < 2000) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      if (rule.validate && !rule.validate(m)) continue;
      const raw = m[0];
      hits.push({
        rule: rule.id,
        label: rule.label,
        excerpt: raw.length > 8 ? `${raw.slice(0, 4)}…${raw.slice(-2)}` : "…",
        index: m.index,
        severity: rule.severity,
      });
    }
  }
  return hits;
}

export function findSecrets(text: string): DetectorHit[] {
  return [...runRules(text, SECRET_RULES), ...entropyHits(text)];
}

export function findPii(text: string): DetectorHit[] {
  return runRules(text, PII_RULES);
}

/** Everything the egress gate refuses to let past (§5.4 step 2). */
export function findForbidden(text: string): DetectorHit[] {
  return [...findSecrets(text), ...findPii(text)];
}

export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
