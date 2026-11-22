import { pdfText, textUnits } from '../export-documents';
import { ZERA_DEADLINE_WORDING } from './zera-wizard-checks';

/** The answers are grouped the way ZERA's own form groups them, by position in the fixed order. */
export const ZERA_SECTIONS: readonly {
  title: string;
  from: number;
  to: number;
  stacked?: boolean;
}[] = [
  { title: 'Representative', from: 0, to: 3 },
  { title: 'Service station', from: 3, to: 8 },
  { title: 'Fuel supplied', from: 8, to: 11 },
  { title: 'Fuel sold', from: 11, to: 13 },
  { title: 'Notes', from: 13, to: 14, stacked: true },
];

/** Drops the "Fuel sold: " style prefix that the section heading already says. */
export function shortLabel(label: string): string {
  return label.replace(/^Fuel (supplied|sold): /, '');
}

export type ZeraPdfInput = {
  answers: readonly { label: string; value: string }[];
  /** e.g. "September 2026" */
  periodLabel: string;
  stationName: string;
  version: number;
  /** ISO date or timestamp the version was saved. */
  savedAt: string;
};

const W = 595;
const H = 842;
const MARGIN = 54;
const INNER = W - 2 * MARGIN;
const LABEL_W = 190;
const VALUE_X = MARGIN + LABEL_W + 16;
const VALUE_W = W - MARGIN - VALUE_X;
const FOOTER_Y = 36;
const BOTTOM = 72;

const INK = '0.09 0.13 0.12';
const MUTED = '0.40 0.45 0.43';
const BRAND = '0.13 0.32 0.26';
const RULE = '0.86 0.88 0.87';
const TINT = '0.95 0.97 0.96';

const r = (n: number): number => Math.round(n * 100) / 100;

function width(text: string, size: number, bold = false): number {
  return (textUnits(text, bold) / 1000) * size;
}

