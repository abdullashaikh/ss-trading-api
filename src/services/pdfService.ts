import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BillItem {
  box_number: number;
  chicken_quantity: number;
  total_kg: number;
  price_per_kg: number;
  amount: number;
}

export interface BillData {
  bill_number: string;
  bill_date: string;
  customer_name_snapshot: string;
  customer_mobile_snapshot: string;
  customer_cr_br_snapshot?: string | null;
  customer_address_snapshot?: string | null;
  truck_info_snapshot?: string | null;
  total_quantity: number;
  total_kg: number;
  current_bill_amount: number;
  previous_pending_amount: number;
  total_due_amount: number;
  amount_paid: number;
  final_pending_amount: number;
  items: BillItem[];
}

export const ITEMS_PER_PAGE = 50;

/**
 * Generates an image-optimized, compact PDF buffer for SS Trading invoices.
 * Designed specifically for high-resolution WhatsApp mobile viewing and printing.
 *
 * Requirements:
 * 1. Compact column widths for QTY, BOX NO, WEIGHT, RATE, AMOUNT to eliminate empty gaps.
 * 2. Strict pagination: maximum 50 item rows per page (1-50 -> 1 page, 51-100 -> 2 pages, etc.).
 * 3. Consistent header, customer details, and invoice meta across all pages with Page X of Y.
 * 4. Overall totals and final pending balance displayed once on the final page.
 * 5. Professional red-and-white theme.
 */
