import { BRAND } from "../brand.ts";

/**
 * A minimal PDF writer, dependency-free.
 *
 * The binary must work with no network and no toolchain on the target machine
 * (§1.1), so shelling out to pandoc or wkhtmltopdf is not an option. This
 * produces a plain, paginated, text-only PDF using the base-14 fonts every
 * reader has built in — enough to hand a report to a lawyer who wants a PDF,
 * and honest about being no more than that.
 */

interface Line {
  text: string;
  font: "regular" | "bold" | "mono" | "italic";
  size: number;
  spaceBefore: number;
  indent: number;
}

const PAGE_W = 595.28; // A4 points
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LEADING = 1.35;

export function renderPdf(markdown: string, title: string): Uint8Array {
  const lines = layout(markdown);
  const pages = paginate(lines);
  return assemble(pages, title);
}

/* ───────────────────────── markdown → typeset lines ───────────────────────── */

function layout(md: string): Line[] {
  const out: Line[] = [];
  const src = md.split("\n");
  let inCode = false;

  for (let i = 0; i < src.length; i++) {
    const raw = src[i]!;

    if (/^```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      for (const w of wrap(raw, 92)) {
        out.push({ text: w, font: "mono", size: 8.5, spaceBefore: 0, indent: 10 });
      }
      continue;
    }

    if (/^<\/?(?:details|summary)/.test(raw.trim())) continue;

    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1]!.length;
      const size = [19, 15, 12.5, 11, 10.5, 10][level - 1] ?? 10;
      for (const w of wrap(strip(h[2]!), Math.floor(CONTENT_W / (size * 0.5)))) {
        out.push({ text: w, font: "bold", size, spaceBefore: level <= 2 ? 14 : 9, indent: 0 });
      }
      continue;
    }

    if (/^---+\s*$/.test(raw)) {
      out.push({ text: "─".repeat(60), font: "regular", size: 9, spaceBefore: 6, indent: 0 });
      continue;
    }

    // table rows render as pipe-separated text; a real table engine is out of scope
    if (raw.includes("|") && raw.trim().startsWith("|")) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) continue;
      const cells = raw.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => strip(c.trim()));
      const text = cells.join("  ·  ");
      for (const w of wrap(text, 100)) {
        out.push({ text: w, font: "mono", size: 8, spaceBefore: 0, indent: 6 });
      }
      continue;
    }

    if (raw.startsWith(">")) {
      for (const w of wrap(strip(raw.replace(/^>\s?/, "")), 88)) {
        out.push({ text: w, font: "italic", size: 9.5, spaceBefore: 0, indent: 14 });
      }
      continue;
    }

    const li = raw.match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const depth = Math.floor((li[1]!.length || 0) / 2);
      const bullet = "• ";
      const wrapped = wrap(bullet + strip(li[2]!), 92 - depth * 4);
      for (const [j, w] of wrapped.entries()) {
        out.push({
          text: j === 0 ? w : "  " + w,
          font: "regular",
          size: 10,
          spaceBefore: 0,
          indent: 12 + depth * 12,
        });
      }
      continue;
    }

    if (!raw.trim()) {
      out.push({ text: "", font: "regular", size: 10, spaceBefore: 4, indent: 0 });
      continue;
    }

    for (const w of wrap(strip(raw), 95)) {
      out.push({ text: w, font: "regular", size: 10, spaceBefore: 0, indent: 0 });
    }
  }

  return out;
}

function strip(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|\s)_([^_]+)_/g, "$1$2")
    .replace(/[🔴🟠🟡🔵⚪⚠️ℹ️✓✗]/gu, "")
    .trim();
}

function wrap(text: string, cols: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) {
      line = w;
    } else if ((line + " " + w).length <= cols) {
      line += " " + w;
    } else {
      out.push(line);
      line = w;
    }
    // a single word longer than the column: hard-break it
    while (line.length > cols) {
      out.push(line.slice(0, cols));
      line = line.slice(cols);
    }
  }
  if (line) out.push(line);
  return out;
}

function paginate(lines: Line[]): Line[][] {
  const pages: Line[][] = [];
  let current: Line[] = [];
  let y = 0;
  const usable = PAGE_H - MARGIN * 2 - 20; // leave room for the footer

  for (const line of lines) {
    const h = line.size * LEADING + line.spaceBefore;
    if (y + h > usable) {
      pages.push(current);
      current = [];
      y = 0;
    }
    current.push(line);
    y += h;
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}

/* ───────────────────────── PDF assembly ───────────────────────── */

const FONT_REF: Record<Line["font"], string> = {
  regular: "/F1",
  bold: "/F2",
  mono: "/F3",
  italic: "/F4",
};

function assemble(pages: Line[][], title: string): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length; // 1-indexed object number
  };

  // Fonts first so their object numbers are stable.
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const f3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  const f4 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");

  const pagesObjNumber = objects.length + 1 + pages.length * 2 + 1;
  const pageRefs: number[] = [];

  for (const [index, page] of pages.entries()) {
    const stream = contentStream(page, index + 1, pages.length);
    const contentObj = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageObj = add(
      `<< /Type /Page /Parent ${pagesObjNumber} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R /F4 ${f4} 0 R >> >> ` +
        `/Contents ${contentObj} 0 R >>`,
    );
    pageRefs.push(pageObj);
  }

  const pagesObj = add(
    `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`,
  );
  const infoObj = add(
    `<< /Title (${pdfString(title)}) /Producer (${pdfString(`${BRAND.display} v${BRAND.version}`)}) ` +
      `/Creator (${pdfString(BRAND.name)}) >>`,
  );
  const catalogObj = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  // Serialise
  let pdf = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefStart = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R /Info ${infoObj} 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;

  return latin1Bytes(pdf);
}

function contentStream(page: Line[], pageNo: number, total: number): string {
  const parts: string[] = ["BT"];
  let y = PAGE_H - MARGIN;
  let currentFont = "";
  let currentSize = 0;

  for (const line of page) {
    y -= line.spaceBefore;
    const ref = FONT_REF[line.font];
    if (ref !== currentFont || line.size !== currentSize) {
      parts.push(`${ref} ${line.size} Tf`);
      currentFont = ref;
      currentSize = line.size;
    }
    y -= line.size * LEADING;
    parts.push(`1 0 0 1 ${(MARGIN + line.indent).toFixed(2)} ${y.toFixed(2)} Tm`);
    parts.push(`(${pdfString(line.text)}) Tj`);
  }

  parts.push("/F1 8 Tf");
  parts.push(`1 0 0 1 ${MARGIN} ${MARGIN - 22} Tm`);
  parts.push(`(${pdfString(`${BRAND.display} — not legal advice — page ${pageNo} of ${total}`)}) Tj`);
  parts.push("ET");
  return parts.join("\n");
}

/** WinAnsi-safe string with PDF escaping. */
function pdfString(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "(" || ch === ")" || ch === "\\") {
      out += "\\" + ch;
    } else if (code < 32) {
      out += " ";
    } else if (code < 127) {
      out += ch;
    } else if (code === 0x2014 || code === 0x2013) {
      out += "-";
    } else if (code === 0x2018 || code === 0x2019) {
      out += "'";
    } else if (code === 0x201c || code === 0x201d) {
      out += '"';
    } else if (code === 0x2026) {
      out += "...";
    } else if (code === 0x2500 || code === 0x00b7) {
      out += code === 0x2500 ? "-" : "\\267";
    } else if (code === 0x2022) {
      out += "\\267";
    } else if (code < 256) {
      out += "\\" + code.toString(8).padStart(3, "0");
    } else {
      out += "?";
    }
  }
  return out;
}

function byteLength(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.codePointAt(0)! < 256 ? 1 : 1;
  return n;
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[i] = code < 256 ? code : 63; // '?'
  }
  return out;
}