/** Breaks text into lines no wider than the given width, splitting long words if needed. */
function wrap(text: string, maxWidth: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (width(rest, size, bold) > maxWidth) {
        let cut = rest.length - 1;
        while (cut > 1 && width(rest.slice(0, cut), size, bold) > maxWidth) cut -= 1;
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      const candidate = line ? `${line} ${rest}` : rest;
      if (width(candidate, size, bold) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

function dateLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The saved ZERA return as a finished document: a branded cover band, the station and version,
 * ZERA's own deadline wording, then the answers grouped as the ZERA form groups them. Long notes
 * wrap, sections never split mid-row, and every page carries a footer with its number.
 */
export function buildZeraPdf(input: ZeraPdfInput): Buffer {
  const pages: string[][] = [];
  let ops: string[] = [];
  let y = 0;

  const text = (
    value: string,
    x: number,
    baseline: number,
    size: number,
    opts: { bold?: boolean; color?: string; right?: boolean; track?: number } = {},
  ) => {
    const font = opts.bold ? 'F2' : 'F1';
    const at = opts.right ? x - width(value, size, opts.bold) : x;
    const track = `${opts.track ?? 0} Tc `;
    ops.push(
      `BT /${font} ${size} Tf ${track}${opts.color ?? INK} rg ${r(at)} ${r(baseline)} Td (${pdfText(value)}) Tj ET`,
    );
  };
  const rect = (x: number, bottom: number, w: number, h: number, color: string) =>
    ops.push(`${color} rg ${r(x)} ${r(bottom)} ${r(w)} ${r(h)} re f`);
  const line = (x1: number, y1: number, x2: number, color: string, weight = 0.5) =>
    ops.push(`${color} RG ${weight} w ${r(x1)} ${r(y1)} m ${r(x2)} ${r(y1)} l S`);

  const startPage = (first: boolean) => {
    ops = [];
    pages.push(ops);
    if (first) {
      rect(0, H - 150, W, 150, BRAND);
      rect(0, H - 150, W, 3, '0.55 0.78 0.67');
      text('ZERA MONTHLY RETURN', MARGIN, H - 54, 8.5, {
        bold: true,
        color: '0.78 0.9 0.84',
        track: 1.6,
      });
      text(input.periodLabel, MARGIN, H - 92, 28, { bold: true, color: '1 1 1' });
      text(input.stationName, MARGIN, H - 118, 12.5, { color: '0.88 0.95 0.91' });
      y = H - 150 - 30;
    } else {
      text(`ZERA Monthly Return · ${input.periodLabel}`, MARGIN, H - 40, 8.5, { color: MUTED });
      line(MARGIN, H - 50, W - MARGIN, RULE);
      y = H - 80;
    }
  };

  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) startPage(false);
  };

  startPage(true);

  // Facts strip: who, which version, when saved.
  const facts: [string, string][] = [
    ['STATION', input.stationName],
    ['VERSION', String(input.version)],
    ['SAVED', dateLabel(input.savedAt)],
  ];
  const colW = INNER / 3;
  facts.forEach(([label, value], index) => {
    const x = MARGIN + index * colW;
    text(label, x, y, 7.5, { bold: true, color: MUTED, track: 1.2 });
    const shown = wrap(value, colW - 12, 11, true)[0]!;
    text(shown, x, y - 16, 11, { bold: true });
  });
  y -= 34;
  line(MARGIN, y, W - MARGIN, RULE);
  y -= 22;

  // ZERA's own wording, set apart as a note.
  const noteLines = wrap(ZERA_DEADLINE_WORDING, INNER - 28, 9);
  const noteHeight = noteLines.length * 13 + 22;
  rect(MARGIN, y - noteHeight, INNER, noteHeight, TINT);
  rect(MARGIN, y - noteHeight, 3, noteHeight, BRAND);
  text('FROM ZERA', MARGIN + 16, y - 15, 7.5, { bold: true, color: BRAND, track: 1.2 });
  noteLines.forEach((row, index) => {
    text(row, MARGIN + 16, y - 29 - index * 13, 9, { color: '0.22 0.27 0.25' });
  });
  y -= noteHeight + 30;

  const used = new Set<number>();
  for (const section of ZERA_SECTIONS) {
    const rows = input.answers.slice(section.from, section.to);
    rows.forEach((_, i) => used.add(section.from + i));
    if (rows.length === 0) continue;
    ensure(30 + 34);
    text(section.title.toUpperCase(), MARGIN, y, 8, { bold: true, color: BRAND, track: 1.4 });
    y -= 8;
    line(MARGIN, y, W - MARGIN, BRAND, 0.8);
    y -= 4;
    for (const answer of rows) {
      const value = answer.value.trim() || 'Not given';
      const filled = Boolean(answer.value.trim());
      // Long free text (the notes) reads better under its label than beside it.
      const stacked = section.stacked === true;
      const labelLines = wrap(shortLabel(answer.label), stacked ? INNER : LABEL_W, 9.5);
      const valueLines = wrap(value, stacked ? INNER : VALUE_W, 10.5, !stacked);
      const count = stacked
        ? labelLines.length + valueLines.length
        : Math.max(labelLines.length, valueLines.length);
      const height = count * 14 + 11 + (stacked ? 4 : 0);
      ensure(Math.min(height, 120));
      const color = filled ? INK : '0.6 0.64 0.62';
      if (stacked) {
        labelLines.forEach((row, i) =>
          text(row, MARGIN, y - 17 - i * 14 + 6, 9.5, { color: MUTED }),
        );
        valueLines.forEach((row, i) => {
          const baseline = y - 21 - (labelLines.length + i) * 14 + 6;
          if (baseline < BOTTOM - 10) return;
          text(row, MARGIN, baseline, 10.5, { color });
        });
      } else {
        labelLines.forEach((row, i) =>
          text(row, MARGIN, y - 17 - i * 14 + 6, 9.5, { color: MUTED }),
        );
        valueLines.forEach((row, i) =>
          text(row, VALUE_X, y - 17 - i * 14 + 6, 10.5, { bold: filled, color }),
        );
      }
      y -= height;
      line(MARGIN, y, W - MARGIN, RULE, 0.4);
    }
    y -= 24;
  }

  // Footer on every page.
  const total = pages.length;
  pages.forEach((page, index) => {
    ops = page;
    line(MARGIN, FOOTER_Y + 14, W - MARGIN, RULE);
    text(`Prepared with Shanda Fuel · Version ${input.version}`, MARGIN, FOOTER_Y, 8, {
      color: MUTED,
    });
    text(`Page ${index + 1} of ${total}`, W - MARGIN, FOOTER_Y, 8, { color: MUTED, right: true });
  });

  return assemble(pages.map((p) => Buffer.from(p.join('\n'), 'latin1')));
}

function assemble(contents: Buffer[]): Buffer {
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.alloc(0),
    Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      'latin1',
    ),
    Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      'latin1',
    ),
  ];
  const refs: string[] = [];
  for (const content of contents) {
    const pageObject = objects.length + 1;
    refs.push(`${pageObject} 0 R`);
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObject + 1} 0 R >>`,
        'latin1',
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
        content,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${refs.join(' ')}] /Count ${refs.length} >>`);

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let position = parts[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(position);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      object,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    position += chunk.length;
  });
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (let i = 1; i < offsets.length; i += 1) {
    xref.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }
  xref.push(
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(position),
    '%%EOF',
  );
  parts.push(Buffer.from(`${xref.join('\n')}\n`, 'latin1'));
  return Buffer.concat(parts);
}
