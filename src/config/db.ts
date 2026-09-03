import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Parse connection variables (supports both individual variables and full Service URI / DATABASE_URL)
let dbHost = process.env.DB_HOST || 'localhost';
let dbPort = parseInt(process.env.DB_PORT || '3306', 10);
let dbUser = process.env.DB_USER || 'root';
let dbPassword = process.env.DB_PASSWORD || 'root';
let dbName = process.env.DB_NAME || 'ss_chicken_db';

if (process.env.DATABASE_URL) {
  try {
    const parsedUrl = new URL(process.env.DATABASE_URL);
    dbHost = parsedUrl.hostname || dbHost;
    dbPort = parsedUrl.port ? parseInt(parsedUrl.port, 10) : dbPort;
    dbUser = decodeURIComponent(parsedUrl.username) || dbUser;
    dbPassword = decodeURIComponent(parsedUrl.password) || dbPassword;
    if (parsedUrl.pathname && parsedUrl.pathname.length > 1) {
      dbName = decodeURIComponent(parsedUrl.pathname.substring(1));
    }
  } catch (err) {
    console.warn('[DB] Could not parse DATABASE_URL, falling back to individual variables');
  }
}

// Determine SSL Configuration
const caRelativePath = process.env.DB_SSL_CA_PATH || 'certs/ca.pem';
const caFullPath = path.isAbsolute(caRelativePath)
  ? caRelativePath
  : path.resolve(__dirname, '../../', caRelativePath);

const hasCaFile = fs.existsSync(caFullPath);
const hasCaEnv = !!process.env.DB_SSL_CA;
const isRemoteHost = dbHost && dbHost !== 'localhost' && dbHost !== '127.0.0.1';
const sslExplicitlyEnabled = process.env.DB_SSL === 'true';
const sslExplicitlyDisabled = process.env.DB_SSL === 'false';

let sslOptions: mysql.SslOptions | undefined = undefined;

if (!sslExplicitlyDisabled && (sslExplicitlyEnabled || isRemoteHost)) {
  let ca: string | Buffer | undefined = undefined;

  if (hasCaEnv) {
    ca = process.env.DB_SSL_CA;
  } else if (hasCaFile) {
    ca = fs.readFileSync(caFullPath);
    console.log(`[DB] Loaded SSL CA certificate from: ${caFullPath}`);
  }

  sslOptions = {
    ...(ca ? { ca } : {}),
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
  };
}

export const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true, // Return date as YYYY-MM-DD instead of JS Date object
  ...(sslOptions ? { ssl: sslOptions } : {})
});

/**
 * Execute stored procedure helper
 * spName: e.g. 'spDataFlowGetDashboard'
 * params: array of values e.g. [companyId, startDate, endDate]
 */
export async function callProcedure<T = any>(spName: string, params: any[] = []): Promise<T[]> {
  const placeholders = params.map(() => '?').join(', ');
  const sql = `CALL \`${spName}\`(${placeholders})`;
  const [rows] = await pool.query(sql, params);
  
  if (Array.isArray(rows)) {
    // MySQL stored procedures return an array where first element(s) are result sets and last is OkPacket
    return rows as T[];
  }
  return [] as T[];
}
