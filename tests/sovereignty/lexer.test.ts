import { describe, expect, test } from "bun:test";
import { lex, detokenize, langForExt } from "../../src/sovereignty/lexer.ts";

const SAMPLES: Record<string, string> = {
  ts: `
import { createClient } from "@supabase/supabase-js";
// a comment with a secret-looking word: password
/* block
   comment */
export async function calculateEnterpriseTier(userId: string): Promise<number> {
  const rate = 12500;
  const sql = \`SELECT ghana_card_number FROM users WHERE id = \${userId}\`;
  const msg = 'hello';
  return rate;
}
`,
  python: `
import os
# comment
def score_applicant(national_id: str) -> float:
    """docstring
    spans lines"""
    threshold = 0.75
    query = 'SELECT * FROM applicants'
    return threshold
`,
  sql: `
-- comment
CREATE TABLE users (
  id uuid PRIMARY KEY,
  ghana_card_number text NOT NULL,
  email text
);
`,
};

describe("lexer", () => {
  for (const [lang, src] of Object.entries(SAMPLES)) {
    test(`${lang}: detokenize(lex(x)) === x`, () => {
      const tokens = lex(src, lang as never);
      expect(detokenize(tokens)).toBe(src);
    });
  }

  test("unterminated string does not swallow the file", () => {
    const src = `const a = "oops\nconst b = 2;\n`;
    expect(detokenize(lex(src, "ts"))).toBe(src);
  });

  test("escaped quotes stay inside the string token", () => {
    const src = `const a = "he said \\"hi\\"";\n`;
    const tokens = lex(src, "ts");
    expect(detokenize(tokens)).toBe(src);
    const strings = tokens.filter((t) => t.kind === "string");
    expect(strings[0]!.value).toBe('he said \\"hi\\"');
  });

  test("python triple-quoted strings beat single quotes", () => {
    const tokens = lex(`x = """a 'b' c"""\n`, "python");
    const strings = tokens.filter((t) => t.kind === "string");
    expect(strings[0]!.value).toBe("a 'b' c");
  });

  test("comments are classified, not treated as identifiers", () => {
    const tokens = lex(`// secretName here\nconst x = 1;\n`, "ts");
    expect(tokens.some((t) => t.kind === "comment" && t.value.includes("secretName"))).toBe(true);
    expect(tokens.some((t) => t.kind === "ident" && t.value === "secretName")).toBe(false);
  });

  test("langForExt maps the ecosystems we ship", () => {
    expect(langForExt(".tsx")).toBe("ts");
    expect(langForExt(".py")).toBe("python");
    expect(langForExt(".tf")).toBe("hcl");
    expect(langForExt(".unknown")).toBe("generic");
  });

  test("no pathological input hangs the lexer", () => {
    const nasty = "`".repeat(5000) + "'".repeat(5000) + "/*".repeat(2000);
    const started = Date.now();
    const tokens = lex(nasty, "ts");
    expect(Date.now() - started).toBeLessThan(4000);
    expect(detokenize(tokens)).toBe(nasty);
  });
});
