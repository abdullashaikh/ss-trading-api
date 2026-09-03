import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { router as apiRouter } from './routes/api.js';
import { viewBillByNumber } from './controllers/billController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Trust reverse proxy (e.g. Nginx, ALB, Cloudflare) for accurate proto/host
app.set('trust proxy', 1);

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded/generated bills statically
const uploadsPath = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsPath));

// Clean public bill view/download route (for WhatsApp links & customers)
app.get('/bill/:billNumber', viewBillByNumber);

// API Routes
app.use('/api', apiRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), system: 'SS Trading Management System API' });
});

// Serve frontend client dist if built
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` SS Trading Management System Server`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` Static Uploads: http://localhost:${PORT}/uploads`);
  console.log(` Health Check: http://localhost:${PORT}/api/health`);
  console.log(`====================================================`);
});