export async function generateBillPdfBuffer(bill: BillData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // 1. Resolve Fonts Directory
    const fontsDirPrimary = path.resolve(__dirname, '../fonts');
    const fontsDirFallback = path.resolve(__dirname, '../../src/fonts');
    const fontsDir = fs.existsSync(fontsDirPrimary) ? fontsDirPrimary : fontsDirFallback;
    const fontRegular = path.join(fontsDir, 'NirmalaUI.ttf');
    const fontBold = path.join(fontsDir, 'NirmalaUI-Bold.ttf');

    // 2. Pagination Calculations
    const allItems = bill.items || [];
    const totalPages = Math.max(1, Math.ceil(allItems.length / ITEMS_PER_PAGE));

    // 3. Document Dimensions & Layout Constants
    // Ultra-compact 340pt page width designed specifically to eliminate horizontal stretching on mobile WhatsApp
    const PAGE_WIDTH = 340;
    const MARGIN_LEFT = 15;
    const TABLE_WIDTH = 310;
    const RIGHT_EDGE = MARGIN_LEFT + TABLE_WIDTH; // 325

    // Tightly proportioned column widths with zero excessive whitespace:
    // SR: 22, BOX: 48, QTY: 42, WEIGHT: 58, RATE: 58, AMOUNT: 82 => Total = 310pt
    const colDefs = [
      { id: 'sr', x: MARGIN_LEFT, width: 22, align: 'center' as const, label: 'SR\n(ક્રમ)' },
      { id: 'box', x: MARGIN_LEFT + 22, width: 48, align: 'center' as const, label: 'BOX NO\n(બોક્સ)' },
      { id: 'qty', x: MARGIN_LEFT + 70, width: 42, align: 'center' as const, label: 'QTY\n(નંગ)' },
      { id: 'weight', x: MARGIN_LEFT + 112, width: 58, align: 'right' as const, label: 'WT (KG)\n(વજન)' },
      { id: 'rate', x: MARGIN_LEFT + 170, width: 58, align: 'right' as const, label: 'RATE (₹)\n(ભાવ)' },
      { id: 'amount', x: MARGIN_LEFT + 228, width: 82, align: 'right' as const, label: 'AMOUNT (₹)\n(રકમ)' }
    ];

    // Colors
    const primaryColor = '#B91C1C'; // Crimson Brand Red
    const darkGray = '#1F2937';
    const textGray = '#4B5563';
    const borderColor = '#D1D5DB';
    const lightBg = '#F9FAFB';

    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];

    if (fs.existsSync(fontRegular) && fs.existsSync(fontBold)) {
      doc.registerFont('NirmalaUI', fontRegular);
      doc.registerFont('NirmalaUI-Bold', fontBold);
    }

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    // 4. Render Pages
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const isFinalPage = pageNum === totalPages;
      const startIndex = (pageNum - 1) * ITEMS_PER_PAGE;
      const pageItems = allItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);

      // Height calculation for this specific page
      const rowHeight = 16;
      const headerSectionHeight = 132; // Header title, contacts, divider, customer box
      const tableHeaderHeight = 24;
      const rowsTotalHeight = pageItems.length * rowHeight;

      let footerHeight = 0;
      if (isFinalPage) {
        footerHeight = 18 + 6 + 80 + 8 + 40 + 15; // Subtotal + Spacing + Financial Box + Spacing + Terms/Signature + Margin
      } else {
        footerHeight = 22 + 15; // Continuation Bar + Bottom Margin
      }

      const pageHeight = Math.max(340, headerSectionHeight + tableHeaderHeight + rowsTotalHeight + footerHeight);

      // Add Page with custom compact dimensions
      doc.addPage({ size: [PAGE_WIDTH, pageHeight], margin: 0 });

      let currentY = 14;

      // Header Branding: SS TRADING
      doc.fillColor(primaryColor)
         .fontSize(17)
         .font('NirmalaUI-Bold')
         .text('SS TRADING', MARGIN_LEFT, currentY, { width: TABLE_WIDTH, align: 'center' });

      currentY += 20;
      doc.fillColor(darkGray)
         .fontSize(7)
         .font('NirmalaUI-Bold')
         .text('CHICKEN WHOLESALER & DISTRIBUTION NETWORK', MARGIN_LEFT, currentY, { width: TABLE_WIDTH, align: 'center' });

      currentY += 10;
      doc.fillColor(textGray)
         .fontSize(6.5)
         .font('NirmalaUI')
         .text('Phone: +91 9876543210  |  Email: sstrading@example.com', MARGIN_LEFT, currentY, { width: TABLE_WIDTH, align: 'center' });

      currentY += 11;

      // Decorative Brand Divider Line
      doc.strokeColor(primaryColor)
         .lineWidth(1.2)
         .moveTo(MARGIN_LEFT, currentY)
         .lineTo(RIGHT_EDGE, currentY)
         .stroke();

      currentY += 6;

      // Customer & Invoice Details Box
      const metaBoxY = currentY;
      const metaBoxHeight = 46;

      doc.rect(MARGIN_LEFT, metaBoxY, TABLE_WIDTH, metaBoxHeight)
         .fillAndStroke(lightBg, borderColor);

      // Left Column: Customer Details
      doc.fillColor(primaryColor)
         .fontSize(7)
         .font('NirmalaUI-Bold')
         .text('CUSTOMER DETAILS:', MARGIN_LEFT + 6, metaBoxY + 5);

      doc.fillColor(darkGray)
         .fontSize(7.5)
         .font('NirmalaUI-Bold')
         .text(bill.customer_name_snapshot || 'N/A', MARGIN_LEFT + 6, metaBoxY + 16, { width: 145, ellipsis: true });

      doc.fillColor(textGray)
         .fontSize(7)
         .font('NirmalaUI')
         .text(`Phone: ${bill.customer_mobile_snapshot || 'N/A'}`, MARGIN_LEFT + 6, metaBoxY + 28);

      // Right Column: Invoice Details & Pagination Indicator
      const rightColX = MARGIN_LEFT + 160;
      const rightColWidth = TABLE_WIDTH - 160;
      doc.fillColor(primaryColor)
         .fontSize(7)
         .font('NirmalaUI-Bold')
         .text('INVOICE DETAILS:', rightColX, metaBoxY + 5);

      doc.fillColor(darkGray)
         .fontSize(7.5)
         .font('NirmalaUI')
         .text('Bill No: ', rightColX, metaBoxY + 16)
         .font('NirmalaUI-Bold')
         .text(bill.bill_number, rightColX + 35, metaBoxY + 16);

      const formattedDate = bill.bill_date ? String(bill.bill_date).split('T')[0] : '';
      doc.fillColor(textGray)
         .fontSize(7)
         .font('NirmalaUI')
         .text(`Date: ${formattedDate}`, rightColX, metaBoxY + 28)
         .fillColor(primaryColor)
         .font('NirmalaUI-Bold')
         .text(`Page ${pageNum}/${totalPages}`, RIGHT_EDGE - 60, metaBoxY + 28, { width: 54, align: 'right' });

      currentY = metaBoxY + metaBoxHeight + 6;

      // Table Header Row
      const tableTop = currentY;
      doc.rect(MARGIN_LEFT, tableTop, TABLE_WIDTH, tableHeaderHeight)
         .fillAndStroke(primaryColor, primaryColor);

      doc.fillColor('#FFFFFF')
         .fontSize(6.5)
         .font('NirmalaUI-Bold');

      for (const col of colDefs) {
        const textPad = col.align === 'right' ? 3 : 0;
        doc.text(col.label, col.x, tableTop + 3, {
          width: col.width - textPad,
          align: col.align
        });
      }

      currentY = tableTop + tableHeaderHeight;

      // Table Item Rows
      for (let i = 0; i < pageItems.length; i++) {
        const item = pageItems[i];
        const globalSrNo = startIndex + i + 1;
        const rowBg = i % 2 === 0 ? '#FFFFFF' : lightBg;

        doc.rect(MARGIN_LEFT, currentY, TABLE_WIDTH, rowHeight)
           .fillAndStroke(rowBg, '#E5E7EB');

        doc.fillColor(darkGray)
           .fontSize(7.5)
           .font('NirmalaUI');

        // SR
        doc.text(globalSrNo.toString(), colDefs[0].x, currentY + 3.5, { width: colDefs[0].width, align: 'center' });
        // BOX NO
        doc.text(`Box ${item.box_number}`, colDefs[1].x, currentY + 3.5, { width: colDefs[1].width, align: 'center' });
        // QTY
        doc.text(item.chicken_quantity.toString(), colDefs[2].x, currentY + 3.5, { width: colDefs[2].width, align: 'center' });
        // WEIGHT (KG) - 3pt right padding
        doc.text(Number(item.total_kg).toFixed(2), colDefs[3].x, currentY + 3.5, { width: colDefs[3].width - 3, align: 'right' });
        // RATE/KG - 3pt right padding
        doc.text(`₹ ${Number(item.price_per_kg).toFixed(2)}`, colDefs[4].x, currentY + 3.5, { width: colDefs[4].width - 3, align: 'right' });
        // AMOUNT - 3pt right padding
        doc.font('NirmalaUI-Bold')
           .text(`₹ ${Number(item.amount).toFixed(2)}`, colDefs[5].x, currentY + 3.5, { width: colDefs[5].width - 3, align: 'right' });

        currentY += rowHeight;
      }

      // If Intermediate Page: Display Continued Notice
      if (!isFinalPage) {
        currentY += 6;
        doc.rect(MARGIN_LEFT, currentY, TABLE_WIDTH, 20)
           .fillAndStroke('#FEF2F2', '#FECACA');

        doc.fillColor(primaryColor)
           .fontSize(7)
           .font('NirmalaUI-Bold')
           .text(
             `Page ${pageNum}/${totalPages}  •  Items ${startIndex + 1}-${startIndex + pageItems.length} of ${allItems.length}  •  Continued on next page...`,
             MARGIN_LEFT,
             currentY + 5,
             { width: TABLE_WIDTH, align: 'center' }
           );
      } else {
        // Final Page: Display Totals, Financial Summary, Terms & Signature
        // Subtotal Row
        doc.rect(MARGIN_LEFT, currentY, TABLE_WIDTH, 18)
           .fillAndStroke('#E5E7EB', borderColor);

        doc.fillColor(darkGray)
           .font('NirmalaUI-Bold')
           .fontSize(7.5);

        doc.text('TOTAL (કુલ)', colDefs[0].x, currentY + 4, { width: colDefs[0].width + colDefs[1].width, align: 'center' });
        doc.text(bill.total_quantity.toString(), colDefs[2].x, currentY + 4, { width: colDefs[2].width, align: 'center' });
        doc.text(Number(bill.total_kg).toFixed(2), colDefs[3].x, currentY + 4, { width: colDefs[3].width - 3, align: 'right' });
        doc.text('—', colDefs[4].x, currentY + 4, { width: colDefs[4].width, align: 'center' });
        doc.fillColor(primaryColor)
           .text(`₹ ${Number(bill.current_bill_amount).toFixed(2)}`, colDefs[5].x, currentY + 4, { width: colDefs[5].width - 3, align: 'right' });

        currentY += 24;

        // Financial Calculation Summary Box (Placed on right side)
        const summaryBoxWidth = 205;
        const summaryBoxX = RIGHT_EDGE - summaryBoxWidth; // 325 - 205 = 120
        const summaryRowHeight = 16;

        doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight * 5)
           .fillAndStroke('#FFFFFF', borderColor);

        const formatSummaryRow = (label: string, value: number, isBold: boolean = false, highlight: boolean = false) => {
          if (highlight) {
            doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight).fill('#FEE2E2');
          }
          doc.fillColor(highlight ? primaryColor : darkGray)
             .font(isBold ? 'NirmalaUI-Bold' : 'NirmalaUI')
             .fontSize(7.2);

          doc.text(label, summaryBoxX + 6, currentY + 3.5, { width: 124, align: 'left' });
          doc.text(`₹ ${Number(value).toFixed(2)}`, summaryBoxX + 130, currentY + 3.5, { width: 70, align: 'right' });

          doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight).stroke(borderColor);
          currentY += summaryRowHeight;
        };

        formatSummaryRow('Current Bill (હાલનું બિલ):', bill.current_bill_amount);
        formatSummaryRow('Previous Pending (અગાઉની બાકી):', bill.previous_pending_amount);
        formatSummaryRow('Total Due Amount (કુલ બાકી):', bill.total_due_amount, true);
        formatSummaryRow('Amount Paid (ચૂકવેલ રકમ):', bill.amount_paid);
        formatSummaryRow('Final Pending Balance (અંતિમ બાકી):', bill.final_pending_amount, true, true);

        currentY += 10;

        // Terms and Signature Row
        doc.fillColor('#6B7280')
           .fontSize(6)
           .font('NirmalaUI')
           .text('Terms & Conditions:', MARGIN_LEFT, currentY)
           .text('1. All chicken weights checked at delivery.', MARGIN_LEFT, currentY + 8)
           .text('2. Please settle pending balance promptly.', MARGIN_LEFT, currentY + 16);

        doc.fillColor(darkGray)
           .fontSize(7.5)
           .font('NirmalaUI-Bold')
           .text('For SS TRADING', RIGHT_EDGE - 110, currentY, { width: 110, align: 'center' })
           .font('NirmalaUI')
           .fontSize(6.5)
           .text('(Authorized Signatory)', RIGHT_EDGE - 110, currentY + 20, { width: 110, align: 'center' });
      }
    }

    doc.end();
  });
}

export async function generateBillPdf(bill: BillData): Promise<Buffer> {
  return generateBillPdfBuffer(bill);
}
