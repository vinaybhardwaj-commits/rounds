/**
 * Financial Counselling PDF Generator
 *
 * Generates a printable PDF from a submitted Financial Counselling form.
 * The PDF includes hospital letterhead, all form fields in a clean tabular
 * layout, room rent eligibility calculations, and signature areas.
 *
 * Uses pdf-lib for pure-JS PDF generation — zero filesystem dependencies,
 * fully Vercel-serverless compatible.
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import { FINANCIAL_COUNSELING } from './form-registry';

// ─── Layout constants ──────────────────────────────────────────────
const PAGE_MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89; // A4
const CONTENT_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN;
const FONT_SIZE = { title: 18, heading: 12, body: 10, small: 8, tiny: 7 };

// pdf-lib uses rgb(0-1) not hex
const COLORS = {
  navy: rgb(10 / 255, 31 / 255, 68 / 255),
  blue: rgb(37 / 255, 99 / 255, 235 / 255),
  gray: rgb(107 / 255, 114 / 255, 128 / 255),
  lightGray: rgb(243 / 255, 244 / 255, 246 / 255),
  red: rgb(220 / 255, 38 / 255, 38 / 255),
  border: rgb(209 / 255, 213 / 255, 219 / 255),
  white: rgb(1, 1, 1),
  rowBg: rgb(250 / 255, 250 / 255, 250 / 255),
  sectionBg: rgb(229 / 255, 231 / 255, 235 / 255),
  greenBg: rgb(240 / 255, 253 / 255, 244 / 255),
  redBg: rgb(254 / 255, 242 / 255, 242 / 255),
  green: rgb(22 / 255, 101 / 255, 52 / 255),
};

// ─── Field labels from schema (to display human-readable labels) ──
const FIELD_LABELS: Record<string, string> = {};
for (const section of FINANCIAL_COUNSELING.sections) {
  for (const field of section.fields) {
    FIELD_LABELS[field.key] = field.label;
  }
}

// Option value → label lookup
const OPTION_LABELS: Record<string, Record<string, string>> = {};
for (const section of FINANCIAL_COUNSELING.sections) {
  for (const field of section.fields) {
    if (field.options) {
      OPTION_LABELS[field.key] = {};
      for (const opt of field.options) {
        OPTION_LABELS[field.key][opt.value] = opt.label;
      }
    }
  }
}

/** Format a value for display — resolves select option labels, formats currency */
function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  const strVal = String(value);

  // Resolve select option labels
  if (OPTION_LABELS[key] && OPTION_LABELS[key][strVal]) {
    return OPTION_LABELS[key][strVal];
  }

  // Format currency fields
  if (key.includes('cost') || key.includes('amount') || key.includes('insured') || key.includes('rent') || key === 'package_amount') {
    const num = Number(value);
    if (!isNaN(num) && num > 0) {
      return 'Rs. ' + num.toLocaleString('en-IN');
    }
  }

  return strVal;
}

/** Format a date string to DD/MM/YYYY */
function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/** Truncate text to fit width */
function truncateText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && font.widthOfTextAtSize(truncated + '...', fontSize) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '...';
}

export interface FCPdfOptions {
  formData: Record<string, unknown>;
  patientName: string;
  submissionId: string;
  versionNumber: number;
  submittedBy: string;
  submittedAt: string;
  changeReason?: string;
  parentVersion?: number;
}

/**
 * Generate a Financial Counselling PDF document.
 * Returns a Buffer containing the PDF bytes.
 */
