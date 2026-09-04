import { Router } from 'express';
import { login, getCurrentUser } from '../controllers/authController.js';
import {
  getCompanies, getCompanyById, saveCompany, deleteCompany,
  getPurchases, savePurchase, deletePurchase,
  getPayments as getCompanyPayments, savePayment as saveCompanyPayment, deletePayment as deleteCompanyPayment,
  getCompanyLedger
} from '../controllers/companyController.js';
import {
  getWorkers, getWorkerById, saveWorker, deleteWorker,
  getWorkerPayments, saveWorkerPayment, deleteWorkerPayment, getWorkerLedger
} from '../controllers/workerController.js';
import {
  getVehicles, getVehicleById, saveVehicle, deleteVehicle,
  getDailyEntries, getDailyEntryById, saveDailyEntry, deleteDailyEntry,
  getVehicleReport
} from '../controllers/vehicleController.js';
import {
  getCustomers, getCustomerById, saveCustomer, deleteCustomer,
  getCustomerPending, getCustomerLedger
} from '../controllers/customerController.js';
import {
  getTrucks, getTruckById, saveTruck,
  getTruckBoxes, getDeliveries, getDeliveryById, saveCustomerDelivery, deleteCustomerDelivery
} from '../controllers/truckController.js';
import {
  getBills, getBillById, createBill, deleteBill, recordBillPayment, deleteBillPayment, downloadBillPdf, viewBillByNumber,
  updateBillWhatsappStatus
} from '../controllers/billController.js';
import {
  getPurchaseReport, getSalesReport, getWorkerReport, getOverallBusinessReport
} from '../controllers/reportController.js';
import { getDashboard } from '../controllers/dashboardController.js';
import { authenticate } from '../middlewares/auth.js';

export const router = Router();

// 1. Auth routes
router.post('/auth/login', login);
router.get('/auth/me', authenticate as any, getCurrentUser as any);

// 2. Dashboard
router.get('/dashboard', authenticate as any, getDashboard as any);

// 3. Company / Supplier routes
router.get('/companies', authenticate as any, getCompanies as any);
router.get('/companies/:id', authenticate as any, getCompanyById as any);
router.post('/companies', authenticate as any, saveCompany as any);
router.delete('/companies/:id', authenticate as any, deleteCompany as any);
router.get('/companies/:id/ledger', authenticate as any, getCompanyLedger as any);

router.get('/purchases', authenticate as any, getPurchases as any);
router.post('/purchases', authenticate as any, savePurchase as any);
router.delete('/purchases/:id', authenticate as any, deletePurchase as any);

router.get('/company-payments', authenticate as any, getCompanyPayments as any);
router.post('/company-payments', authenticate as any, saveCompanyPayment as any);
router.delete('/company-payments/:id', authenticate as any, deleteCompanyPayment as any);

// 4. Worker routes
router.get('/workers', authenticate as any, getWorkers as any);
router.get('/workers/:id', authenticate as any, getWorkerById as any);
router.post('/workers', authenticate as any, saveWorker as any);
router.delete('/workers/:id', authenticate as any, deleteWorker as any);
router.get('/workers/:id/ledger', authenticate as any, getWorkerLedger as any);

router.get('/worker-payments', authenticate as any, getWorkerPayments as any);
router.post('/worker-payments', authenticate as any, saveWorkerPayment as any);
router.delete('/worker-payments/:id', authenticate as any, deleteWorkerPayment as any);

// 5. Vehicle routes
router.get('/vehicles', authenticate as any, getVehicles as any);
router.get('/vehicles/:id', authenticate as any, getVehicleById as any);
router.post('/vehicles', authenticate as any, saveVehicle as any);
router.delete('/vehicles/:id', authenticate as any, deleteVehicle as any);

router.get('/vehicle-entries', authenticate as any, getDailyEntries as any);
router.get('/vehicle-entries/:id', authenticate as any, getDailyEntryById as any);
router.post('/vehicle-entries', authenticate as any, saveDailyEntry as any);
router.delete('/vehicle-entries/:id', authenticate as any, deleteDailyEntry as any);
router.get('/vehicle-report', authenticate as any, getVehicleReport as any);

// 6. Customer routes
router.get('/customers', authenticate as any, getCustomers as any);
router.get('/customers/:id', authenticate as any, getCustomerById as any);
router.post('/customers', authenticate as any, saveCustomer as any);
router.delete('/customers/:id', authenticate as any, deleteCustomer as any);
router.get('/customers/:id/pending', authenticate as any, getCustomerPending as any);
router.get('/customers/:id/ledger', authenticate as any, getCustomerLedger as any);

// 7. Truck & Box Allocation routes
router.get('/trucks', authenticate as any, getTrucks as any);
router.get('/trucks/:id', authenticate as any, getTruckById as any);
router.post('/trucks', authenticate as any, saveTruck as any);
router.get('/trucks/:id/boxes', authenticate as any, getTruckBoxes as any);

router.get('/deliveries', authenticate as any, getDeliveries as any);
router.get('/deliveries/:id', authenticate as any, getDeliveryById as any);
router.post('/deliveries', authenticate as any, saveCustomerDelivery as any);
router.delete('/deliveries/:id', authenticate as any, deleteCustomerDelivery as any);

// 8. Bill Management routes
router.get('/bills', authenticate as any, getBills as any);
router.get('/bills/:id', authenticate as any, getBillById as any);
router.post('/bills', authenticate as any, createBill as any);
router.delete('/bills/:id', authenticate as any, deleteBill as any);
router.post('/bills/payment', authenticate as any, recordBillPayment as any);
router.delete('/bills/payment/:id', authenticate as any, deleteBillPayment as any);
router.post('/bills/:id/whatsapp-status', authenticate as any, updateBillWhatsappStatus as any);
router.get('/bills/pdf/:filename', downloadBillPdf as any);
router.get('/bills/view/:billNumber', viewBillByNumber as any);
router.get('/bill/:billNumber', viewBillByNumber as any);

// 9. Reports routes
router.get('/reports/purchases', authenticate as any, getPurchaseReport as any);
router.get('/reports/sales', authenticate as any, getSalesReport as any);
router.get('/reports/workers', authenticate as any, getWorkerReport as any);
router.get('/reports/vehicles', authenticate as any, getVehicleReport as any);
router.get('/reports/overall', authenticate as any, getOverallBusinessReport as any);

