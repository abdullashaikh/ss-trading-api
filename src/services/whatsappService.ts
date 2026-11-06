import { pdf } from 'pdf-to-img';
import crypto from 'crypto';
import { pool } from '../config/db.js';

export interface WhatsAppBillDetails {
  customerName: string;
  customerMobile: string;
  billNumber: string;
  totalQty: number;
  totalKg: number;
  totalAmount: number;
  finalPending: number;
  billDate?: string;
  billDownloadUrl?: string;
}

export interface WhatsAppCloudConfig {
  appId: string;
  appSecret: string;
  phoneNumberId: string;
  accessToken: string;
  graphApiVersion: string;
  businessAccountId: string;
  webhookVerifyToken: string;
  templateName?: string;
  templateLang?: string;
  isDryRun: boolean;
}

export interface SendBillImageOptions {
  billId?: number;
  phoneOverride?: string;
  customCaption?: string;
  useTemplate?: boolean;
}

export interface SentMessageSummary {
  pageNumber: number;
  mediaId: string;
  messageId: string;
  status: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
}

export interface SendBillImageResult {
  success: boolean;
  billId?: number;
  billNumber: string;
  recipientPhone: string;
  totalPages: number;
  messagesSent: SentMessageSummary[];
  mode: 'session' | 'template';
  message: string;
}

