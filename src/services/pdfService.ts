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

export async function generateBillPdf(bill: BillData): Promise<string> {
  const uploadDir = path.resolve(__dirname, '../../uploads/bills');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const fileName = `${bill.bill_number}.pdf`;
  const filePath = path.join(uploadDir, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const writeStream = fs.createWriteStream(filePath);

    // Register Nirmala UI font (supports Gujarati / Devanagari / Latin)
    // Resolve fonts dir: works in both dev (tsx src/) and prod (node dist/)
    const fontsDirPrimary = path.resolve(__dirname, '../fonts');
    const fontsDirFallback = path.resolve(__dirname, '../../src/fonts');
    const fontsDir = fs.existsSync(fontsDirPrimary) ? fontsDirPrimary : fontsDirFallback;
    doc.registerFont('NirmalaUI', path.join(fontsDir, 'NirmalaUI.ttf'));
    doc.registerFont('NirmalaUI-Bold', path.join(fontsDir, 'NirmalaUI-Bold.ttf'));

    doc.pipe(writeStream);

    // Primary Colors
    const primaryColor = '#B91C1C'; // Crimson Red
    const darkGray = '#1F2937';
    const lightGray = '#F3F4F6';
    const borderColor = '#D1D5DB';

    // Header: SS TRADING
    doc.fillColor(primaryColor)
       .fontSize(24)
       .font('NirmalaUI-Bold')
       .text('SS TRADING', 40, 40, { align: 'center' });

    doc.fillColor(darkGray)
       .fontSize(10)
       .font('NirmalaUI')
       .text('CHICKEN WHOLESALER & DISTRIBUTION NETWORK', { align: 'center' })
       .text('Phone: +91 9876543210 | Email: sstrading@example.com', { align: 'center' });

    doc.moveDown(0.5);

    // Decorative Line
    doc.strokeColor(primaryColor)
       .lineWidth(2)
       .moveTo(40, doc.y)
       .lineTo(555, doc.y)
       .stroke();

    doc.moveDown(0.8);

    // Invoice Meta / Customer Info Box
    const metaY = doc.y;
    const boxHeight = 75;

    doc.rect(40, metaY, 515, boxHeight)
       .fillAndStroke(lightGray, borderColor);

    // Left Column: Customer Details
    doc.fillColor(darkGray)
       .fontSize(10)
       .font('NirmalaUI-Bold')
       .text('CUSTOMER DETAILS:', 50, metaY + 8);

    doc.font('NirmalaUI')
       .text(`Name: ${bill.customer_name_snapshot}`, 50, metaY + 22)
       .text(`Mobile: ${bill.customer_mobile_snapshot || 'N/A'}`, 50, metaY + 36)
       .text(`CR/BR: ${bill.customer_cr_br_snapshot || 'N/A'}`, 50, metaY + 50)
       .text(`Address: ${bill.customer_address_snapshot || 'N/A'}`, 50, metaY + 64);

    // Right Column: Bill Details
    doc.font('NirmalaUI-Bold')
       .text('BILL DETAILS:', 340, metaY + 8);

    doc.font('NirmalaUI')
       .text(`Bill Number: `, 340, metaY + 22)
       .font('NirmalaUI-Bold')
       .text(`${bill.bill_number}`, 420, metaY + 22)
       .font('NirmalaUI')
       .text(`Date: ${bill.bill_date}`, 340, metaY + 36)
       .text(`Vehicle / Truck: ${bill.truck_info_snapshot || 'N/A'}`, 340, metaY + 50);

    doc.y = metaY + boxHeight + 15;

    // Table Header
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 24)
       .fillAndStroke(primaryColor, primaryColor);

    doc.fillColor('#FFFFFF')
       .fontSize(9)
       .font('NirmalaUI-Bold');

    doc.text('SR (ક્રમ)', 45, tableTop + 7, { width: 30, align: 'center' });
    doc.text('BOX NO (બોક્સ નં)', 85, tableTop + 7, { width: 60, align: 'center' });
    doc.text('QTY (CHICKEN/મરઘા)', 160, tableTop + 7, { width: 90, align: 'center' });
    doc.text('WEIGHT (KG/કિ.ગ્રા.)', 260, tableTop + 7, { width: 80, align: 'right' });
    doc.text('RATE/KG (ભાવ/₹)', 360, tableTop + 7, { width: 80, align: 'right' });
    doc.text('AMOUNT (રકમ/₹)', 460, tableTop + 7, { width: 85, align: 'right' });

    let currentY = tableTop + 24;
    doc.fillColor(darkGray).font('NirmalaUI').fontSize(9);

    bill.items.forEach((item, index) => {
      const rowBg = index % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
      doc.rect(40, currentY, 515, 20).fillAndStroke(rowBg, borderColor);

      doc.fillColor(darkGray);
      doc.text((index + 1).toString(), 45, currentY + 5, { width: 30, align: 'center' });
      doc.text(`Box ${item.box_number}`, 85, currentY + 5, { width: 60, align: 'center' });
      doc.text(item.chicken_quantity.toString(), 160, currentY + 5, { width: 90, align: 'center' });
      doc.text(Number(item.total_kg).toFixed(2), 260, currentY + 5, { width: 80, align: 'right' });
      doc.text(`₹ ${Number(item.price_per_kg).toFixed(2)}`, 360, currentY + 5, { width: 80, align: 'right' });
      doc.text(`₹ ${Number(item.amount).toFixed(2)}`, 460, currentY + 5, { width: 85, align: 'right' });

      currentY += 20;
    });

    // Subtotal Row
    doc.rect(40, currentY, 515, 22).fillAndStroke('#E5E7EB', borderColor);
    doc.fillColor(darkGray).font('NirmalaUI-Bold');
    doc.text('TOTAL (કુલ)', 85, currentY + 6, { width: 60, align: 'center' });
    doc.text(bill.total_quantity.toString(), 160, currentY + 6, { width: 90, align: 'center' });
    doc.text(Number(bill.total_kg).toFixed(2), 260, currentY + 6, { width: 80, align: 'right' });
    doc.text('—', 360, currentY + 6, { width: 80, align: 'right' });
    doc.text(`₹ ${Number(bill.current_bill_amount).toFixed(2)}`, 460, currentY + 6, { width: 85, align: 'right' });

    currentY += 32;

    // Financial Calculation Summary Box (Previous Pending, Total Due, Paid, Final Pending)
    const summaryBoxX = 255;
    const summaryBoxWidth = 300;
    const summaryRowHeight = 20;

    doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight * 5)
       .fillAndStroke('#FFFFFF', borderColor);

    const formatRow = (label: string, value: number, isBold: boolean = false, highlight: boolean = false) => {
      if (highlight) {
        doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight).fill('#FEE2E2');
      }
      doc.fillColor(highlight ? primaryColor : darkGray)
         .font(isBold ? 'NirmalaUI-Bold' : 'NirmalaUI')
         .fontSize(9);

      doc.text(label, summaryBoxX + 10, currentY + 5, { width: 180, align: 'left' });
      doc.text(`₹ ${Number(value).toFixed(2)}`, summaryBoxX + 190, currentY + 5, { width: 100, align: 'right' });

      doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight).stroke(borderColor);
      currentY += summaryRowHeight;
    };

    formatRow('Current Bill Amount (હાલનું બિલ):', bill.current_bill_amount);
    formatRow('Previous Pending (અગાઉની બાકી):', bill.previous_pending_amount);
    formatRow('Total Due Amount (કુલ બાકી):', bill.total_due_amount, true);
    formatRow('Amount Paid (ચૂકવેલ રકમ):', bill.amount_paid);
    formatRow('Final Pending Balance (અંતિમ બાકી):', bill.final_pending_amount, true, true);

    // Terms & Signatures
    currentY += 30;
    doc.fillColor('#6B7280')
       .fontSize(8)
       .font('NirmalaUI')
       .text('Terms & Conditions:', 40, currentY)
       .text('1. All chicken weights and counts checked at delivery.', 40, currentY + 12)
       .text('2. Please settle remaining pending amount as per payment terms.', 40, currentY + 22);

    doc.fillColor(darkGray)
       .fontSize(9)
       .font('NirmalaUI-Bold')
       .text('For SS TRADING', 440, currentY + 10, { align: 'center' })
       .font('NirmalaUI')
       .text('(Authorized Signatory)', 440, currentY + 40, { align: 'center' });

    doc.end();

    writeStream.on('finish', () => resolve(filePath));
    writeStream.on('error', (err) => reject(err));
  });
}
