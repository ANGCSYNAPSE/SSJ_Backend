/**
 * A small, dependency-free PDF writer for the receipts and invoices. It draws on one A4 page with the two standard
 * fonts every PDF viewer already has (Helvetica and Helvetica-Bold), so nothing needs embedding and it runs anywhere,
 * including serverless hosting. Those fonts only cover Latin text, so amounts are written "INR 1,100.00" and any
 * other script is shown as "?".
 */

const PAGE_W = 595;
const PAGE_H = 842;

/** Latin-1 only: the rupee sign becomes "Rs.", anything else outside Latin-1 becomes "?". */
const latin = (value) =>
  String(value ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

const escapeText = (s) => latin(s).replace(/[\\()]/g, "\\$&");

/** Rough Helvetica widths (per 1000 units), enough to right-align amounts and wrap lines. */
function width(text, size, bold) {
  let units = 0;
  for (const ch of latin(text)) {
    if (/[0-9]/.test(ch)) units += 556;
    else if (/[ ,.:;|!'`]/.test(ch)) units += 278;
    else if (/[A-Z]/.test(ch)) units += bold ? 720 : 670;
    else if (/[mwMW]/.test(ch)) units += 780;
    else if (/[ilIjt()-]/.test(ch)) units += 300;
    else units += bold ? 590 : 540;
  }
  return (units * size) / 1000;
}

export class Pdf {
  constructor() {
    this.ops = [];
  }

  /** Colours are 0..1 triples. y is measured from the TOP of the page, like a layout on paper. */
  rect(x, top, w, h, [r, g, b]) {
    this.ops.push(`${r} ${g} ${b} rg ${x} ${PAGE_H - top - h} ${w} ${h} re f`);
  }

  line(x1, top1, x2, top2, [r, g, b] = [0.85, 0.8, 0.7], weight = 0.7) {
    this.ops.push(`${r} ${g} ${b} RG ${weight} w ${x1} ${PAGE_H - top1} m ${x2} ${PAGE_H - top2} l S`);
  }

  /** Draws text; `align` is "left", "right" (x is the right edge) or "center". */
  text(value, x, top, { size = 10, bold = false, color = [0.24, 0.09, 0.08], align = "left" } = {}) {
    const w = width(value, size, bold);
    const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    const [r, g, b] = color;
    this.ops.push(`BT ${r} ${g} ${b} rg /${bold ? "F2" : "F1"} ${size} Tf ${left.toFixed(2)} ${PAGE_H - top - size * 0.8} Td (${escapeText(value)}) Tj ET`);
  }

  /** Text wrapped to `maxWidth`; returns the top of the line after the last one. */
  paragraph(value, x, top, maxWidth, { size = 10, lineHeight = size * 1.45, ...style } = {}) {
    const words = latin(value).split(" ");
    let current = "";
    let y = top;
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (current && width(next, size, style.bold) > maxWidth) {
        this.text(current, x, y, { size, ...style });
        y += lineHeight;
        current = word;
      } else {
        current = next;
      }
    }
    if (current) {
      this.text(current, x, y, { size, ...style });
      y += lineHeight;
    }
    return y;
  }

  toBuffer() {
    const content = this.ops.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    ];
    let out = "%PDF-1.4\n";
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}

const MAROON = [0.42, 0.12, 0.12];
const ORANGE = [0.91, 0.47, 0.13];
const GREY = [0.55, 0.52, 0.5];
const GREEN = [0.09, 0.55, 0.25];
const RED = [0.8, 0.15, 0.15];

export const inr = (n) => {
  const abs = Math.abs(Number(n)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "- " : ""}INR ${abs}`;
};

/**
 * Draws a receipt or an invoice.
 * doc: { title, numberLabel, number, date, status, statusTone, billedTo:{name,email,mobile},
 *        lines:[{description, reference, amount}], summary:[{label, value, strong, tone}], notes:[string], supportEmail, siteUrl }
 */
export function renderDocumentPdf(doc) {
  const pdf = new Pdf();

  // Header band
  pdf.rect(0, 0, PAGE_W, 86, MAROON);
  pdf.text("SHYAM JAGAT", 40, 28, { size: 24, bold: true, color: [1, 1, 1] });
  pdf.text("Faith, Service, Humanity", 40, 58, { size: 10, color: [0.96, 0.85, 0.7] });
  pdf.text(doc.title, PAGE_W - 40, 32, { size: 24, bold: true, color: [1, 0.78, 0.5], align: "right" });
  pdf.rect(0, 86, PAGE_W, 4, ORANGE);

  // Billed to / meta
  pdf.text("BILLED TO", 40, 118, { size: 8, bold: true, color: GREY });
  pdf.text(doc.billedTo.name, 40, 134, { size: 13, bold: true });
  pdf.text(doc.billedTo.email, 40, 154, { size: 10 });
  if (doc.billedTo.mobile) pdf.text(doc.billedTo.mobile, 40, 169, { size: 10 });

  const meta = [
    [doc.numberLabel, doc.number],
    ["Date", doc.date],
  ];
  meta.forEach(([label, value], i) => {
    pdf.text(label.toUpperCase(), 330, 118 + i * 34, { size: 8, bold: true, color: GREY });
    pdf.text(value, 330, 132 + i * 34, { size: 11, bold: true });
  });
  pdf.text(doc.status, PAGE_W - 40, 130, { size: 15, bold: true, align: "right", color: doc.statusTone === "good" ? GREEN : doc.statusTone === "bad" ? RED : ORANGE });

  // Lines
  let top = 214;
  pdf.rect(40, top, PAGE_W - 80, 24, [0.99, 0.95, 0.87]);
  pdf.text("DESCRIPTION", 50, top + 8, { size: 8, bold: true, color: GREY });
  pdf.text("REFERENCE", 300, top + 8, { size: 8, bold: true, color: GREY });
  pdf.text("AMOUNT", PAGE_W - 50, top + 8, { size: 8, bold: true, color: GREY, align: "right" });
  top += 24;
  for (const line of doc.lines) {
    let next = pdf.paragraph(line.description, 50, top + 8, 230, { size: 10 });
    if (line.reference) pdf.paragraph(line.reference, 300, top + 8, 150, { size: 9, color: GREY });
    pdf.text(inr(line.amount), PAGE_W - 50, top + 8, { size: 10, bold: true, align: "right", color: line.amount < 0 ? RED : [0.24, 0.09, 0.08] });
    next = Math.max(next + 4, top + 28);
    pdf.line(40, next, PAGE_W - 40, next);
    top = next;
  }

  // Summary
  top += 14;
  for (const row of doc.summary) {
    const color = row.tone === "bad" ? RED : row.tone === "good" ? GREEN : [0.24, 0.09, 0.08];
    if (row.strong) {
      pdf.rect(330, top - 4, PAGE_W - 370, 28, [0.99, 0.95, 0.87]);
      pdf.text(row.label, 340, top + 3, { size: 11, bold: true });
      pdf.text(row.value, PAGE_W - 50, top + 2, { size: 13, bold: true, align: "right", color });
      top += 34;
    } else {
      pdf.text(row.label, 340, top, { size: 10, color: GREY });
      pdf.text(row.value, PAGE_W - 50, top, { size: 10, bold: true, align: "right", color });
      top += 20;
    }
  }

  // Notes and footer
  let notesTop = Math.max(top + 24, 620);
  for (const note of doc.notes ?? []) notesTop = pdf.paragraph(note, 40, notesTop, PAGE_W - 80, { size: 9, color: GREY }) + 2;
  pdf.line(40, 780, PAGE_W - 40, 780, ORANGE, 1);
  pdf.text("This is a computer-generated document and needs no signature.", 40, 790, { size: 8.5, color: GREY });
  pdf.text(`${doc.supportEmail}  |  ${doc.siteUrl}`, PAGE_W - 40, 790, { size: 8.5, color: GREY, align: "right" });
  pdf.text("Jai Shri Shyam", PAGE_W / 2, 812, { size: 9, bold: true, color: MAROON, align: "center" });

  return pdf.toBuffer();
}
