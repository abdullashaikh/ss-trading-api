import { Response } from 'express';
import { callProcedure } from '../config/db.js';
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
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}
