import { Response } from 'express';
import { pool, callProcedure } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';

export async function getPurchaseReport(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = req.query.company_id ? parseInt(req.query.company_id as string, 10) : null;
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetPurchaseReport', [companyId, startDate, endDate]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getSalesReport(req: AuthenticatedRequest, res: Response) {
  try {
    const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : null;
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetSalesReport', [customerId, startDate, endDate]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getWorkerReport(req: AuthenticatedRequest, res: Response) {
  try {
    const workerId = req.query.worker_id ? parseInt(req.query.worker_id as string, 10) : null;
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetWorkerReport', [workerId, startDate, endDate]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getOverallBusinessReport(req: AuthenticatedRequest, res: Response) {
  try {
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetOverallBusinessReport', [startDate, endDate]);
    const report = (results[0] as any[])[0] || {};

    // 1. Integrate Other Miscellaneous Expenses for the requested date period
    const [oeRows] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0.00) as total_other_expenses
       FROM t_other_expense
       WHERE is_deleted = 0
         AND (? IS NULL OR expense_date >= ?)
         AND (? IS NULL OR expense_date <= ?)`,
      [startDate, startDate, endDate, endDate]
    );
    const totalOtherExpenses = parseFloat((oeRows as any[])[0]?.total_other_expenses || '0') || 0;
    report.total_other_expenses = totalOtherExpenses;

    // 2. Compute Grand Total Business Expenses = Vehicle Expenses + Worker Payments + Other Expenses
    const totalVehicleExpenses = parseFloat(report.total_vehicle_expenses || '0') || 0;
    const totalWorkerPayments = parseFloat(report.total_worker_payments || '0') || 0;
    report.grand_total_business_expenses = totalVehicleExpenses + totalWorkerPayments + totalOtherExpenses;

    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}
