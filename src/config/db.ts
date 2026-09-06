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
let dbPassword = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'root';
let dbName = process.env.DB_NAME || 'ss_chicken_db';

// Support single connection string (DATABASE_URL or MYSQL_URL)
const connectionUri = process.env.DATABASE_URL || process.env.MYSQL_URL;
if (connectionUri) {
  try {
    const parsedUrl = new URL(connectionUri);
    dbHost = parsedUrl.hostname || dbHost;
    dbPort = parsedUrl.port ? parseInt(parsedUrl.port, 10) : dbPort;
    dbUser = decodeURIComponent(parsedUrl.username) || dbUser;
    dbPassword = decodeURIComponent(parsedUrl.password) || dbPassword;
    if (parsedUrl.pathname && parsedUrl.pathname.length > 1) {
      dbName = decodeURIComponent(parsedUrl.pathname.substring(1));
    }
  } catch (err: any) {
    console.warn('[DB] Could not parse database connection URL, falling back to individual variables');
  }
}

// Determine SSL Configuration
const isLocalHost = dbHost === 'localhost' || dbHost === '127.0.0.1' || dbHost === '::1';
const sslExplicitlyEnabled = process.env.DB_SSL === 'true' || process.env.DB_SSL === 'required';
const sslExplicitlyDisabled = process.env.DB_SSL === 'false' || process.env.DB_SSL === 'off';

// CA Certificate resolution (supports direct PEM string or file path)
const caContentEnv = process.env.DB_SSL_CA;
const caRelativePath = process.env.DB_SSL_CA_PATH;
let caFileBuffer: Buffer | undefined = undefined;

if (caRelativePath) {
  const caFullPath = path.isAbsolute(caRelativePath)
    ? caRelativePath
    : path.resolve(__dirname, '../../', caRelativePath);
  if (fs.existsSync(caFullPath)) {
    caFileBuffer = fs.readFileSync(caFullPath);
    console.log(`[DB] Loaded SSL CA certificate from file: ${caFullPath}`);
  }
}

// Enable SSL if explicitly requested or if CA cert is provided
const shouldEnableSsl = !sslExplicitlyDisabled && (sslExplicitlyEnabled || (!isLocalHost && (!!caContentEnv || !!caFileBuffer)));

let sslOptions: mysql.SslOptions | undefined = undefined;
if (shouldEnableSsl) {
  const ca = caContentEnv || caFileBuffer;
  sslOptions = {
    ...(ca ? { ca } : {}),
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
  };
}

// Connection Pool Configuration for MySQL 8.x
const connectionLimit = parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10);
const maxIdle = parseInt(process.env.DB_MAX_IDLE || '10', 10);
const idleTimeout = parseInt(process.env.DB_IDLE_TIMEOUT || '60000', 10);
const queueLimit = parseInt(process.env.DB_QUEUE_LIMIT || '0', 10);
const connectTimeout = parseInt(process.env.DB_CONNECT_TIMEOUT || '10000', 10);

export const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  waitForConnections: true,
  connectionLimit,
  maxIdle,
  idleTimeout,
  queueLimit,
  connectTimeout,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  dateStrings: true, // Return date as YYYY-MM-DD string instead of JS Date
  charset: 'utf8mb4',
  ...(sslOptions ? { ssl: sslOptions } : {})
});

/**
 * Validates database connectivity on startup.
 * Logs database and host safely (without credentials).
 */
export async function testDatabaseConnection(): Promise<{ database: string; host: string; version: string }> {
  let connection: mysql.PoolConnection | null = null;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT 1 as is_alive, VERSION() as version');
    const version = (rows as any[])?.[0]?.version || '8.x';
    console.log(`[DB] Database connection successful`);
    console.log(`[DB] Database: ${dbName}`);
    console.log(`[DB] Host: ${dbHost}:${dbPort}`);
    console.log(`[DB] MySQL Version: ${version}`);
    console.log(`[DB] SSL Active: ${shouldEnableSsl ? 'Yes' : 'No'}`);
    return { database: dbName, host: `${dbHost}:${dbPort}`, version };
  } catch (error: any) {
    console.error(`[DB] Database connection test failed: ${error.message}`);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

/**
 * Gracefully shuts down the database connection pool.
 */
export async function closeDatabasePool(): Promise<void> {
  try {
    console.log('[DB] Closing database connection pool...');
    await pool.end();
    console.log('[DB] Database connection pool closed successfully.');
  } catch (error: any) {
    console.error('[DB] Error during pool shutdown:', error.message);
  }
}

/**
 * Execute stored procedure helper
 * spName: e.g. 'spDataFlowGetDashboard'
 * params: array of values e.g. [companyId, startDate, endDate]
 */
export async function callProcedure<T = any>(spName: string, params: any[] = []): Promise<T[]> {
  try {
    const placeholders = params.map(() => '?').join(', ');
    const sql = `CALL \`${spName}\`(${placeholders})`;
    const [rows] = await pool.query(sql, params);
    
    if (Array.isArray(rows)) {
      // MySQL stored procedures return an array where first element(s) are result sets and last is OkPacket
      return rows as T[];
    }
    return [] as T[];
  } catch (error: any) {
    console.error(`[DB] Error executing procedure ${spName}:`, error.message);
    throw error;
  }
}
