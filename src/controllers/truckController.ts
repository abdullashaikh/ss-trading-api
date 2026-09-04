import { Response } from 'express';
import { callProcedure } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';

export async function getTrucks(req: AuthenticatedRequest, res: Response) {
  try {
    const results = await callProcedure('spDataFlowGetTrucks', []);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getTruckById(req: AuthenticatedRequest, res: Response) {
  try {
    const truckId = parseInt(String(req.params.id), 10);
    const results = await callProcedure('spDataFlowGetTruckById', [truckId]);
    const truck = (results[0] as any[])[0];

    if (!truck) {
      return res.status(404).json({ success: false, message: 'Truck not found' });
    }
    res.json({ success: true, data: truck });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveTruck(req: AuthenticatedRequest, res: Response) {
  try {
    const { truck_id, truck_number, truck_name, total_box_count, notes, is_active } = req.body;
    const userId = req.user?.userId || 1;

    if (!truck_number || !truck_name) {
      return res.status(400).json({ success: false, message: 'Truck number and name are required' });
    }

    const results = await callProcedure('spDataFlowAddEditTruck', [
      truck_id || 0,
      truck_number.toUpperCase().trim(),
      truck_name,
      total_box_count ? parseInt(total_box_count, 10) : 108,
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

export async function getTruckBoxes(req: AuthenticatedRequest, res: Response) {
  try {
    const truckId = parseInt(String(req.params.id), 10);
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

    const results = await callProcedure('spDataFlowGetTruckBoxes', [truckId, date]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getDeliveries(req: AuthenticatedRequest, res: Response) {
  try {
    const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : null;
    const startDate = (req.query.start_date as string) || null;
    const endDate = (req.query.end_date as string) || null;

    const results = await callProcedure('spDataFlowGetCustomerDeliveries', [customerId, startDate, endDate]);
    res.json({ success: true, data: results[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getDeliveryById(req: AuthenticatedRequest, res: Response) {
  try {
    const deliveryId = parseInt(String(req.params.id), 10);
    const results = await callProcedure('spDataFlowGetCustomerDeliveryById', [deliveryId]);
    const delivery = (results[0] as any[])[0] || null;
    const boxes = (results[1] as any[]) || [];

    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    res.json({
      success: true,
      data: {
        ...delivery,
        boxes
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveCustomerDelivery(req: AuthenticatedRequest, res: Response) {
  try {
    const { delivery_id, delivery_date, customer_id, truck_id, notes, boxes } = req.body;
    const userId = req.user?.userId || 1;

    if (!delivery_date || !customer_id || !truck_id || !boxes || !Array.isArray(boxes) || boxes.length === 0) {
      return res.status(400).json({ success: false, message: 'Delivery date, customer, truck, and at least one box are required' });
    }

    const boxesJsonStr = JSON.stringify(boxes);

    const results = await callProcedure('spDataFlowAddEditCustomerDelivery', [
      delivery_id || 0,
      delivery_date,
      customer_id,
      truck_id,
      notes || null,
      userId,
      boxesJsonStr
    ]);

    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function deleteCustomerDelivery(req: AuthenticatedRequest, res: Response) {
  try {
    const deliveryId = parseInt(String(req.params.id), 10);
    const userId = req.user?.userId || 1;
    const results = await callProcedure('spDataFlowDeleteDelivery', [deliveryId, userId]);
    const result = (results[0] as any[])[0];
    res.json({ success: true, data: result, message: 'Delivery and allocated boxes soft deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

