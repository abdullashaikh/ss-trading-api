import { Response } from 'express';
import { pool, callProcedure } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';

export async function getDashboard(req: AuthenticatedRequest, res: Response) {
  try {
    const results = await callProcedure('spDataFlowGetDashboard', []);
    const dashboard = (results[0] as any[])[0] || {};

    // Integrate Today's and Current Month's Other Expenses
    const [oeRows] = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN expense_date = CURDATE() THEN amount ELSE 0 END), 0.00) as today_other_expense,
         COALESCE(SUM(CASE WHEN YEAR(expense_date) = YEAR(CURDATE()) AND MONTH(expense_date) = MONTH(CURDATE()) THEN amount ELSE 0 END), 0.00) as month_other_expense
       FROM t_other_expense
       WHERE is_deleted = 0`
    );
    const todayOtherExpense = parseFloat((oeRows as any[])[0]?.today_other_expense || '0') || 0;
    const monthOtherExpense = parseFloat((oeRows as any[])[0]?.month_other_expense || '0') || 0;

    dashboard.today_other_expense = todayOtherExpense;
    dashboard.month_other_expense = monthOtherExpense;

    // Total Business Expenses (Daily) = Vehicle Expense + Worker Wages + Other Expenses
    dashboard.today_total_business_expense = 
      (parseFloat(dashboard.today_vehicle_expense || '0') || 0) +
      (parseFloat(dashboard.today_worker_payments || '0') || 0) +
      todayOtherExpense;

    res.json({ success: true, data: dashboard });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}
