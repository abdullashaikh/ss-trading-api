import { Response } from 'express';
import { callProcedure } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';

export async function getWorkers(req: AuthenticatedRequest, res: Response) {
  try {
    const search = (req.query.search as string) || null;
    const isActive = req.query.is_active !== undefined ? parseInt(req.query.is_active as string, 10) : null;

    const results = await callProcedure('spDataFlowGetWorkers', [search, isActive]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getWorkerById(req: AuthenticatedRequest, res: Response) {
  try {
    const workerId = parseInt(String(req.params.id), 10);
    const results = await callProcedure('spDataFlowGetWorkerById', [workerId]);
    const worker = (results[0] as any[])[0];

    if (!worker) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }
    res.json({ success: true, data: worker });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveWorker(req: AuthenticatedRequest, res: Response) {
  try {
    const { worker_id, worker_name, mobile, role, opening_balance, notes, is_active } = req.body;
    const userId = req.user?.userId || 1;

    if (!worker_name) {
      return res.status(400).json({ success: false, message: 'Worker name is required' });
    }

    const results = await callProcedure('spDataFlowAddEditWorker', [
      worker_id || 0,
      worker_name,
      mobile || null,
      role || 'Worker',
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

export async function getWorkerPayments(req: AuthenticatedRequest, res: Response) {
  try {
    const workerId = req.query.worker_id ? parseInt(req.query.worker_id as string, 10) : null;
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetWorkerPayments', [workerId, startDate, endDate]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveWorkerPayment(req: AuthenticatedRequest, res: Response) {
  try {
    const { worker_payment_id, worker_id, payment_date, payment_type, amount, vehicle_daily_entry_id, notes } = req.body;
    const userId = req.user?.userId || 1;

    if (!worker_id || !payment_date || !amount) {
      return res.status(400).json({ success: false, message: 'Worker, date, and amount are required' });
    }

    const results = await callProcedure('spDataFlowAddEditWorkerPayment', [
      worker_payment_id || 0,
      worker_id,
      payment_date,
      payment_type || 'Daily Wage',
      parseFloat(amount),
      vehicle_daily_entry_id || null,
      notes || null,
      userId
    ]);

    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getWorkerLedger(req: AuthenticatedRequest, res: Response) {
  try {
    const workerId = parseInt(String(req.params.id), 10);
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetWorkerLedger', [workerId, startDate, endDate]);
    const summary = (results[0] as any[])[0] || null;
    const history = (results[1] as any[]) || [];

    res.json({
      success: true,
      data: {
        summary,
        history
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}
