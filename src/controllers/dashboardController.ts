import { Response } from 'express';
import { callProcedure } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';

export async function getDashboard(req: AuthenticatedRequest, res: Response) {
  try {
    const results = await callProcedure('spDataFlowGetDashboard', []);
    const dashboard = (results[0] as any[])[0] || {};
    res.json({ success: true, data: dashboard });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}
