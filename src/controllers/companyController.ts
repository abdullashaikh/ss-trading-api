import { Response } from 'express';
import { callProcedure } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';

export async function getCompanies(req: AuthenticatedRequest, res: Response) {
  try {
    const search = (req.query.search as string) || null;
    const isActive = req.query.is_active !== undefined ? parseInt(req.query.is_active as string, 10) : null;

    const results = await callProcedure('spDataFlowGetCompanies', [search, isActive]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getCompanyById(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = parseInt(String(req.params.id), 10);
    const results = await callProcedure('spDataFlowGetCompanyById', [companyId]);
    const company = (results[0] as any[])[0];

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    res.json({ success: true, data: company });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveCompany(req: AuthenticatedRequest, res: Response) {
  try {
    const { company_id, company_name, contact_number, address, cr_br, opening_balance, notes, is_active } = req.body;
    const userId = req.user?.userId || 1;

    if (!company_name) {
      return res.status(400).json({ success: false, message: 'Company name is required' });
    }

    const results = await callProcedure('spDataFlowAddEditCompany', [
      company_id || 0,
      company_name,
      contact_number || null,
      address || null,
      cr_br || null,
      opening_balance !== undefined ? parseFloat(opening_balance) : 0,
      notes || null,
      is_active !== undefined ? parseInt(is_active, 10) : 1,
      userId
    ]);

    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getPurchases(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = req.query.company_id ? parseInt(req.query.company_id as string, 10) : null;
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetCompanyPurchases', [companyId, startDate, endDate]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function savePurchase(req: AuthenticatedRequest, res: Response) {
  try {
    const {
      purchase_id, purchase_date, company_id, total_chicken_qty,
      total_kg, price_per_kg, total_amount, amount_paid, pending_amount,
      cr_br_reference, notes
    } = req.body;
    const userId = req.user?.userId || 1;

    if (!company_id || !purchase_date || !total_chicken_qty || !total_kg || !price_per_kg) {
      return res.status(400).json({ success: false, message: 'Missing required purchase fields' });
    }

    // Backend financial validation
    const qty = parseInt(total_chicken_qty, 10);
    const kg = parseFloat(total_kg);
    const rate = parseFloat(price_per_kg);
    const calculatedTotal = parseFloat((kg * rate).toFixed(2));
    const paid = amount_paid !== undefined ? parseFloat(amount_paid) : 0.00;
    const calculatedPending = parseFloat((calculatedTotal - paid).toFixed(2));

    const results = await callProcedure('spDataFlowAddEditCompanyPurchase', [
      purchase_id || 0,
      purchase_date,
      company_id,
      qty,
      kg,
      rate,
      calculatedTotal,
      paid,
      calculatedPending,
      cr_br_reference || null,
      notes || null,
      userId
    ]);

    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getPayments(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = req.query.company_id ? parseInt(req.query.company_id as string, 10) : null;
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetCompanyPayments', [companyId, startDate, endDate]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function savePayment(req: AuthenticatedRequest, res: Response) {
  try {
    const { company_payment_id, company_id, payment_date, amount, payment_method, reference_no, notes } = req.body;
    const userId = req.user?.userId || 1;

    if (!company_id || !payment_date || !amount) {
      return res.status(400).json({ success: false, message: 'Company, date, and amount are required' });
    }

    const results = await callProcedure('spDataFlowAddEditCompanyPayment', [
      company_payment_id || 0,
      company_id,
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

export async function getCompanyLedger(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = parseInt(String(req.params.id), 10);
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetCompanyLedger', [companyId, startDate, endDate]);
    const summary = (results[0] as any[])[0] || null;
    const transactions = (results[1] as any[]) || [];

    // Calculate running balance row by row
    let runningBalance = summary ? parseFloat(summary.opening_balance || 0) : 0;
    const computedHistory = transactions.map((tx) => {
      if (tx.tx_type === 'PURCHASE') {
        runningBalance += parseFloat(tx.amount || 0) - parseFloat(tx.paid || 0);
      } else if (tx.tx_type === 'PAYMENT') {
        runningBalance -= parseFloat(tx.paid || 0);
      }
      return {
        ...tx,
        running_balance: parseFloat(runningBalance.toFixed(2))
      };
    });

    res.json({
      success: true,
      data: {
        summary,
        transactions: computedHistory
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}