export async function generateFCPdf(opts: FCPdfOptions): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  pdfDoc.setTitle(`Financial Counselling - ${opts.patientName} - v${opts.versionNumber}`);
  pdfDoc.setAuthor('Even Hospital Race Course Road - Rounds v5');
  pdfDoc.setSubject('Financial Counselling Sheet');
  pdfDoc.setCreator('Rounds v5 FC-PDF Generator');

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Cursor tracking (pdf-lib draws from bottom-left, so y decreases as we go down)
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - PAGE_MARGIN;

  /** Get a new page if needed, returns current y */
  function ensureSpace(needed: number): void {
    if (y - needed < PAGE_MARGIN + 30) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - PAGE_MARGIN;
    }
  }

  /** Draw a filled rectangle */
  function drawRect(x: number, yTop: number, w: number, h: number, color: ReturnType<typeof rgb>) {
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, color });
  }

  /** Draw a bordered rectangle */
  function drawBorderedRect(x: number, yTop: number, w: number, h: number, fillColor: ReturnType<typeof rgb>, borderColor: ReturnType<typeof rgb>) {
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, color: fillColor, borderColor, borderWidth: 0.5 });
  }

  /** Draw text at position */
  function drawText(text: string, x: number, yPos: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>) {
    page.drawText(text, { x, y: yPos, size, font, color });
  }

  // ─── Header / Letterhead ───────────────────────────────────
  const titleText = 'Even Hospital';
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, FONT_SIZE.title);
  drawText(titleText, PAGE_MARGIN + (CONTENT_WIDTH - titleWidth) / 2, y, helveticaBold, FONT_SIZE.title, COLORS.navy);
  y -= FONT_SIZE.title + 4;

  const subText = 'Race Course Road, Bengaluru';
  const subWidth = helvetica.widthOfTextAtSize(subText, FONT_SIZE.small);
  drawText(subText, PAGE_MARGIN + (CONTENT_WIDTH - subWidth) / 2, y, helvetica, FONT_SIZE.small, COLORS.gray);
  y -= FONT_SIZE.small + 12;

  // Title bar
  drawRect(PAGE_MARGIN, y, CONTENT_WIDTH, 28, COLORS.navy);
  drawText('FINANCIAL COUNSELLING SHEET', PAGE_MARGIN + 10, y - 18, helveticaBold, FONT_SIZE.heading, COLORS.white);
  y -= 36;

  // Version & meta bar
  const metaLine = [
    `Version: ${opts.versionNumber}`,
    `Date: ${formatDate(opts.submittedAt)}`,
    `By: ${opts.submittedBy}`,
    `ID: ${opts.submissionId.substring(0, 8)}`,
  ].join('  |  ');
  drawText(metaLine, PAGE_MARGIN, y, helvetica, FONT_SIZE.small, COLORS.gray);
  y -= FONT_SIZE.small + 4;

  if (opts.changeReason && opts.parentVersion) {
    const revText = `Revision from v${opts.parentVersion}: ${opts.changeReason}`;
    drawText(revText, PAGE_MARGIN, y, helveticaBold, FONT_SIZE.small, COLORS.red);
    y -= FONT_SIZE.small + 4;
  }

  y -= 8;

  // ─── Patient Name Banner ───────────────────────────────────
  drawRect(PAGE_MARGIN, y, CONTENT_WIDTH, 24, COLORS.lightGray);
  drawText(`Patient: ${opts.patientName}`, PAGE_MARGIN + 8, y - 16, helveticaBold, FONT_SIZE.heading, COLORS.navy);
  y -= 32;

  // ─── Form Sections ─────────────────────────────────────────
  const formData = opts.formData;

  for (const section of FINANCIAL_COUNSELING.sections) {
    // Check if section has any visible data
    const visibleFields = section.fields.filter(f => {
      if (f.visibleWhen) {
        const depVal = formData[f.visibleWhen.field];
        if (f.visibleWhen.operator === 'eq' && depVal !== f.visibleWhen.value) return false;
        if (f.visibleWhen.operator === 'neq' && depVal === f.visibleWhen.value) return false;
        if (f.visibleWhen.operator === 'in' && Array.isArray(f.visibleWhen.value) && !f.visibleWhen.value.includes(depVal as string)) return false;
        if (f.visibleWhen.operator === 'truthy' && !depVal) return false;
      }
      return true;
    });

    if (visibleFields.length === 0) continue;

    // Filter to fields that actually have data
    const fieldsWithData = visibleFields.filter(field => {
      const rawValue = formData[field.key];
      if (field.type === 'checkbox') return true;
      if (rawValue === undefined || rawValue === null || rawValue === '') return false;
      const displayValue = field.type === 'date'
        ? formatDate(String(rawValue || ''))
        : formatValue(field.key, rawValue);
      return displayValue !== '';
    });

    if (fieldsWithData.length === 0) continue;

    ensureSpace(20 + fieldsWithData.length * 18);

    // Section heading
    y -= 4;
    drawRect(PAGE_MARGIN, y, CONTENT_WIDTH, 20, COLORS.sectionBg);
    drawText(section.title.toUpperCase(), PAGE_MARGIN + 6, y - 14, helveticaBold, FONT_SIZE.body, COLORS.navy);
    y -= 24;

    // Fields as key-value rows
    for (const field of fieldsWithData) {
      const rawValue = formData[field.key];

      const displayValue = field.type === 'checkbox'
        ? (rawValue ? '[X] Yes' : '[ ] No')
        : field.type === 'date'
          ? formatDate(String(rawValue || ''))
          : formatValue(field.key, rawValue);

      ensureSpace(18);

      // Row background + border
      drawBorderedRect(PAGE_MARGIN, y, CONTENT_WIDTH, 16, COLORS.rowBg, COLORS.border);

      // Label (left 40%)
      const labelMaxW = CONTENT_WIDTH * 0.4 - 12;
      const truncLabel = truncateText(field.label, helvetica, FONT_SIZE.small, labelMaxW);
      drawText(truncLabel, PAGE_MARGIN + 4, y - 11, helvetica, FONT_SIZE.small, COLORS.gray);

      // Value (right 60%)
      const valueMaxW = CONTENT_WIDTH * 0.6 - 8;
      const truncValue = truncateText(displayValue, helveticaBold, FONT_SIZE.body, valueMaxW);
      drawText(truncValue, PAGE_MARGIN + CONTENT_WIDTH * 0.4, y - 12, helveticaBold, FONT_SIZE.body, COLORS.navy);

      y -= 16;
    }
  }

  // ─── Room Rent Eligibility Calculation Box ──────────────────
  const payMode = formData.payment_mode;
  const sumInsured = Number(formData.sum_insured) || 0;
  const actualRent = Number(formData.actual_room_rent) || 0;
  const hasWaiver = formData.has_room_rent_waiver === true;
  const roomCat = String(formData.room_category || '');

  if ((payMode === 'insurance' || payMode === 'insurance_cash') && sumInsured > 0 && !hasWaiver) {
    ensureSpace(72);
    y -= 10;

    const isICU = roomCat === 'icu' || roomCat === 'nicu';
    const eligibilityPct = isICU ? 0.015 : 0.01;
    const eligibleRent = Math.round(sumInsured * eligibilityPct);
    const proportionalDeduction = actualRent > eligibleRent
      ? Math.round(((actualRent - eligibleRent) / actualRent) * 100)
      : 0;

    const boxColor = proportionalDeduction > 0 ? COLORS.redBg : COLORS.greenBg;
    const textColor = proportionalDeduction > 0 ? COLORS.red : COLORS.green;

    drawBorderedRect(PAGE_MARGIN, y, CONTENT_WIDTH, 60, boxColor, COLORS.border);

    drawText('ROOM RENT ELIGIBILITY CALCULATION', PAGE_MARGIN + 8, y - 14, helveticaBold, FONT_SIZE.body, COLORS.navy);

    const calcLine =
      `Sum Insured: Rs.${sumInsured.toLocaleString('en-IN')}  |  ` +
      `Rate: ${isICU ? '1.5%' : '1%'} (${isICU ? 'ICU' : 'Standard'})  |  ` +
      `Eligible Rent: Rs.${eligibleRent.toLocaleString('en-IN')}/day  |  ` +
      `Actual Rent: Rs.${actualRent.toLocaleString('en-IN')}/day`;
    drawText(calcLine, PAGE_MARGIN + 8, y - 30, helvetica, FONT_SIZE.small, COLORS.gray);

    const riskText = proportionalDeduction > 0
      ? `WARNING: PROPORTIONAL DEDUCTION RISK: ${proportionalDeduction}% -- Insurance may deduct ${proportionalDeduction}% from ENTIRE bill`
      : 'OK: Room rent within eligibility -- no proportional deduction risk';
    drawText(riskText, PAGE_MARGIN + 8, y - 48, helveticaBold, FONT_SIZE.body, textColor);

    y -= 68;
  }

  // ─── Signature Area ─────────────────────────────────────────
  ensureSpace(80);
  y -= 30;

  const sigWidth = CONTENT_WIDTH / 3 - 10;
  const sigLabels = ['Patient / Attendant', 'Counsellor', 'Witness'];
  for (let i = 0; i < 3; i++) {
    const x = PAGE_MARGIN + i * (sigWidth + 15);

    // Signature line
    page.drawLine({
      start: { x, y: y },
      end: { x: x + sigWidth, y: y },
      thickness: 0.5,
      color: COLORS.border,
    });

    // Label under line
    const labelW = helvetica.widthOfTextAtSize(sigLabels[i], FONT_SIZE.small);
    drawText(sigLabels[i], x + (sigWidth - labelW) / 2, y - 12, helvetica, FONT_SIZE.small, COLORS.gray);

    const subLabel = 'Signature & Date';
    const subLabelW = helvetica.widthOfTextAtSize(subLabel, FONT_SIZE.small);
    drawText(subLabel, x + (sigWidth - subLabelW) / 2, y - 22, helvetica, FONT_SIZE.small, COLORS.gray);
  }

  // ─── Footer ─────────────────────────────────────────────────
  const footerY = PAGE_MARGIN + 10;
  const footerLine1 = `System-generated by Rounds v5 | Document ID: ${opts.submissionId} | Generated: ${new Date().toISOString()}`;
  const footerLine2 = 'This document is a legal record of the financial counselling session. Any alterations require a new version.';

  const f1w = helvetica.widthOfTextAtSize(footerLine1, FONT_SIZE.tiny);
  drawText(footerLine1, PAGE_MARGIN + (CONTENT_WIDTH - f1w) / 2, footerY + 10, helvetica, FONT_SIZE.tiny, COLORS.gray);

  const f2w = helvetica.widthOfTextAtSize(footerLine2, FONT_SIZE.tiny);
  drawText(footerLine2, PAGE_MARGIN + (CONTENT_WIDTH - f2w) / 2, footerY, helvetica, FONT_SIZE.tiny, COLORS.gray);

  // Serialize to bytes
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
