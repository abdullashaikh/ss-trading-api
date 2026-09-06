import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { router as apiRouter } from './routes/api.js';
import { viewBillByNumber } from './controllers/billController.js';
import { testDatabaseConnection, closeDatabasePool } from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Trust reverse proxy (e.g. Nginx, ALB, Cloudflare, Render) for accurate proto/host
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: 'connected',
    time: new Date().toISOString(),
    system: 'SS Trading Management System API'
  });
});

// Serve frontend client dist if built
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Start Server with Database Connectivity Validation
async function startServer() {
  try {
    // 1. Startup validation: ensure database is reachable
    const dbInfo = await testDatabaseConnection();

    // 2. Start HTTP server
    const server = app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(` SS Trading Management System Server`);
      console.log(` URL: http://localhost:${PORT}`);
      console.log(` Database: ${dbInfo.database} on ${dbInfo.host}`);
      console.log(` MySQL Version: ${dbInfo.version}`);
      console.log(` Static Uploads: http://localhost:${PORT}/uploads`);
      console.log(` Health Check: http://localhost:${PORT}/api/health`);
      console.log(`====================================================`);
    });

    // 3. Graceful shutdown handler
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n[Server] Received ${signal}. Gracefully shutting down...`);
      server.close(async () => {
        console.log('[Server] HTTP server closed.');
        await closeDatabasePool();
        console.log('[Server] Graceful shutdown complete.');
        process.exit(0);
      });

      // Force terminate if graceful shutdown hangs
      setTimeout(() => {
        console.error('[Server] Could not close connections in time, forcefully shutting down.');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error: any) {
    console.error(`\n[Server] FATAL: Server startup aborted due to database connection failure.`);
    console.error(`[Server] Error: ${error.message}`);
    console.error(`[Server] Please verify DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, and DB_SSL environment variables.`);
    process.exit(1);
  }
}

startServer();

