import { BRAND } from "../brand.ts";

/**
 * Markdown → self-contained HTML. No CDN, no external font, no script: this file
 * has to open from a USB stick on a machine with no network (§1.3), and a
 * compliance report that phones home to a CDN would be an embarrassing thing to
 * ship in this particular tool.
 */
export function renderHtml(markdown: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${mdToHtml(markdown)}
</main>
<footer><p>${escapeHtml(BRAND.disclaimer)}</p></footer>
</body>
</html>
`;
}

const CSS = `
:root {
  --fg: #1a1a1a; --bg: #ffffff; --muted: #666; --line: #e2e2e2;
  --accent: #0b5fff; --code-bg: #f6f7f9;
  --crit: #c0392b; --high: #d35400; --med: #b7950b; --low: #2471a3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e6e6e6; --bg: #131417; --muted: #9aa0a6; --line: #2c2e33;
    --accent: #6ea8fe; --code-bg: #1c1e22;
    --crit: #ff6b5e; --high: #ffa64d; --med: #ffd75e; --low: #7fc4ff;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
main { max-width: 62rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
h1, h2, h3, h4 { line-height: 1.25; margin: 2.2rem 0 .8rem; font-weight: 650; }
h1 { font-size: 2rem; margin-top: 0; }
h2 { font-size: 1.45rem; padding-bottom: .35rem; border-bottom: 1px solid var(--line); }
h3 { font-size: 1.15rem; }
h4 { font-size: 1rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
p, ul, ol { margin: .7rem 0; }
li { margin: .25rem 0; }
a { color: var(--accent); }
code {
  background: var(--code-bg); padding: .12em .35em; border-radius: 4px;
  font: .875em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
pre {
  background: var(--code-bg); padding: 1rem; border-radius: 8px;
  overflow-x: auto; border: 1px solid var(--line);
}
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--line); padding: .5rem .7rem; text-align: left; vertical-align: top; }
th { background: var(--code-bg); font-weight: 600; }
blockquote {
  margin: 1rem 0; padding: .75rem 1rem; border-left: 3px solid var(--accent);
  background: var(--code-bg); border-radius: 0 6px 6px 0;
}
blockquote p { margin: .25rem 0; }
details { margin: 1rem 0; border: 1px solid var(--line); border-radius: 8px; padding: .5rem .9rem; }
summary { cursor: pointer; font-weight: 600; }
hr { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
footer {
  max-width: 62rem; margin: 0 auto; padding: 1.25rem; border-top: 1px solid var(--line);
  color: var(--muted); font-size: .875rem;
}
`;

/**
 * A small Markdown subset renderer: headings, tables, lists, code fences,
 * blockquotes, details blocks, links, bold/italic/inline code.
 * Deliberately not a full CommonMark implementation — it renders what this
 * tool actually emits, and nothing else.
 */
export function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (!buf.length) return;
    out.push(`<p>${inline(buf.join(" "))}</p>`);
    buf.length = 0;
  };

  const para: string[] = [];

  while (i < lines.length) {
    const line = lines[i]!;

    // fenced code
    const fence = line.match(/^(`{3,})(\w*)/);
    if (fence) {
      flushParagraph(para);
      const marker = fence[1]!;
      const lang = fence[2] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith(marker)) {
        body.push(lines[i]!);
        i++;
      }
      i++;
      out.push(
        `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapeHtml(body.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // raw html passthrough for the details blocks the report emits
    if (/^<\/?(?:details|summary)\b/.test(line.trim())) {
      flushParagraph(para);
      out.push(line);
      i++;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph(para);
      const level = h[1]!.length;
      const text = h[2]!;
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      out.push(`<h${level} id="${escapeHtml(id)}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (/^---+\s*$/.test(line)) {
      flushParagraph(para);
      out.push("<hr>");
      i++;
      continue;
    }

    // table
    if (line.includes("|") && lines[i + 1] && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]!)) {
      flushParagraph(para);
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      out.push("<table><thead><tr>");
      for (const c of header) out.push(`<th>${inline(c)}</th>`);
      out.push("</tr></thead><tbody>");
      for (const r of rows) {
        out.push("<tr>");
        for (const c of r) out.push(`<td>${inline(c)}</td>`);
        out.push("</tr>");
      }
      out.push("</tbody></table>");
      continue;
    }

    // blockquote
    if (line.startsWith(">")) {
      flushParagraph(para);
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) {
        body.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${mdToHtml(body.join("\n"))}</blockquote>`);
      continue;
    }

    // lists
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flushParagraph(para);
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]!) || /^\s*\d+\.\s+/.test(lines[i]!) || /^\s{2,}\S/.test(lines[i]!))) {
        const l = lines[i]!;
        if (/^\s{2,}\S/.test(l) && items.length) {
          items[items.length - 1] += " " + l.trim();
        } else {
          items.push(l.replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        }
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>`);
      for (const item of items) out.push(`<li>${inline(item)}</li>`);
      out.push(`</${tag}>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph(para);
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushParagraph(para);
  return out.join("\n");
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function inline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, c: string) => `<code>${c}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    const safe = /^(?:https?:|mailto:|#)/i.test(href) ? href : "#";
    return `<a href="${safe}"${safe.startsWith("#") ? "" : ' rel="noreferrer noopener"'}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)]|$)/g, "$1<em>$2</em>");
  s = s.replace(/ {2}$/, "<br>");
  return s;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
