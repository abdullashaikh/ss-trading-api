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
 * 1. Compact width (500pt) with proportional, gap-free columns.
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
    const PAGE_WIDTH = 500;
    const MARGIN_LEFT = 20;
    const TABLE_WIDTH = 460;
    const RIGHT_EDGE = MARGIN_LEFT + TABLE_WIDTH; // 480

    // Column Definitions: Total = 460pt
    // SR: 30, BOX NO: 62, QTY: 78, WEIGHT: 85, RATE: 85, AMOUNT: 120
    const colDefs = [
      { id: 'sr', x: MARGIN_LEFT, width: 30, align: 'center' as const, label: 'SR\n(ક્રમ)' },
      { id: 'box', x: MARGIN_LEFT + 30, width: 62, align: 'center' as const, label: 'BOX NO\n(બોક્સ)' },
      { id: 'qty', x: MARGIN_LEFT + 92, width: 78, align: 'center' as const, label: 'QTY (BIRDS)\n(નંગ)' },
      { id: 'weight', x: MARGIN_LEFT + 170, width: 85, align: 'right' as const, label: 'WEIGHT (KG)\n(વજન કિ.ગ્રા.)' },
      { id: 'rate', x: MARGIN_LEFT + 255, width: 85, align: 'right' as const, label: 'RATE/KG (₹)\n(ભાવ)' },
      { id: 'amount', x: MARGIN_LEFT + 340, width: 120, align: 'right' as const, label: 'AMOUNT (₹)\n(રકમ)' }
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
      const rowHeight = 17;
      const headerSectionHeight = 142; // Header title, contacts, divider, customer box
      const tableHeaderHeight = 26;
      const rowsTotalHeight = pageItems.length * rowHeight;

      let footerHeight = 0;
      if (isFinalPage) {
        footerHeight = 22 + 8 + 90 + 10 + 45 + 18; // Subtotal + Spacing + Financial Box + Spacing + Terms/Signature + Margin
      } else {
        footerHeight = 26 + 18; // Continuation Bar + Bottom Margin
      }

      const pageHeight = Math.max(380, headerSectionHeight + tableHeaderHeight + rowsTotalHeight + footerHeight);

      // Add Page with custom compact dimensions
      doc.addPage({ size: [PAGE_WIDTH, pageHeight], margin: 0 });

      let currentY = 16;

      // Header Branding: SS TRADING
      doc.fillColor(primaryColor)
         .fontSize(20)
         .font('NirmalaUI-Bold')
         .text('SS TRADING', MARGIN_LEFT, currentY, { width: TABLE_WIDTH, align: 'center' });

      currentY += 23;
      doc.fillColor(darkGray)
         .fontSize(8)
         .font('NirmalaUI-Bold')
         .text('CHICKEN WHOLESALER & DISTRIBUTION NETWORK', MARGIN_LEFT, currentY, { width: TABLE_WIDTH, align: 'center' });

      currentY += 12;
      doc.fillColor(textGray)
         .fontSize(7.5)
         .font('NirmalaUI')
         .text('Phone: +91 9876543210  |  Email: sstrading@example.com', MARGIN_LEFT, currentY, { width: TABLE_WIDTH, align: 'center' });

      currentY += 13;

      // Decorative Brand Divider Line
      doc.strokeColor(primaryColor)
         .lineWidth(1.5)
         .moveTo(MARGIN_LEFT, currentY)
         .lineTo(RIGHT_EDGE, currentY)
         .stroke();

      currentY += 8;

      // Customer & Invoice Details Box
      const metaBoxY = currentY;
      const metaBoxHeight = 50;

      doc.rect(MARGIN_LEFT, metaBoxY, TABLE_WIDTH, metaBoxHeight)
         .fillAndStroke(lightBg, borderColor);

      // Left Column: Customer Details
      doc.fillColor(primaryColor)
         .fontSize(8)
         .font('NirmalaUI-Bold')
         .text('CUSTOMER DETAILS:', MARGIN_LEFT + 8, metaBoxY + 6);

      doc.fillColor(darkGray)
         .fontSize(8.5)
         .font('NirmalaUI-Bold')
         .text(bill.customer_name_snapshot || 'N/A', MARGIN_LEFT + 8, metaBoxY + 18, { width: 230, ellipsis: true });

      doc.fillColor(textGray)
         .fontSize(8)
         .font('NirmalaUI')
         .text(`Phone: ${bill.customer_mobile_snapshot || 'N/A'}`, MARGIN_LEFT + 8, metaBoxY + 32);

      // Right Column: Invoice Details & Pagination Indicator
      const rightColX = MARGIN_LEFT + 250;
      doc.fillColor(primaryColor)
         .fontSize(8)
         .font('NirmalaUI-Bold')
         .text('INVOICE DETAILS:', rightColX, metaBoxY + 6);

      doc.fillColor(darkGray)
         .fontSize(8.5)
         .font('NirmalaUI')
         .text('Bill No: ', rightColX, metaBoxY + 18)
         .font('NirmalaUI-Bold')
         .text(bill.bill_number, rightColX + 40, metaBoxY + 18);

      const formattedDate = bill.bill_date ? String(bill.bill_date).split('T')[0] : '';
      doc.fillColor(textGray)
         .fontSize(8)
         .font('NirmalaUI')
         .text(`Date: ${formattedDate}`, rightColX, metaBoxY + 32)
         .fillColor(primaryColor)
         .font('NirmalaUI-Bold')
         .text(`Page ${pageNum} of ${totalPages}`, RIGHT_EDGE - 75, metaBoxY + 32, { width: 67, align: 'right' });

      currentY = metaBoxY + metaBoxHeight + 8;

      // Table Header Row
      const tableTop = currentY;
      doc.rect(MARGIN_LEFT, tableTop, TABLE_WIDTH, tableHeaderHeight)
         .fillAndStroke(primaryColor, primaryColor);

      doc.fillColor('#FFFFFF')
         .fontSize(7)
         .font('NirmalaUI-Bold');

      for (const col of colDefs) {
        doc.text(col.label, col.x, tableTop + 4, {
          width: col.width,
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
           .fontSize(8)
           .font('NirmalaUI');

        // SR
        doc.text(globalSrNo.toString(), colDefs[0].x, currentY + 4, { width: colDefs[0].width, align: 'center' });
        // BOX NO
        doc.text(`Box ${item.box_number}`, colDefs[1].x, currentY + 4, { width: colDefs[1].width, align: 'center' });
        // QTY
        doc.text(item.chicken_quantity.toString(), colDefs[2].x, currentY + 4, { width: colDefs[2].width, align: 'center' });
        // WEIGHT (KG)
        doc.text(Number(item.total_kg).toFixed(2), colDefs[3].x, currentY + 4, { width: colDefs[3].width, align: 'right' });
        // RATE/KG
        doc.text(`₹ ${Number(item.price_per_kg).toFixed(2)}`, colDefs[4].x, currentY + 4, { width: colDefs[4].width, align: 'right' });
        // AMOUNT
        doc.font('NirmalaUI-Bold')
           .text(`₹ ${Number(item.amount).toFixed(2)}`, colDefs[5].x, currentY + 4, { width: colDefs[5].width, align: 'right' });

        currentY += rowHeight;
      }

      // If Intermediate Page: Display Continued Notice
      if (!isFinalPage) {
        currentY += 8;
        doc.rect(MARGIN_LEFT, currentY, TABLE_WIDTH, 24)
           .fillAndStroke('#FEF2F2', '#FECACA');

        doc.fillColor(primaryColor)
           .fontSize(8)
           .font('NirmalaUI-Bold')
           .text(
             `Page ${pageNum} of ${totalPages}  •  Items ${startIndex + 1} to ${startIndex + pageItems.length} of ${allItems.length}  •  Continued on Page ${pageNum + 1}...`,
             MARGIN_LEFT,
             currentY + 6,
             { width: TABLE_WIDTH, align: 'center' }
           );
      } else {
        // Final Page: Display Totals, Financial Summary, Terms & Signature
        // Subtotal Row
        doc.rect(MARGIN_LEFT, currentY, TABLE_WIDTH, 20)
           .fillAndStroke('#E5E7EB', borderColor);

        doc.fillColor(darkGray)
           .font('NirmalaUI-Bold')
           .fontSize(8);

        doc.text('TOTAL (કુલ)', colDefs[0].x, currentY + 5, { width: colDefs[0].width + colDefs[1].width, align: 'center' });
        doc.text(bill.total_quantity.toString(), colDefs[2].x, currentY + 5, { width: colDefs[2].width, align: 'center' });
        doc.text(Number(bill.total_kg).toFixed(2), colDefs[3].x, currentY + 5, { width: colDefs[3].width, align: 'right' });
        doc.text('—', colDefs[4].x, currentY + 5, { width: colDefs[4].width, align: 'center' });
        doc.fillColor(primaryColor)
           .text(`₹ ${Number(bill.current_bill_amount).toFixed(2)}`, colDefs[5].x, currentY + 5, { width: colDefs[5].width, align: 'right' });

        currentY += 28;

        // Financial Calculation Summary Box (Placed on right side)
        const summaryBoxWidth = 260;
        const summaryBoxX = RIGHT_EDGE - summaryBoxWidth; // 480 - 260 = 220
        const summaryRowHeight = 18;

        doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight * 5)
           .fillAndStroke('#FFFFFF', borderColor);

        const formatSummaryRow = (label: string, value: number, isBold: boolean = false, highlight: boolean = false) => {
          if (highlight) {
            doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight).fill('#FEE2E2');
          }
          doc.fillColor(highlight ? primaryColor : darkGray)
             .font(isBold ? 'NirmalaUI-Bold' : 'NirmalaUI')
             .fontSize(8);

          doc.text(label, summaryBoxX + 8, currentY + 4, { width: 155, align: 'left' });
          doc.text(`₹ ${Number(value).toFixed(2)}`, summaryBoxX + 165, currentY + 4, { width: 87, align: 'right' });

          doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight).stroke(borderColor);
          currentY += summaryRowHeight;
        };

        formatSummaryRow('Current Bill Amount (હાલનું બિલ):', bill.current_bill_amount);
        formatSummaryRow('Previous Pending (અગાઉની બાકી):', bill.previous_pending_amount);
        formatSummaryRow('Total Due Amount (કુલ બાકી):', bill.total_due_amount, true);
        formatSummaryRow('Amount Paid (ચૂકવેલ રકમ):', bill.amount_paid);
        formatSummaryRow('Final Pending Balance (અંતિમ બાકી):', bill.final_pending_amount, true, true);

        currentY += 12;

        // Terms and Signature Row
        doc.fillColor('#6B7280')
           .fontSize(7)
           .font('NirmalaUI')
           .text('Terms & Conditions:', MARGIN_LEFT, currentY)
           .text('1. All chicken weights and counts verified at delivery.', MARGIN_LEFT, currentY + 10)
           .text('2. Please settle remaining pending amount as per terms.', MARGIN_LEFT, currentY + 19);

        doc.fillColor(darkGray)
           .fontSize(8)
           .font('NirmalaUI-Bold')
           .text('For SS TRADING', RIGHT_EDGE - 130, currentY, { width: 130, align: 'center' })
           .font('NirmalaUI')
           .fontSize(7.5)
           .text('(Authorized Signatory)', RIGHT_EDGE - 130, currentY + 24, { width: 130, align: 'center' });
      }
    }

    doc.end();
  });
}

export async function generateBillPdf(bill: BillData): Promise<Buffer> {
  return generateBillPdfBuffer(bill);
}
