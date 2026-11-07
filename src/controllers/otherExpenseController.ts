import { Response } from 'express';
import { pool } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';

export const MONTHLY_EXPENSE_LIMIT = 20;

/**
 * Helper to fetch monthly usage for a specific user (or system) for the current calendar month
 */
async function getMonthlyUsageCount(userId: number | null): Promise<number> {
  const query = `
    SELECT COUNT(*) as usage_count
    FROM t_other_expense
    WHERE is_deleted = 0
      AND YEAR(expense_date) = YEAR(CURDATE())
      AND MONTH(expense_date) = MONTH(CURDATE())
      ${userId ? 'AND created_by = ?' : ''}
  `;
  const params = userId ? [userId] : [];
  const [rows] = await pool.query(query, params);
  return parseInt((rows as any[])[0]?.usage_count || '0', 10);
}

/**
 * GET /api/other-expenses
 * Lists expenses for a given month with monthly usage stats
 */
export async function getOtherExpenses(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId || null;
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const selectedMonth = (req.query.month as string) || currentMonth;
    const search = (req.query.search as string || '').trim();

    // Query list of expenses for the selected month
    let query = `
      SELECT 
        e.other_expense_id,
        e.remark,
        e.amount,
        DATE_FORMAT(e.expense_date, '%Y-%m-%d') as expense_date,
        e.created_by,
        u.user_name as created_by_name,
        DATE_FORMAT(e.created_date, '%Y-%m-%d %H:%i:%s') as created_date
      FROM t_other_expense e
      LEFT JOIN t_user_master u ON e.created_by = u.user_id
      WHERE e.is_deleted = 0
        AND DATE_FORMAT(e.expense_date, '%Y-%m') = ?
    `;
    const params: any[] = [selectedMonth];

    if (search) {
      query += ` AND e.remark LIKE ?`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY e.created_date DESC, e.other_expense_id DESC`;

    const [expenses] = await pool.query(query, params);

    // Calculate selected month total
    const [selectedMonthSum] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0.00) as total_amount
       FROM t_other_expense
       WHERE is_deleted = 0
         AND DATE_FORMAT(expense_date, '%Y-%m') = ?`,
      [selectedMonth]
    );
    const selectedMonthTotal = parseFloat((selectedMonthSum as any[])[0]?.total_amount || '0') || 0;

    // Calculate current calendar month usage stats
    const usageCount = await getMonthlyUsageCount(userId);

    const [currentMonthSum] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0.00) as total_amount
       FROM t_other_expense
       WHERE is_deleted = 0
         AND YEAR(expense_date) = YEAR(CURDATE())
         AND MONTH(expense_date) = MONTH(CURDATE())`
    );
    const currentMonthTotal = parseFloat((currentMonthSum as any[])[0]?.total_amount || '0') || 0;

    res.json({
      success: true,
      data: expenses,
      meta: {
        monthly_usage: usageCount,
        monthly_limit: MONTHLY_EXPENSE_LIMIT,
        is_limit_reached: usageCount >= MONTHLY_EXPENSE_LIMIT,
        current_month: currentMonth,
        current_month_total: currentMonthTotal,
        selected_month: selectedMonth,
        selected_month_total: selectedMonthTotal
      }
    });
  } catch (error: any) {
    console.error('[OtherExpenses] GET error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * GET /api/other-expenses/usage
 * Returns current calendar month usage stats
 */
export async function getOtherExpensesUsage(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId || null;
    const usageCount = await getMonthlyUsageCount(userId);

    const [sumRows] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0.00) as total_amount
       FROM t_other_expense
       WHERE is_deleted = 0
         AND YEAR(expense_date) = YEAR(CURDATE())
         AND MONTH(expense_date) = MONTH(CURDATE())`
    );
    const monthlyTotal = parseFloat((sumRows as any[])[0]?.total_amount || '0') || 0;

    res.json({
      success: true,
      data: {
        monthly_usage: usageCount,
        monthly_limit: MONTHLY_EXPENSE_LIMIT,
        is_limit_reached: usageCount >= MONTHLY_EXPENSE_LIMIT,
        monthly_total: monthlyTotal
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * POST /api/other-expenses
 * Creates a new other expense entry with strict 20-entry monthly limit validation
 */
export async function createOtherExpense(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId || 1;
    const { remark, amount } = req.body;

    // 1. Validate Remark (required text)
    if (!remark || typeof remark !== 'string' || !remark.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Remark is required.'
      });
    }

    // 2. Validate Amount (required number > 0)
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required and must be greater than zero.'
      });
    }

    // 3. Strict Server-Side Monthly Usage Limit Check (Max 20 entries per calendar month)
    const currentUsage = await getMonthlyUsageCount(userId);
    if (currentUsage >= MONTHLY_EXPENSE_LIMIT) {
      return res.status(400).json({
        success: false,
        message: 'You have reached your monthly limit of 20 other expenses. You can add more expenses next month.',
        meta: {
          monthly_usage: currentUsage,
          monthly_limit: MONTHLY_EXPENSE_LIMIT,
          is_limit_reached: true
        }
      });
    }

    // 4. Insert New Other Expense
    const cleanRemark = remark.trim();
    const [result] = await pool.query(
      `INSERT INTO t_other_expense (remark, amount, expense_date, created_by, created_date)
       VALUES (?, ?, CURDATE(), ?, NOW())`,
      [cleanRemark, parsedAmount.toFixed(2), userId]
    );

    const newExpenseId = (result as any).insertId;
    const newUsage = currentUsage + 1;

    // Fetch created record
    const [rows] = await pool.query(
      `SELECT 
        e.other_expense_id,
        e.remark,
        e.amount,
        DATE_FORMAT(e.expense_date, '%Y-%m-%d') as expense_date,
        e.created_by,
        u.user_name as created_by_name,
        DATE_FORMAT(e.created_date, '%Y-%m-%d %H:%i:%s') as created_date
       FROM t_other_expense e
       LEFT JOIN t_user_master u ON e.created_by = u.user_id
       WHERE e.other_expense_id = ?`,
      [newExpenseId]
    );

    res.status(201).json({
      success: true,
      message: 'Expense added successfully.',
      data: (rows as any[])[0],
      meta: {
        monthly_usage: newUsage,
        monthly_limit: MONTHLY_EXPENSE_LIMIT,
        is_limit_reached: newUsage >= MONTHLY_EXPENSE_LIMIT
      }
    });
  } catch (error: any) {
    console.error('[OtherExpenses] CREATE error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * PUT /api/other-expenses/:id
 * Edits an existing other expense entry (does not consume additional monthly count)
 */
export async function updateOtherExpense(req: AuthenticatedRequest, res: Response) {
  try {
    const expenseId = parseInt(String(req.params.id), 10);
    const userId = req.user?.userId || 1;
    const { remark, amount } = req.body;

    if (!expenseId || isNaN(expenseId)) {
      return res.status(400).json({ success: false, message: 'Invalid expense ID.' });
    }

    // 1. Validate Remark
    if (!remark || typeof remark !== 'string' || !remark.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Remark is required.'
      });
    }

    // 2. Validate Amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required and must be greater than zero.'
      });
    }

    // 3. Verify record exists and is active
    const [existingRows] = await pool.query(
      `SELECT * FROM t_other_expense WHERE other_expense_id = ? AND is_deleted = 0`,
      [expenseId]
    );
    if (!(existingRows as any[]).length) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }

    // 4. Update
    await pool.query(
      `UPDATE t_other_expense 
       SET remark = ?, amount = ?, modified_date = NOW(), modified_by = ?
       WHERE other_expense_id = ?`,
      [remark.trim(), parsedAmount.toFixed(2), userId, expenseId]
    );

    // Fetch updated record
    const [rows] = await pool.query(
      `SELECT 
        e.other_expense_id,
        e.remark,
        e.amount,
        DATE_FORMAT(e.expense_date, '%Y-%m-%d') as expense_date,
        e.created_by,
        u.user_name as created_by_name,
        DATE_FORMAT(e.created_date, '%Y-%m-%d %H:%i:%s') as created_date
       FROM t_other_expense e
       LEFT JOIN t_user_master u ON e.created_by = u.user_id
       WHERE e.other_expense_id = ?`,
      [expenseId]
    );

    res.json({
      success: true,
      message: 'Expense updated successfully.',
      data: (rows as any[])[0]
    });
  } catch (error: any) {
    console.error('[OtherExpenses] UPDATE error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * DELETE /api/other-expenses/:id
 * Deletes an other expense entry and updates monthly usage count
 */
export async function deleteOtherExpense(req: AuthenticatedRequest, res: Response) {
  try {
    const expenseId = parseInt(String(req.params.id), 10);
    const userId = req.user?.userId || 1;

    if (!expenseId || isNaN(expenseId)) {
      return res.status(400).json({ success: false, message: 'Invalid expense ID.' });
    }

    const [existingRows] = await pool.query(
      `SELECT * FROM t_other_expense WHERE other_expense_id = ? AND is_deleted = 0`,
      [expenseId]
    );
    if (!(existingRows as any[]).length) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }

    // Soft delete
    await pool.query(
      `UPDATE t_other_expense 
       SET is_deleted = 1, modified_date = NOW(), modified_by = ?
       WHERE other_expense_id = ?`,
      [userId, expenseId]
    );

    const updatedUsage = await getMonthlyUsageCount(userId);

    res.json({
      success: true,
      message: 'Expense deleted successfully.',
      meta: {
        monthly_usage: updatedUsage,
        monthly_limit: MONTHLY_EXPENSE_LIMIT,
        is_limit_reached: updatedUsage >= MONTHLY_EXPENSE_LIMIT
      }
    });
  } catch (error: any) {
    console.error('[OtherExpenses] DELETE error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}
