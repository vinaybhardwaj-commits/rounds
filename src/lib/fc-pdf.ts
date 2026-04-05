/**
 * Financial Counselling PDF Generator
 *
 * Generates a printable PDF from a submitted Financial Counselling form.
 * The PDF includes hospital letterhead, all form fields in a clean tabular
 * layout, room rent eligibility calculations, and signature areas.
 *
 * Uses pdfkit for pure-JS PDF generation (no binary deps, Vercel-compatible).
 */

import PDFDocument from 'pdfkit';
import { FINANCIAL_COUNSELING } from './form-registry';

// ─── Layout constants ──────────────────────────────────────────────
const PAGE_MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN;
const FONT_SIZE = { title: 18, heading: 12, body: 10, small: 8 };
const COLORS = { navy: '#0A1F44', blue: '#2563EB', gray: '#6B7280', lightGray: '#F3F4F6', red: '#DC2626', border: '#D1D5DB' };

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
  if (value === null || value === undefined || value === '') return '—';
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
      return '₹ ' + num.toLocaleString('en-IN');
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

interface FCPdfOptions {
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
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
        info: {
          Title: `Financial Counselling - ${opts.patientName} - v${opts.versionNumber}`,
          Author: 'Even Hospital Race Course Road — Rounds v5',
          Subject: 'Financial Counselling Sheet',
          Creator: 'Rounds v5 FC-PDF Generator',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ─── Header / Letterhead ───────────────────────────────────
      doc.fontSize(FONT_SIZE.title).fillColor(COLORS.navy).font('Helvetica-Bold');
      doc.text('Even Hospital', PAGE_MARGIN, PAGE_MARGIN, { align: 'center', width: CONTENT_WIDTH });
      doc.fontSize(FONT_SIZE.small).fillColor(COLORS.gray).font('Helvetica');
      doc.text('Race Course Road, Bengaluru', { align: 'center', width: CONTENT_WIDTH });
      doc.moveDown(0.5);

      // Title bar
      const titleY = doc.y;
      doc.rect(PAGE_MARGIN, titleY, CONTENT_WIDTH, 28).fill(COLORS.navy);
      doc.fontSize(FONT_SIZE.heading).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text('FINANCIAL COUNSELLING SHEET', PAGE_MARGIN + 10, titleY + 8, { width: CONTENT_WIDTH - 20 });
      doc.y = titleY + 36;

      // Version & meta bar
      doc.fontSize(FONT_SIZE.small).fillColor(COLORS.gray).font('Helvetica');
      const metaLine = [
        `Version: ${opts.versionNumber}`,
        `Date: ${formatDate(opts.submittedAt)}`,
        `By: ${opts.submittedBy}`,
        `ID: ${opts.submissionId.substring(0, 8)}`,
      ].join('  |  ');
      doc.text(metaLine, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });

      if (opts.changeReason && opts.parentVersion) {
        doc.fillColor(COLORS.red).font('Helvetica-Bold');
        doc.text(`Revision from v${opts.parentVersion}: ${opts.changeReason}`, PAGE_MARGIN, doc.y + 2, { width: CONTENT_WIDTH });
        doc.font('Helvetica').fillColor(COLORS.gray);
      }

      doc.moveDown(0.8);

      // ─── Patient Name Banner ───────────────────────────────────
      const bannerY = doc.y;
      doc.rect(PAGE_MARGIN, bannerY, CONTENT_WIDTH, 24).fill(COLORS.lightGray);
      doc.fontSize(FONT_SIZE.heading).fillColor(COLORS.navy).font('Helvetica-Bold');
      doc.text(`Patient: ${opts.patientName}`, PAGE_MARGIN + 8, bannerY + 6, { width: CONTENT_WIDTH - 16 });
      doc.y = bannerY + 32;

      // ─── Form Sections ─────────────────────────────────────────
      const formData = opts.formData;

