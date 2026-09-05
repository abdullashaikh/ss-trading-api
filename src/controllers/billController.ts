import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, callProcedure } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';
import { generateBillPdf, BillData } from '../services/pdfService.js';
import { uploadBillPdf, generateBillPresignedUrl, resolveS3Key } from '../services/s3Service.js';
import { generateWhatsAppShareUrl } from '../services/whatsappService.js';
import { renderBillHtml } from '../services/htmlBillService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Returns the public URL for a bill (e.g. https://<domain>/bill/ST-2026-00011).
 * Uses APP_URL env variable if configured, otherwise derives from request headers/host.
 */
export function getPublicBillUrl(req: Request, billNumber: string): string {
  if (process.env.APP_URL) {
    const base = process.env.APP_URL.replace(/\/+$/, '');
    return `${base}/bill/${encodeURIComponent(billNumber)}`;
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : req.protocol) || 'http';
  const host = req.get('host') || 'localhost:5000';
  return `${protocol}://${host}/bill/${encodeURIComponent(billNumber)}`;
}

export async function getBills(req: AuthenticatedRequest, res: Response) {
  try {
    const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : null;
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;
    const search = (req.query.search as string) || null;

    const results = await callProcedure('spDataFlowGetBills', [customerId, startDate, endDate, search]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getBillById(req: AuthenticatedRequest, res: Response) {
  try {
    const billId = parseInt(String(req.params.id), 10);
    const results = await callProcedure('spDataFlowGetBillById', [billId]);
    const bill = (results[0] as any[])[0] || null;
    const details = (results[1] as any[]) || [];

    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    let pdfLocalPath = bill.pdf_local_path;
    let pdfS3Url = bill.pdf_s3_url;

    if (!pdfLocalPath && !pdfS3Url) {
      try {
        const billDataForPdf: BillData = {
          bill_number: bill.bill_number,
          bill_date: bill.bill_date,
          customer_name_snapshot: bill.customer_name_snapshot,
          customer_mobile_snapshot: bill.customer_mobile_snapshot,
          customer_cr_br_snapshot: bill.customer_cr_br_snapshot,
          customer_address_snapshot: bill.customer_address_snapshot,
          truck_info_snapshot: bill.truck_info_snapshot,
          total_quantity: bill.total_quantity,
          total_kg: bill.total_kg,
          current_bill_amount: bill.current_bill_amount,
          previous_pending_amount: bill.previous_pending_amount,
          total_due_amount: bill.total_due_amount,
          amount_paid: bill.amount_paid,
          final_pending_amount: bill.final_pending_amount,
          items: details
        };
        const pdfBuffer = await generateBillPdf(billDataForPdf);
        const fileName = `${bill.bill_number}.pdf`;
        const uploadRes = await uploadBillPdf(pdfBuffer, fileName);
        pdfLocalPath = uploadRes.localPath;
        pdfS3Url = uploadRes.s3Key || uploadRes.s3Url;
        await callProcedure('spDataFlowUpdateBillPdfUrl', [billId, pdfS3Url, pdfLocalPath]);
      } catch (pdfErr) {
        console.warn('Could not auto-generate missing PDF:', pdfErr);
      }
    }

    const billDownloadUrl = getPublicBillUrl(req, bill.bill_number);

    const whatsappData = generateWhatsAppShareUrl({
      customerName: bill.customer_name_snapshot,
      customerMobile: bill.customer_mobile_snapshot,
      billNumber: bill.bill_number,
      totalQty: bill.total_quantity,
      totalKg: bill.total_kg,
      totalAmount: bill.current_bill_amount,
      finalPending: bill.final_pending_amount,
      billDownloadUrl
    });

    res.json({
      success: true,
      data: {
        ...bill,
        items: details,
        whatsapp_share_url: whatsappData.url,
        whatsapp_message: whatsappData.message
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function createBill(req: AuthenticatedRequest, res: Response) {
  try {
    const {
      bill_id, bill_date, customer_id, truck_id, delivery_id,
      customer_name, customer_mobile, customer_cr_br, customer_address, truck_info,
      amount_paid, notes, items
    } = req.body;
    const userId = req.user?.userId || 1;

    if (!customer_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Customer and box items are required' });
    }

    const itemsJsonStr = JSON.stringify(items);

    // Call stored procedure to create bill
    const results = await callProcedure('spDataFlowAddEditBill', [
      bill_id || 0,
      bill_date || null,
      customer_id,
      truck_id || null,
      delivery_id || null,
      customer_name,
      customer_mobile,
      customer_cr_br || null,
      customer_address || null,
      truck_info || null,
      amount_paid !== undefined ? parseFloat(amount_paid) : 0,
      notes || null,
      userId,
      itemsJsonStr
    ]);

    // Safely locate the result set that contains bill_id
    let createdBillSummary: any = null;
    for (const resSet of results) {
      if (Array.isArray(resSet) && resSet.length > 0 && resSet[0]?.bill_id !== undefined) {
        createdBillSummary = resSet[0];
        break;
      }
    }
    if (!createdBillSummary && Array.isArray(results[0]) && results[0][0]) {
      createdBillSummary = results[0][0];
    }

    const createdBillId = createdBillSummary?.bill_id;
    if (!createdBillId) {
      return res.status(500).json({ success: false, message: 'Failed to retrieve created bill ID' });
    }

    // Fetch full bill data to generate PDF
    const billFullResult = await callProcedure('spDataFlowGetBillById', [createdBillId]);
    const billMaster = (billFullResult[0] as any[])?.[0];
    const billLineItems = (billFullResult[1] as any[]) || [];

    if (!billMaster) {
      return res.status(500).json({ success: false, message: 'Could not fetch created bill details for PDF' });
    }

    const billDataForPdf: BillData = {
      bill_number: billMaster.bill_number,
      bill_date: billMaster.bill_date,
      customer_name_snapshot: billMaster.customer_name_snapshot,
      customer_mobile_snapshot: billMaster.customer_mobile_snapshot,
      customer_cr_br_snapshot: billMaster.customer_cr_br_snapshot,
      customer_address_snapshot: billMaster.customer_address_snapshot,
      truck_info_snapshot: billMaster.truck_info_snapshot,
      total_quantity: billMaster.total_quantity,
      total_kg: billMaster.total_kg,
      current_bill_amount: billMaster.current_bill_amount,
      previous_pending_amount: billMaster.previous_pending_amount,
      total_due_amount: billMaster.total_due_amount,
      amount_paid: billMaster.amount_paid,
      final_pending_amount: billMaster.final_pending_amount,
      items: billLineItems
    };

    // Generate fixed PDF invoice in-memory (zero server disk usage)
    const pdfBuffer = await generateBillPdf(billDataForPdf);
    const fileName = `${billMaster.bill_number}.pdf`;

    // Upload buffer directly to S3 (no local disk files)
    const { s3Url, localPath, s3Key } = await uploadBillPdf(pdfBuffer, fileName);

    // Update bill record with S3 key / virtual path
    const storedS3Ref = s3Key || s3Url;
    await callProcedure('spDataFlowUpdateBillPdfUrl', [createdBillId, storedS3Ref, localPath]);

    // Public URL for bill download/viewing
    const publicBillUrl = getPublicBillUrl(req, billMaster.bill_number);

    // Generate WhatsApp Share URL
    const whatsappData = generateWhatsAppShareUrl({
      customerName: billMaster.customer_name_snapshot,
      customerMobile: billMaster.customer_mobile_snapshot,
      billNumber: billMaster.bill_number,
      totalQty: billMaster.total_quantity,
      totalKg: billMaster.total_kg,
      totalAmount: billMaster.current_bill_amount,
      finalPending: billMaster.final_pending_amount,
      billDownloadUrl: publicBillUrl
    });

    res.json({
      success: true,
      message: 'Bill created and PDF generated successfully',
      data: {
        bill_id: createdBillId,
        bill_number: billMaster.bill_number,
        pdf_url: publicBillUrl,
        whatsapp_share_url: whatsappData.url,
        whatsapp_message: whatsappData.message
      }
    });
  } catch (error: any) {
    console.error('Bill creation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function recordBillPayment(req: AuthenticatedRequest, res: Response) {
  try {
    const { payment_id, customer_id, bill_id, payment_date, amount, payment_method, reference_no, notes } = req.body;
    const userId = req.user?.userId || 1;

    if (!customer_id || !payment_date || !amount) {
      return res.status(400).json({ success: false, message: 'Customer, date, and amount are required' });
    }

    const results = await callProcedure('spDataFlowAddEditBillPayment', [
      payment_id || 0,
      customer_id,
      bill_id || null,
      payment_date,
      parseFloat(amount),
      payment_method || 'Cash',
      reference_no || null,
      notes || null,
      userId
    ]);

    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function buildBillDataForPdf(billId: number): Promise<BillData | null> {
  const billResults = await callProcedure('spDataFlowGetBillById', [billId]);
  const billMaster = (billResults[0] as any[])[0];
  const billDetails = (billResults[1] as any[]) || [];
  if (!billMaster) return null;

  return {
    bill_number: billMaster.bill_number,
    bill_date: billMaster.bill_date ? new Date(billMaster.bill_date).toISOString().split('T')[0] : '',
    customer_name_snapshot: billMaster.customer_name_snapshot,
    customer_mobile_snapshot: billMaster.customer_mobile_snapshot,
    customer_cr_br_snapshot: billMaster.customer_cr_br_snapshot,
    customer_address_snapshot: billMaster.customer_address_snapshot,
    truck_info_snapshot: billMaster.truck_info_snapshot,
    total_quantity: billMaster.total_quantity,
    total_kg: billMaster.total_kg,
    current_bill_amount: billMaster.current_bill_amount,
    previous_pending_amount: billMaster.previous_pending_amount,
    total_due_amount: billMaster.total_due_amount,
    amount_paid: billMaster.amount_paid,
    final_pending_amount: billMaster.final_pending_amount,
    items: billDetails
  };
}

export async function downloadBillPdf(req: AuthenticatedRequest, res: Response) {
  try {
    const fileName = String(req.params.filename);
    const s3Key = `bills/${fileName}`;

    // 1. Redirect to S3 presigned URL if available
    const presignedUrl = await generateBillPresignedUrl(s3Key, 3600, true);
    if (presignedUrl) {
      return res.redirect(302, presignedUrl);
    }

    // 2. Dynamic in-memory PDF generation fallback (zero server disk usage)
    const billNumber = fileName.replace(/\.pdf$/i, '');
    const [rows] = await pool.query(
      'SELECT bill_id FROM t_bill_master WHERE bill_number = ? AND is_deleted = 0 LIMIT 1',
      [billNumber]
    );
    const bill = (rows as any[])[0];
    if (bill) {
      const billData = await buildBillDataForPdf(bill.bill_id);
      if (billData) {
        const pdfBuffer = await generateBillPdf(billData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(pdfBuffer);
      }
    }

    return res.status(404).json({ success: false, message: 'PDF file not found' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * Public route to view/download a bill PDF by bill number.
 * Route: GET /bill/:billNumber
 *
 * 1. Validates that the bill exists in the database.
 * 2. Resolves the S3 object key (e.g. bills/ST-2026-00011.pdf).
 * 3. Generates a temporary AWS S3 presigned GET URL (1-hour expiry).
 * 4. Redirects the browser (302) to the presigned URL.
 * 5. Falls back to generating PDF dynamically in memory (zero server disk usage).
 */
export async function viewBillByNumber(req: Request, res: Response) {
  try {
    const rawBillNumber = String(req.params.billNumber || '').trim();
    if (!rawBillNumber || !/^[A-Za-z0-9_-]+$/.test(rawBillNumber)) {
      return res.status(400).send('Invalid bill number format.');
    }

    const isDownload = req.query.download === '1' || req.query.download === 'true';

    // 1. Find and validate bill in database
    const [rows] = await pool.query(
      'SELECT bill_id, bill_number, pdf_s3_url, pdf_local_path FROM t_bill_master WHERE bill_number = ? AND is_deleted = 0 LIMIT 1',
      [rawBillNumber]
    );
    const bill = (rows as any[])[0];

    if (!bill) {
      return res.status(404).send('Bill not found.');
    }

    // 1. If download is explicitly requested (?download=1 or ?download=true), serve PDF
    if (isDownload) {
      const s3Key = resolveS3Key(bill.pdf_s3_url, bill.bill_number);
      const presignedUrl = await generateBillPresignedUrl(s3Key, 3600, true);
      if (presignedUrl) {
        return res.redirect(302, presignedUrl);
      }

      // Dynamic in-memory PDF fallback
      const billData = await buildBillDataForPdf(bill.bill_id);
      if (billData) {
        const pdfBuffer = await generateBillPdf(billData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${bill.bill_number}.pdf"`);
        return res.send(pdfBuffer);
      }
      return res.status(404).send('Bill PDF document is not available.');
    }

    // 2. Default (WhatsApp link click): Open the bill DIRECTLY in the browser
    // Customers see the invoice instantly without needing to download any file first!
    const billData = await buildBillDataForPdf(bill.bill_id);
    if (billData) {
      const downloadUrl = `/bill/${encodeURIComponent(bill.bill_number)}?download=1`;
      const html = renderBillHtml(billData, downloadUrl);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    return res.status(404).send('Bill document is not available.');
  } catch (error: any) {
    console.error('[BillView] Error retrieving bill PDF:', error);
    return res.status(500).send('Internal server error retrieving bill PDF.');
  }
}

export async function deleteBill(req: AuthenticatedRequest, res: Response) {
  try {
    const billId = parseInt(String(req.params.id), 10);
    const userId = req.user?.userId || 1;
    const results = await callProcedure('spDataFlowDeleteBill', [billId, userId]);
    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result, message: 'Bill soft deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function deleteBillPayment(req: AuthenticatedRequest, res: Response) {
  try {
    const paymentId = parseInt(String(req.params.id), 10);
    const userId = req.user?.userId || 1;
    const results = await callProcedure('spDataFlowDeleteBillPayment', [paymentId, userId]);
    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result, message: 'Bill payment soft deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function updateBillWhatsappStatus(req: AuthenticatedRequest, res: Response) {
  try {
    const billId = parseInt(String(req.params.id), 10);
    const { status } = req.body;
    await callProcedure('spDataFlowUpdateBillWhatsappStatus', [billId, status || 'SENT']);
    res.json({ success: true, message: 'WhatsApp status updated successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}


