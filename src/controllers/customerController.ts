import { Response } from 'express';
import { callProcedure } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';

export async function getCustomers(req: AuthenticatedRequest, res: Response) {
  try {
    const search = (req.query.search as string) || null;
    const isActive = req.query.is_active !== undefined ? parseInt(req.query.is_active as string, 10) : null;

    const results = await callProcedure('spDataFlowGetCustomers', [search, isActive]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getCustomerById(req: AuthenticatedRequest, res: Response) {
  try {
    const customerId = parseInt(String(req.params.id), 10);
    const results = await callProcedure('spDataFlowGetCustomerById', [customerId]);
    const customer = (results[0] as any[])[0];

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    res.json({ success: true, data: customer });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveCustomer(req: AuthenticatedRequest, res: Response) {
  try {
    const { customer_id, customer_name, mobile_number, address, cr_br, opening_balance, notes, is_active } = req.body;
    const userId = req.user?.userId || 1;

    if (!customer_name || !mobile_number) {
      return res.status(400).json({ success: false, message: 'Customer name and mobile are required' });
    }

    const results = await callProcedure('spDataFlowAddEditCustomer', [
      customer_id || 0,
      customer_name,
      mobile_number,
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

export async function getCustomerPending(req: AuthenticatedRequest, res: Response) {
  try {
    const customerId = parseInt(String(req.params.id), 10);
    const results = await callProcedure('spDataFlowGetCustomerPreviousPending', [customerId, null]);
    const prevPending = (results[0] as any[])[0];
    res.json({ success: true, data: prevPending });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getCustomerLedger(req: AuthenticatedRequest, res: Response) {
  try {
    const customerId = parseInt(String(req.params.id), 10);
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetCustomerLedger', [customerId, startDate, endDate]);
    const summary = (results[0] as any[])[0] || null;
    const transactions = (results[1] as any[]) || [];

    // Compute running balance
    let runningBalance = summary ? parseFloat(summary.opening_balance || 0) : 0;
    const computedHistory = transactions.map((tx) => {
      if (tx.tx_type === 'BILL') {
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