      for (const section of FINANCIAL_COUNSELING.sections) {
        // Check if section has any visible data
        const visibleFields = section.fields.filter(f => {
          // Check conditional visibility
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

        // Check page space — add new page if needed
        if (doc.y > 700) {
          doc.addPage();
        }

        // Section heading
        doc.moveDown(0.3);
        const sectionY = doc.y;
        doc.rect(PAGE_MARGIN, sectionY, CONTENT_WIDTH, 20).fill('#E5E7EB');
        doc.fontSize(FONT_SIZE.body).fillColor(COLORS.navy).font('Helvetica-Bold');
        doc.text(section.title.toUpperCase(), PAGE_MARGIN + 6, sectionY + 5, { width: CONTENT_WIDTH - 12 });
        doc.y = sectionY + 24;

        // Fields as key-value rows
        for (const field of visibleFields) {
          const rawValue = formData[field.key];
          if (rawValue === undefined && field.type !== 'checkbox') continue;

          const displayValue = field.type === 'checkbox'
            ? (rawValue ? '☑ Yes' : '☐ No')
            : field.type === 'date'
              ? formatDate(String(rawValue || ''))
              : formatValue(field.key, rawValue);

          if (displayValue === '—' && field.type !== 'checkbox') continue;

          // Check page space
          if (doc.y > 750) {
            doc.addPage();
          }

          const rowY = doc.y;
          // Light alternating row background
          doc.rect(PAGE_MARGIN, rowY, CONTENT_WIDTH, 16).fill('#FAFAFA');
          doc.rect(PAGE_MARGIN, rowY, CONTENT_WIDTH, 16).stroke(COLORS.border);

          // Label (left 40%)
          doc.fontSize(FONT_SIZE.small).fillColor(COLORS.gray).font('Helvetica');
          doc.text(field.label, PAGE_MARGIN + 4, rowY + 4, { width: CONTENT_WIDTH * 0.4 - 8, lineBreak: false });

          // Value (right 60%)
          doc.fontSize(FONT_SIZE.body).fillColor(COLORS.navy).font('Helvetica-Bold');
          doc.text(displayValue, PAGE_MARGIN + CONTENT_WIDTH * 0.4, rowY + 3, { width: CONTENT_WIDTH * 0.6 - 4, lineBreak: false });

          doc.y = rowY + 16;
        }
      }

      // ─── Room Rent Eligibility Calculation Box ──────────────────
      const payMode = formData.payment_mode;
      const sumInsured = Number(formData.sum_insured) || 0;
      const actualRent = Number(formData.actual_room_rent) || 0;
      const hasWaiver = formData.has_room_rent_waiver === true;
      const roomCat = String(formData.room_category || '');

      if ((payMode === 'insurance' || payMode === 'insurance_cash') && sumInsured > 0 && !hasWaiver) {
        if (doc.y > 680) doc.addPage();

        doc.moveDown(0.8);
        const calcY = doc.y;
        const isICU = roomCat === 'icu' || roomCat === 'nicu';
        const eligibilityPct = isICU ? 0.015 : 0.01;
        const eligibleRent = Math.round(sumInsured * eligibilityPct);
        const proportionalDeduction = actualRent > eligibleRent
          ? Math.round(((actualRent - eligibleRent) / actualRent) * 100)
          : 0;

        const boxColor = proportionalDeduction > 0 ? '#FEF2F2' : '#F0FDF4';
        const textColor = proportionalDeduction > 0 ? COLORS.red : '#166534';

        doc.rect(PAGE_MARGIN, calcY, CONTENT_WIDTH, 60).fill(boxColor).stroke(COLORS.border);
        doc.fontSize(FONT_SIZE.body).fillColor(COLORS.navy).font('Helvetica-Bold');
        doc.text('ROOM RENT ELIGIBILITY CALCULATION', PAGE_MARGIN + 8, calcY + 6, { width: CONTENT_WIDTH - 16 });

        doc.fontSize(FONT_SIZE.small).fillColor(COLORS.gray).font('Helvetica');
        doc.text(
          `Sum Insured: ₹${sumInsured.toLocaleString('en-IN')}  |  ` +
          `Rate: ${isICU ? '1.5%' : '1%'} (${isICU ? 'ICU' : 'Standard'})  |  ` +
          `Eligible Rent: ₹${eligibleRent.toLocaleString('en-IN')}/day  |  ` +
          `Actual Rent: ₹${actualRent.toLocaleString('en-IN')}/day`,
          PAGE_MARGIN + 8, calcY + 22, { width: CONTENT_WIDTH - 16 }
        );

        doc.fontSize(FONT_SIZE.body).fillColor(textColor).font('Helvetica-Bold');
        const riskText = proportionalDeduction > 0
          ? `⚠ PROPORTIONAL DEDUCTION RISK: ${proportionalDeduction}% — Insurance may deduct ${proportionalDeduction}% from ENTIRE bill`
          : '✓ Room rent within eligibility — no proportional deduction risk';
        doc.text(riskText, PAGE_MARGIN + 8, calcY + 40, { width: CONTENT_WIDTH - 16 });

        doc.y = calcY + 68;
      }

      // ─── Signature Area ─────────────────────────────────────────
      if (doc.y > 640) doc.addPage();

      doc.moveDown(2);
      const sigY = doc.y;

      // Three signature blocks
      const sigWidth = CONTENT_WIDTH / 3 - 10;
      const sigLabels = ['Patient / Attendant', 'Counsellor', 'Witness'];
      for (let i = 0; i < 3; i++) {
        const x = PAGE_MARGIN + i * (sigWidth + 15);
        doc.moveTo(x, sigY + 30).lineTo(x + sigWidth, sigY + 30).stroke(COLORS.border);
        doc.fontSize(FONT_SIZE.small).fillColor(COLORS.gray).font('Helvetica');
        doc.text(sigLabels[i], x, sigY + 34, { width: sigWidth, align: 'center' });
        doc.text('Signature & Date', x, sigY + 44, { width: sigWidth, align: 'center' });
      }

      // ─── Footer ─────────────────────────────────────────────────
      doc.fontSize(FONT_SIZE.small - 1).fillColor(COLORS.gray).font('Helvetica');
      const footerY = doc.page.height - PAGE_MARGIN - 20;
      doc.text(
        `System-generated by Rounds v5 | Document ID: ${opts.submissionId} | Generated: ${new Date().toISOString()}`,
        PAGE_MARGIN, footerY, { width: CONTENT_WIDTH, align: 'center' }
      );
      doc.text(
        'This document is a legal record of the financial counselling session. Any alterations require a new version.',
        PAGE_MARGIN, footerY + 10, { width: CONTENT_WIDTH, align: 'center' }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
