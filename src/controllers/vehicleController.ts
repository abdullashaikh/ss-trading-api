import { Response } from 'express';
import { callProcedure } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';

export async function getVehicles(req: AuthenticatedRequest, res: Response) {
  try {
    const search = (req.query.search as string) || null;
    const isActive = req.query.is_active !== undefined ? parseInt(req.query.is_active as string, 10) : null;

    const results = await callProcedure('spDataFlowGetVehicles', [search, isActive]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getVehicleById(req: AuthenticatedRequest, res: Response) {
  try {
    const vehicleId = parseInt(String(req.params.id), 10);
    const results = await callProcedure('spDataFlowGetVehicleById', [vehicleId]);
    const vehicle = (results[0] as any[])[0];

    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    res.json({ success: true, data: vehicle });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveVehicle(req: AuthenticatedRequest, res: Response) {
  try {
    const { vehicle_id, vehicle_number, vehicle_name, notes, is_active } = req.body;
    const userId = req.user?.userId || 1;

    if (!vehicle_number || !vehicle_name) {
      return res.status(400).json({ success: false, message: 'Vehicle number and name are required' });
    }

    const results = await callProcedure('spDataFlowAddEditVehicle', [
      vehicle_id || 0,
      vehicle_number.toUpperCase().trim(),
      vehicle_name,
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

export async function getDailyEntries(req: AuthenticatedRequest, res: Response) {
  try {
    const vehicleId = req.query.vehicle_id ? parseInt(req.query.vehicle_id as string, 10) : null;
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetVehicleDailyEntries', [vehicleId, startDate, endDate]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getDailyEntryById(req: AuthenticatedRequest, res: Response) {
  try {
    const entryId = parseInt(String(req.params.id), 10);
    const results = await callProcedure('spDataFlowGetVehicleDailyEntryById', [entryId]);
    const entry = (results[0] as any[])[0] || null;
    const workers = (results[1] as any[]) || [];

    if (!entry) {
      return res.status(404).json({ success: false, message: 'Vehicle entry not found' });
    }

    res.json({
      success: true,
      data: {
        ...entry,
        workers
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveDailyEntry(req: AuthenticatedRequest, res: Response) {
  try {
    const {
      vehicle_daily_entry_id, entry_date, vehicle_id, driver_worker_id,
      diesel_amount, maintenance_amount, other_expense, notes,
      worker_payments // Array: [{ worker_id: 1, amount: 1000 }]
    } = req.body;
    const userId = req.user?.userId || 1;

    if (!entry_date || !vehicle_id) {
      return res.status(400).json({ success: false, message: 'Entry date and vehicle are required' });
    }

    const workerJsonStr = worker_payments && Array.isArray(worker_payments) && worker_payments.length > 0
      ? JSON.stringify(worker_payments)
      : null;

    const results = await callProcedure('spDataFlowAddEditVehicleDailyEntry', [
      vehicle_daily_entry_id || 0,
      entry_date,
      vehicle_id,
      driver_worker_id || null,
      diesel_amount !== undefined ? parseFloat(diesel_amount) : 0,
      maintenance_amount !== undefined ? parseFloat(maintenance_amount) : 0,
      other_expense !== undefined ? parseFloat(other_expense) : 0,
      notes || null,
      userId,
      workerJsonStr
    ]);

    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getVehicleReport(req: AuthenticatedRequest, res: Response) {
  try {
    const vehicleId = req.query.vehicle_id ? parseInt(req.query.vehicle_id as string, 10) : null;
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetVehicleReport', [vehicleId, startDate, endDate]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function deleteVehicle(req: AuthenticatedRequest, res: Response) {
  try {
    const vehicleId = parseInt(String(req.params.id), 10);
    const userId = req.user?.userId || 1;
    const results = await callProcedure('spDataFlowDeleteVehicle', [vehicleId, userId]);
    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result, message: 'Vehicle soft deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function deleteDailyEntry(req: AuthenticatedRequest, res: Response) {
  try {
    const entryId = parseInt(String(req.params.id), 10);
    const userId = req.user?.userId || 1;
    const results = await callProcedure('spDataFlowDeleteVehicleDailyEntry', [entryId, userId]);
    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result, message: 'Daily vehicle entry soft deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