export interface WhatsAppMessageRecord {
  id: number;
  bill_id: number;
  bill_number: string;
  recipient_phone: string;
  phone_number_id: string;
  business_account_id: string | null;
  media_id: string | null;
  whatsapp_message_id: string;
  page_number: number;
  total_pages: number;
  message_type: string;
  sending_mode: string;
  status: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  error_code: number | null;
  error_title: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillWhatsAppDeliveryStatus {
  billId: number;
  billNumber: string;
  recipient: string;
  overallStatus: 'pending' | 'accepted' | 'sent' | 'partially_delivered' | 'delivered' | 'read' | 'failed';
  totalPages: number;
  messages: Array<{
    id: number;
    pageNumber: number;
    whatsappMessageId: string;
    sendingMode: string;
    status: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
    sentAt: string | null;
    deliveredAt: string | null;
    readAt: string | null;
    failedAt: string | null;
    errorCode: number | null;
    errorTitle: string | null;
    errorMessage: string | null;
  }>;
}

/**
 * Returns the configured WhatsApp Cloud API & Webhook settings from environment variables.
 * Never logs or prints sensitive secrets.
 */
export function getWhatsAppCloudConfig(): WhatsAppCloudConfig {
  return {
    appId: (process.env.META_APP_ID || '').trim(),
    appSecret: (process.env.META_APP_SECRET || '').trim(),
    phoneNumberId: (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    accessToken: (process.env.WHATSAPP_ACCESS_TOKEN || '').trim(),
    graphApiVersion: (process.env.META_GRAPH_API_VERSION || 'v21.0').trim(),
    businessAccountId: (process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim(),
    webhookVerifyToken: (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim(),
    templateName: (process.env.WHATSAPP_TEMPLATE_NAME || '').trim(),
    templateLang: (process.env.WHATSAPP_TEMPLATE_LANG || 'en_US').trim(),
    isDryRun: process.env.WHATSAPP_DRY_RUN === 'true'
  };
}

/**
 * Checks whether WhatsApp Business Cloud API credentials are provided.
 */
export function isWhatsAppCloudConfigured(): boolean {
  const config = getWhatsAppCloudConfig();
  return Boolean(config.phoneNumberId && config.accessToken);
}

/**
 * Validates Meta's X-Hub-Signature-256 header using timing-safe comparison.
 * Requires the original raw Buffer of the incoming request body before JSON parsing.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !rawBody || !appSecret) {
    return false;
  }

  const parts = signatureHeader.trim().split('=');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'sha256') {
    return false;
  }

  const receivedHex = parts[1].toLowerCase();
  const calculatedHex = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex')
    .toLowerCase();

  const receivedBuf = Buffer.from(receivedHex, 'utf8');
  const calculatedBuf = Buffer.from(calculatedHex, 'utf8');

  if (receivedBuf.length !== calculatedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuf, calculatedBuf);
}

/**
 * Validates Meta's GET webhook verification handshake (hub.mode, hub.verify_token, hub.challenge).
 * Uses constant-time buffer comparison to prevent timing side-channel attacks.
 */
export function verifyWebhookChallenge(
  mode: string | undefined,
  verifyToken: string | undefined,
  challenge: string | undefined,
  expectedToken: string
): { valid: boolean; challenge?: string } {
  if (!mode || !verifyToken || !challenge || !expectedToken) {
    return { valid: false };
  }

  if (mode !== 'subscribe') {
    return { valid: false };
  }

  const tokenBuf = Buffer.from(verifyToken, 'utf8');
  const expectedBuf = Buffer.from(expectedToken, 'utf8');

  if (tokenBuf.length !== expectedBuf.length) {
    return { valid: false };
  }

  const isMatch = crypto.timingSafeEqual(tokenBuf, expectedBuf);
  if (!isMatch) {
    return { valid: false };
  }

  return { valid: true, challenge };
}

/**
 * Normalizes and validates a recipient phone number for WhatsApp Cloud API.
 * Converts 10-digit Indian numbers to E.164 without leading plus (e.g. '9876543210' -> '919876543210').
 */
export function normalizeWhatsAppNumber(rawPhone: string): { valid: boolean; normalized: string; error?: string } {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { valid: false, normalized: '', error: 'Recipient phone number is required.' };
  }

  let digits = rawPhone.replace(/\D/g, '');

  if (digits.length === 10) {
    digits = `91${digits}`;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = `91${digits.substring(1)}`;
  }

  if (digits.length < 10 || digits.length > 15) {
    return {
      valid: false,
      normalized: digits,
      error: `Invalid phone number (${digits.length} digits). Expected 10-15 digits including country code.`
    };
  }

  return { valid: true, normalized: digits };
}

/**
 * Converts a PDF buffer into an array of high-quality PNG or JPG image buffers.
 * Uses Mozilla's pdfjs-dist via pdf-to-img in-memory (zero server disk usage).
 */
export async function convertPdfToImages(
  pdfBuffer: Buffer,
  options: { scale?: number; format?: 'png' | 'jpg' | 'jpeg'; maxPages?: number } = {}
): Promise<Buffer[]> {
  const scale = options.scale ?? 2.0;
  const format = options.format === 'jpg' || options.format === 'jpeg' ? 'jpg' : 'png';
  const maxPages = options.maxPages ?? 10;

  const doc = await pdf(pdfBuffer, { scale, format: format as any });
  const images: Buffer[] = [];

  try {
    let count = 0;
    for await (const page of doc) {
      count++;
      if (count > maxPages) {
        console.warn(`[WhatsApp] PDF has ${doc.length} pages. Truncating to ${maxPages} pages for WhatsApp safety.`);
        break;
      }
      images.push(page);
    }
  } finally {
    if (doc.destroy) {
      await doc.destroy();
    }
  }

  if (images.length === 0) {
    throw new Error('PDF conversion resulted in 0 image pages.');
  }

  return images;
}

/**
 * Uploads an image buffer to Meta WhatsApp Cloud API /media endpoint.
 * Returns the generated WhatsApp media ID.
 */
export async function uploadMediaToWhatsApp(
  imageBuffer: Buffer,
  fileName: string,
  mimeType: string = 'image/png'
): Promise<string> {
  const config = getWhatsAppCloudConfig();

  if (config.isDryRun || config.accessToken === 'mock') {
    const mockMediaId = `mock_media_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    console.log(`[WhatsApp Dry-Run] Mock uploaded media "${fileName}" -> media_id: ${mockMediaId}`);
    return mockMediaId;
  }

  if (!config.phoneNumberId || !config.accessToken) {
    throw new Error('WhatsApp Cloud API is not configured. Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN.');
  }

  const maxBytes = 5 * 1024 * 1024;
  if (imageBuffer.length > maxBytes) {
    throw new Error(`Image size (${(imageBuffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds WhatsApp 5 MB limit.`);
  }

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/media`;

  const blob = new Blob([imageBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', mimeType);
  formData.append('file', blob, fileName);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`
    },
    body: formData
  });

  const responseJson: any = await res.json().catch(() => ({}));

  if (!res.ok || !responseJson.id) {
    const errorObj = responseJson?.error || {};
    const errorMsg = errorObj.message || `Media upload failed with status ${res.status}`;
    const errorCode = errorObj.code;
    console.error('[WhatsApp Cloud API] Media upload failed:', responseJson);
    throw new Error(`WhatsApp Media Upload Error (${errorCode || res.status}): ${errorMsg}`);
  }

  return responseJson.id;
}

/**
 * Sends an image message to a recipient phone number using a Meta media ID.
 */
export async function sendWhatsAppImageMessage(
  recipientPhone: string,
  mediaId: string,
  caption?: string
): Promise<{ messageId: string; response: any }> {
  const config = getWhatsAppCloudConfig();

  if (config.isDryRun || config.accessToken === 'mock') {
    const mockMsgId = `wamid.mock_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    console.log(`[WhatsApp Dry-Run] Sent image message to ${recipientPhone} -> msg_id: ${mockMsgId}`);
    return { messageId: mockMsgId, response: { messages: [{ id: mockMsgId }] } };
  }

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`;

  const payload: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientPhone,
    type: 'image',
    image: {
      id: mediaId
    }
  };

  if (caption) {
    payload.image.caption = caption;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseJson: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorObj = responseJson?.error || {};
    const errorCode = errorObj.code;
    const errorMsg = errorObj.message || `Failed to send image with HTTP ${res.status}`;

    if (errorCode === 131047) {
      const err: any = new Error(
        'WhatsApp 24-hour service window closed. The customer must first initiate a message or a pre-approved message template must be used.'
      );
      err.code = 131047;
      err.metaError = errorObj;
      throw err;
    }

    console.error('[WhatsApp Cloud API] Send image failed:', responseJson);
    throw new Error(`WhatsApp Send Error (${errorCode || res.status}): ${errorMsg}`);
  }

  const messageId = responseJson.messages?.[0]?.id || '';
  return { messageId, response: responseJson };
}

/**
 * Sends a WhatsApp Template message containing an image in the header.
 * Used for initiating messages outside the 24-hour customer service window.
 */
export async function sendWhatsAppTemplateWithImage(
  recipientPhone: string,
  mediaId: string,
  details: WhatsAppBillDetails,
  templateNameOverride?: string
): Promise<{ messageId: string; response: any }> {
  const config = getWhatsAppCloudConfig();
  const templateName = templateNameOverride || config.templateName;

  if (!templateName) {
    throw new Error(
      'WhatsApp 24-hour window requires an approved message template, but WHATSAPP_TEMPLATE_NAME is not configured.'
    );
  }

  if (config.isDryRun || config.accessToken === 'mock') {
    const mockMsgId = `wamid.mock_tpl_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    console.log(`[WhatsApp Dry-Run] Sent template message to ${recipientPhone} -> msg_id: ${mockMsgId}`);
    return { messageId: mockMsgId, response: { messages: [{ id: mockMsgId }] } };
  }

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`;

  // Format currency amounts without duplicating the rupee symbol (since template includes ₹)
  const formattedTotal = Number(details.totalAmount).toLocaleString('en-IN');
  const formattedPending = Number(details.finalPending).toLocaleString('en-IN');

  // Named parameters matching the submitted template (customer_name, invoice_number, total_amount, outstanding_balance)
  const namedParameters = [
    { type: 'text', parameter_name: 'customer_name', text: details.customerName || 'Customer' },
    { type: 'text', parameter_name: 'invoice_number', text: details.billNumber },
    { type: 'text', parameter_name: 'total_amount', text: formattedTotal },
    { type: 'text', parameter_name: 'outstanding_balance', text: formattedPending }
  ];

  // Positional parameters fallback (for {{1}}, {{2}}, {{3}}, {{4}} template definitions)
  const positionalParameters = [
    { type: 'text', text: details.customerName || 'Customer' },
    { type: 'text', text: details.billNumber },
    { type: 'text', text: formattedTotal },
    { type: 'text', text: formattedPending }
  ];

  const buildPayload = (params: any[]) => ({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientPhone,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: config.templateLang || 'en_US'
      },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'image',
              image: {
                id: mediaId
              }
            }
          ]
        },
        {
          type: 'body',
          parameters: params
        }
      ]
    }
  });

  // Attempt with named parameters first (standard for modern Meta templates with variable names)
  let res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildPayload(namedParameters))
  });

  let responseJson: any = await res.json().catch(() => ({}));

  // If rejected because Meta expected positional parameters (or vice versa), auto-retry with positional
  if (!res.ok && (responseJson?.error?.code === 100 || responseJson?.error?.code === 132000)) {
    console.warn('[WhatsApp Cloud API] Retrying template with positional parameters fallback...');
    const retryRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildPayload(positionalParameters))
    });
    const retryJson = await retryRes.json().catch(() => ({}));
    if (retryRes.ok) {
      res = retryRes;
      responseJson = retryJson;
    }
  }

  if (!res.ok) {
    const errorObj = responseJson?.error || {};
    console.error('[WhatsApp Cloud API] Send template failed:', responseJson);
    throw new Error(`WhatsApp Template Error (${errorObj.code || res.status}): ${errorObj.message}`);
  }

  const messageId = responseJson.messages?.[0]?.id || '';
  return { messageId, response: responseJson };
}

/**
 * Persists an outgoing WhatsApp message record in t_whatsapp_message with initial status 'accepted'.
 */
export async function recordOutgoingWhatsAppMessage(data: {
  billId: number;
  billNumber: string;
  recipientPhone: string;
  phoneNumberId: string;
  businessAccountId?: string | null;
  mediaId?: string | null;
  whatsappMessageId: string;
  pageNumber: number;
  totalPages: number;
  messageType?: string;
  sendingMode?: string;
  status?: string;
}): Promise<void> {
  const sql = `
    INSERT INTO t_whatsapp_message (
      bill_id, bill_number, recipient_phone, phone_number_id, business_account_id,
      media_id, whatsapp_message_id, page_number, total_pages, message_type,
      sending_mode, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      media_id = VALUES(media_id),
      sending_mode = VALUES(sending_mode),
      updated_at = NOW();
  `;

  await pool.query(sql, [
    data.billId,
    data.billNumber,
    data.recipientPhone,
    data.phoneNumberId,
    data.businessAccountId || null,
    data.mediaId || null,
    data.whatsappMessageId,
    data.pageNumber || 1,
    data.totalPages || 1,
    data.messageType || 'image',
    data.sendingMode || 'session',
    data.status || 'accepted'
  ]);
}

/**
 * Computes and updates the overall WhatsApp delivery status of a bill in t_bill_master.
 */
export async function recalculateBillOverallWhatsAppStatus(billId: number): Promise<string> {
  const [rows]: any = await pool.query(
    'SELECT status FROM t_whatsapp_message WHERE bill_id = ? ORDER BY page_number ASC',
    [billId]
  );

  const messages = rows as Array<{ status: string }>;
  if (!messages || messages.length === 0) {
    return 'pending';
  }

  const hasFailed = messages.some((m) => m.status === 'failed');
  const allRead = messages.every((m) => m.status === 'read');
  const allDeliveredOrRead = messages.every((m) => m.status === 'delivered' || m.status === 'read');
  const anyDeliveredOrRead = messages.some((m) => m.status === 'delivered' || m.status === 'read');
  const allSent = messages.every((m) => m.status === 'sent' || m.status === 'delivered' || m.status === 'read');

  let overall: string;

  if (hasFailed) {
    // If some pages succeeded but at least one failed, it is partially_delivered / failed
    overall = anyDeliveredOrRead ? 'partially_delivered' : 'failed';
  } else if (allRead) {
    overall = 'read';
  } else if (allDeliveredOrRead) {
    overall = 'delivered';
  } else if (anyDeliveredOrRead) {
    overall = 'partially_delivered';
  } else if (allSent) {
    overall = 'sent';
  } else {
    overall = 'accepted';
  }

  const dbStatus = overall.toUpperCase();

  try {
    await pool.query('UPDATE t_bill_master SET whatsapp_status = ? WHERE bill_id = ?', [dbStatus, billId]);
  } catch (err: any) {
    console.warn(`[WhatsApp] Could not update t_bill_master.whatsapp_status for bill ${billId}:`, err.message);
  }

  return overall;
}

/**
 * Status hierarchy ranks to prevent out-of-order webhook events from downgrading terminal or advanced states.
 */
const STATUS_RANKS: Record<string, number> = {
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5
};

/**
 * Processes an incoming WhatsApp Cloud API status event (sent, delivered, read, failed).
 * Enforces idempotency, out-of-order transition protection, event history audit, and bill status rollup.
 */
export async function processWhatsAppStatusUpdate(
  statusItem: any,
  rawMetadata?: any
): Promise<{
  handled: boolean;
  messageId?: string;
  oldStatus?: string;
  newStatus?: string;
  reason?: string;
}> {
  const whatsappMessageId = statusItem?.id;
  const incomingStatus = (statusItem?.status || '').toLowerCase();
  const rawTimestamp = statusItem?.timestamp;
  const eventDate = rawTimestamp ? new Date(parseInt(rawTimestamp, 10) * 1000) : new Date();

  if (!whatsappMessageId || !incomingStatus) {
    return { handled: false, reason: 'missing_id_or_status' };
  }

  // 1. Check idempotency: unique key per message + status + timestamp
  const idempotencyKey = `${whatsappMessageId}_${incomingStatus}_${rawTimestamp || '0'}`;

  // 2. Find matching outgoing message record
  const [msgRows]: any = await pool.query(
    'SELECT * FROM t_whatsapp_message WHERE whatsapp_message_id = ? LIMIT 1',
    [whatsappMessageId]
  );
  const msgRecord: WhatsAppMessageRecord | undefined = msgRows?.[0];

  // 3. Extract error details if failed
  let errorCode: number | null = null;
  let errorTitle: string | null = null;
  let errorDetails: string | null = null;

  if (incomingStatus === 'failed' && Array.isArray(statusItem?.errors) && statusItem.errors.length > 0) {
    const err = statusItem.errors[0];
    errorCode = err.code || null;
    errorTitle = err.title || 'WhatsApp Delivery Failure';
    const detailMsg = err.error_data?.details || err.message || '';
    errorDetails = err.message ? `${err.message}${err.error_data?.details ? ` (${err.error_data.details})` : ''}` : detailMsg;
  }

  // 4. Record event history in t_whatsapp_webhook_event (idempotent insert)
  try {
    const insertEventSql = `
      INSERT INTO t_whatsapp_webhook_event (
        idempotency_key, whatsapp_message_id, bill_id, event_type, event_status,
        event_timestamp, recipient_phone, phone_number_id, error_code, error_details, processing_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await pool.query(insertEventSql, [
      idempotencyKey,
      whatsappMessageId,
      msgRecord?.bill_id || null,
      `status_${incomingStatus}`,
      incomingStatus,
      eventDate,
      statusItem.recipient_id || msgRecord?.recipient_phone || null,
      rawMetadata?.phone_number_id || msgRecord?.phone_number_id || null,
      errorCode,
      errorDetails,
      msgRecord ? 'processed' : 'unmatched_message'
    ]);
  } catch (dbErr: any) {
    if (dbErr.code === 'ER_DUP_ENTRY' || dbErr.errno === 1062) {
      // Duplicate event delivered by Meta retry: safely ignore
      return { handled: true, messageId: whatsappMessageId, reason: 'duplicate_event_ignored' };
    }
    console.error('[WhatsApp Webhook] Error recording event audit:', dbErr.message);
  }

  if (!msgRecord) {
    console.warn(`[WhatsApp Webhook] Status update received for unknown message ID: ${whatsappMessageId}`);
    return { handled: false, messageId: whatsappMessageId, reason: 'unknown_message_id' };
  }

  const currentStatus = msgRecord.status.toLowerCase();
  const currentRank = STATUS_RANKS[currentStatus] || 0;
  const newRank = STATUS_RANKS[incomingStatus] || 0;

  // 5. Out-of-order transition rules:
  // - If message is already 'read', an incoming 'delivered' or 'sent' must NOT downgrade status.
  // - If message is already 'delivered', an incoming 'sent' must NOT downgrade status.
  // - If message is 'failed', do not overwrite with 'sent' or 'delivered'.
  if (incomingStatus !== 'failed' && currentStatus === 'failed') {
    return {
      handled: true,
      messageId: whatsappMessageId,
      oldStatus: currentStatus,
      newStatus: currentStatus,
      reason: 'terminal_failed_preserved'
    };
  }

  if (newRank < currentRank) {
    return {
      handled: true,
      messageId: whatsappMessageId,
      oldStatus: currentStatus,
      newStatus: currentStatus,
      reason: 'out_of_order_downgrade_prevented'
    };
  }

  // 6. Update t_whatsapp_message status and specific timestamp
  let updateSql = 'UPDATE t_whatsapp_message SET status = ?, updated_at = NOW()';
  const params: any[] = [incomingStatus];

  if (incomingStatus === 'sent') {
    updateSql += ', sent_at = COALESCE(sent_at, ?)';
    params.push(eventDate);
  } else if (incomingStatus === 'delivered') {
    updateSql += ', delivered_at = ?, sent_at = COALESCE(sent_at, ?)';
    params.push(eventDate, eventDate);
  } else if (incomingStatus === 'read') {
    updateSql += ', read_at = ?, delivered_at = COALESCE(delivered_at, ?), sent_at = COALESCE(sent_at, ?)';
    params.push(eventDate, eventDate, eventDate);
  } else if (incomingStatus === 'failed') {
    updateSql += ', failed_at = ?, error_code = ?, error_title = ?, error_message = ?';
    params.push(eventDate, errorCode, errorTitle, errorDetails);
  }

  updateSql += ' WHERE id = ?';
  params.push(msgRecord.id);

  await pool.query(updateSql, params);

  // 7. Recalculate bill-level aggregated status
  if (msgRecord.bill_id) {
    await recalculateBillOverallWhatsAppStatus(msgRecord.bill_id);
  }

  return {
    handled: true,
    messageId: whatsappMessageId,
    oldStatus: currentStatus,
    newStatus: incomingStatus
  };
}

/**
 * Records an incoming customer WhatsApp message in t_whatsapp_webhook_event for operational visibility.
 */
export async function recordInboundWhatsAppMessage(messageItem: any, metadata?: any): Promise<void> {
  const messageId = messageItem?.id;
  const fromPhone = messageItem?.from;
  const msgType = messageItem?.type || 'unknown';
  const timestamp = messageItem?.timestamp;
  const eventDate = timestamp ? new Date(parseInt(timestamp, 10) * 1000) : new Date();

  if (!messageId) return;

  const idempotencyKey = `inbound_${messageId}`;

  try {
    const sql = `
      INSERT INTO t_whatsapp_webhook_event (
        idempotency_key, whatsapp_message_id, event_type, event_status,
        event_timestamp, recipient_phone, phone_number_id, processing_status
      ) VALUES (?, ?, 'inbound_message', ?, ?, ?, ?, 'acknowledged')
    `;
    await pool.query(sql, [
      idempotencyKey,
      messageId,
      msgType,
      eventDate,
      fromPhone || null,
      metadata?.phone_number_id || null
    ]);
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      return; // Already recorded
    }
    console.error('[WhatsApp Webhook] Inbound message audit error:', err.message);
  }
}

/**
 * Retrieves the full WhatsApp delivery status for a specific bill, including per-page details.
 */
export async function getBillWhatsAppDeliveryStatus(billId: number): Promise<BillWhatsAppDeliveryStatus | null> {
  const [billRows]: any = await pool.query(
    'SELECT bill_id, bill_number, customer_mobile_snapshot, whatsapp_status FROM t_bill_master WHERE bill_id = ? LIMIT 1',
    [billId]
  );

  const bill = billRows?.[0];
  if (!bill) return null;

  const [msgRows]: any = await pool.query(
    `SELECT id, bill_id, bill_number, recipient_phone, whatsapp_message_id, page_number, total_pages,
            sending_mode, status, sent_at, delivered_at, read_at, failed_at, error_code, error_title, error_message
     FROM t_whatsapp_message
     WHERE bill_id = ?
     ORDER BY page_number ASC`,
    [billId]
  );

  const messages = (msgRows as any[]) || [];
  const totalPages = messages.length > 0 ? messages[0].total_pages : 0;

  let overallStatus: 'pending' | 'accepted' | 'sent' | 'partially_delivered' | 'delivered' | 'read' | 'failed' = 'pending';

  if (messages.length > 0) {
    const hasFailed = messages.some((m) => m.status === 'failed');
    const allRead = messages.every((m) => m.status === 'read');
    const allDelivered = messages.every((m) => m.status === 'delivered' || m.status === 'read');
    const anyDelivered = messages.some((m) => m.status === 'delivered' || m.status === 'read');
    const allSent = messages.every((m) => m.status === 'sent' || m.status === 'delivered' || m.status === 'read');

    if (hasFailed) {
      overallStatus = anyDelivered ? 'partially_delivered' : 'failed';
    } else if (allRead) {
      overallStatus = 'read';
    } else if (allDelivered) {
      overallStatus = 'delivered';
    } else if (anyDelivered) {
      overallStatus = 'partially_delivered';
    } else if (allSent) {
      overallStatus = 'sent';
    } else {
      overallStatus = 'accepted';
    }
  }

  return {
    billId: bill.bill_id,
    billNumber: bill.bill_number,
    recipient: bill.customer_mobile_snapshot,
    overallStatus,
    totalPages,
    messages: messages.map((m) => ({
      id: m.id,
      pageNumber: m.page_number,
      whatsappMessageId: m.whatsapp_message_id,
      sendingMode: m.sending_mode,
      status: m.status,
      sentAt: m.sent_at,
      deliveredAt: m.delivered_at,
      readAt: m.read_at,
      failedAt: m.failed_at,
      errorCode: m.error_code,
      errorTitle: m.error_title,
      errorMessage: m.error_message
    }))
  };
}

/**
 * Complete End-to-End Orchestrator:
 * 1. Validates recipient phone number.
 * 2. Converts generated bill PDF buffer into page images (PNG).
 * 3. Uploads each page image to Meta's WhatsApp media store.
 * 4. Sends image message(s) sequentially with bill details and caption.
 * 5. Immediately records each accepted message in t_whatsapp_message with status 'accepted'.
 * 6. Returns a clear 'accepted' API response (waiting for webhook delivery confirmation).
 */
export async function sendBillAsWhatsAppImages(
  details: WhatsAppBillDetails,
  pdfBuffer: Buffer,
  options: SendBillImageOptions = {}
): Promise<SendBillImageResult> {
  const config = getWhatsAppCloudConfig();
  if (!isWhatsAppCloudConfigured() && !config.isDryRun) {
    throw new Error(
      'WhatsApp Business Cloud API is not configured. Please set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in server/.env'
    );
  }

  const rawPhone = options.phoneOverride || details.customerMobile;
  const phoneValidation = normalizeWhatsAppNumber(rawPhone);
  if (!phoneValidation.valid) {
    throw new Error(phoneValidation.error || 'Invalid recipient phone number.');
  }
  const recipient = phoneValidation.normalized;

  const imageBuffers = await convertPdfToImages(pdfBuffer, { scale: 2.0, format: 'png' });
  const totalPages = imageBuffers.length;

  const defaultCaption = [
    `🧾 *SS TRADING INVOICE*`,
    `*Invoice No:* ${details.billNumber}`,
    `*Customer:* ${details.customerName}`,
    details.billDate ? `*Date:* ${details.billDate}` : '',
    `*Qty (નંગ):* ${details.totalQty} Birds | *Weight (વજન):* ${Number(details.totalKg).toFixed(2)} KG`,
    `*Bill Amount (બિલ રકમ):* ₹${Number(details.totalAmount).toLocaleString('en-IN')}`,
    `*Net Pending (બાકી રકમ):* ₹${Number(details.finalPending).toLocaleString('en-IN')}`,
    '',
    `Your bill is attached. Thank you for your purchase!`,
    `_SS TRADING_`
  ]
    .filter(Boolean)
    .join('\n');

  const primaryCaption = options.customCaption || defaultCaption;

  const messagesSent: SentMessageSummary[] = [];
  let sendMode: 'session' | 'template' = options.useTemplate ? 'template' : 'session';

  for (let i = 0; i < imageBuffers.length; i++) {
    const pageNum = i + 1;
    const pageImage = imageBuffers[i];
    const fileName = `${details.billNumber}_page_${pageNum}.png`;

    const mediaId = await uploadMediaToWhatsApp(pageImage, fileName, 'image/png');

    let messageId = '';

    if (i === 0) {
      if (sendMode === 'template') {
        const tplResult = await sendWhatsAppTemplateWithImage(recipient, mediaId, details);
        messageId = tplResult.messageId;
      } else {
        try {
          const sendResult = await sendWhatsAppImageMessage(recipient, mediaId, primaryCaption);
          messageId = sendResult.messageId;
        } catch (sendErr: any) {
          if (sendErr?.code === 131047 && config.templateName) {
            console.warn('[WhatsApp] 24-hr window closed. Attempting fallback to template:', config.templateName);
            const fallbackResult = await sendWhatsAppTemplateWithImage(recipient, mediaId, details);
            messageId = fallbackResult.messageId;
            sendMode = 'template';
          } else {
            throw sendErr;
          }
        }
      }
    } else {
      if (sendMode === 'template') {
        // Outside 24h window, every subsequent page must also be sent via approved template
        const subResult = await sendWhatsAppTemplateWithImage(recipient, mediaId, details);
        messageId = subResult.messageId;
      } else {
        const subCaption = `🧾 *SS TRADING INVOICE* — #${details.billNumber}\n*(Page ${pageNum} of ${totalPages})*`;
        const subResult = await sendWhatsAppImageMessage(recipient, mediaId, subCaption);
        messageId = subResult.messageId;
      }
    }

    // Immediately persist outgoing message with initial status 'accepted'
    if (options.billId) {
      await recordOutgoingWhatsAppMessage({
        billId: options.billId,
        billNumber: details.billNumber,
        recipientPhone: recipient,
        phoneNumberId: config.phoneNumberId || 'mock_phone_id',
        businessAccountId: config.businessAccountId || null,
        mediaId,
        whatsappMessageId: messageId,
        pageNumber: pageNum,
        totalPages,
        messageType: 'image',
        sendingMode: sendMode,
        status: 'accepted'
      });
    }

    messagesSent.push({
      pageNumber: pageNum,
      mediaId,
      messageId,
      status: 'accepted'
    });
  }

  // Update bill status to ACCEPTED in t_bill_master
  if (options.billId) {
    await recalculateBillOverallWhatsAppStatus(options.billId);
  }

  return {
    success: true,
    billId: options.billId,
    billNumber: details.billNumber,
    recipientPhone: recipient,
    totalPages,
    messagesSent,
    mode: sendMode,
    message: 'WhatsApp accepted the bill image. Awaiting delivery confirmation.'
  };
}

/**
 * Legacy browser share helper (wa.me link generation).
 * Preserved for seamless backward compatibility and manual fallbacks.
 */
export function generateWhatsAppShareUrl(details: WhatsAppBillDetails): {
  url: string;
  message: string;
  formattedMobile: string;
} {
  let cleanMobile = details.customerMobile.replace(/\D/g, '');
  if (cleanMobile.length === 10) {
    cleanMobile = `91${cleanMobile}`;
  }

  const messageLines = [
    `Hello ${details.customerName},`,
    '',
    `Your SS Trading bill *${details.billNumber}* has been generated.`,
    '',
    `*Total Qty (કુલ નંગ):* ${details.totalQty}`,
    `*Total KG (કુલ વજન):* ${Number(details.totalKg).toFixed(2)} KG`,
    `*Total Amount (કુલ રકમ):* ₹${Number(details.totalAmount).toLocaleString('en-IN')}`,
    `*Pending Balance (બાકી રકમ):* ₹${Number(details.finalPending).toLocaleString('en-IN')}`
  ];

  if (details.billDownloadUrl) {
    messageLines.push('', `View/Download Bill: ${details.billDownloadUrl}`);
  }

  messageLines.push('', 'Thank you.', '_SS TRADING_');

  const fullMessage = messageLines.join('\n');
  const encodedText = encodeURIComponent(fullMessage);
  const url = `https://wa.me/${cleanMobile}?text=${encodedText}`;

  return {
    url,
    message: fullMessage,
    formattedMobile: cleanMobile
  };
}
