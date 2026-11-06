import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.js';
import {
  getWhatsAppCloudConfig,
  verifyWebhookSignature,
  verifyWebhookChallenge,
  processWhatsAppStatusUpdate,
  recordInboundWhatsAppMessage,
  getBillWhatsAppDeliveryStatus
} from '../services/whatsappService.js';

/**
 * Handles Meta WhatsApp Cloud API GET webhook verification handshake.
 * Route: GET /api/whatsapp/webhook
 *
 * Parameters:
 * - hub.mode: must equal 'subscribe'
 * - hub.verify_token: matched against WHATSAPP_WEBHOOK_VERIFY_TOKEN
 * - hub.challenge: returned verbatim with HTTP 200 on success
 */
export async function handleWhatsAppWebhookGet(req: Request, res: Response) {
  try {
    const mode = req.query['hub.mode'] as string | undefined;
    const verifyToken = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    const config = getWhatsAppCloudConfig();
    const expectedToken = config.webhookVerifyToken;

    // Direct browser / uptime check (when visited directly in browser without Meta handshake query parameters)
    if (!mode && !verifyToken && !challenge) {
      return res.status(200).json({
        status: 'active',
        message: 'WhatsApp Cloud API Webhook is live and ready for Meta verification.',
        endpoint: '/api/whatsapp/webhook',
        hasVerifyTokenConfigured: Boolean(expectedToken),
        time: new Date().toISOString()
      });
    }

    if (!expectedToken) {
      console.warn('[WhatsApp Webhook] Handshake rejected: WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured in .env');
      return res.status(403).send('Forbidden: Webhook verify token not configured.');
    }

    const verification = verifyWebhookChallenge(mode, verifyToken, challenge, expectedToken);

    if (verification.valid && verification.challenge) {
      console.log('[WhatsApp Webhook] Handshake verified successfully by Meta.');
      return res.status(200).send(verification.challenge);
    }

    console.warn('[WhatsApp Webhook] Handshake rejected: Invalid mode or verify token.');
    return res.status(403).send('Forbidden: Invalid verification parameters.');
  } catch (error: any) {
    console.error('[WhatsApp Webhook] GET verification error:', error.message);
    return res.status(500).send('Internal server error during verification.');
  }
}

/**
 * Handles Meta WhatsApp Cloud API POST webhook notifications (sent, delivered, read, failed, inbound).
 * Route: POST /api/whatsapp/webhook
 *
 * Mandatory Security:
 * 1. Validates X-Hub-Signature-256 using raw request body buffer.
 * 2. Validates Meta account metadata (WABA ID and Phone Number ID).
 * 3. Enforces idempotency and out-of-order delivery protection.
 * 4. Responds promptly with HTTP 200.
 */
export async function handleWhatsAppWebhookPost(req: Request, res: Response) {
  const config = getWhatsAppCloudConfig();
  const rawBody: Buffer | undefined = (req as any).rawBody;
  const signatureHeader = (req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256']) as string | undefined;

  // 1. Mandatory Signature Validation
  if (config.appSecret) {
    const isValidSignature = verifyWebhookSignature(rawBody, signatureHeader, config.appSecret);
    if (!isValidSignature) {
      console.warn('[WhatsApp Webhook] REJECTED: Invalid or missing X-Hub-Signature-256.');
      return res.status(401).json({ error: 'Invalid or missing webhook signature' });
    }
  } else if (!config.isDryRun) {
    // In production without appSecret configured, reject as safety guard
    console.warn('[WhatsApp Webhook] REJECTED: META_APP_SECRET is not configured on server.');
    return res.status(401).json({ error: 'Server webhook security unconfigured' });
  }

  // 2. Validate Payload Structure
  const payload = req.body;
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    // Acknowledge non-WABA webhooks safely to satisfy Meta ping
    return res.status(200).send('EVENT_RECEIVED');
  }

  try {
    for (const entry of payload.entry) {
      const entryWabaId = String(entry.id || '');

      // Validate WABA ID if configured
      if (config.businessAccountId && entryWabaId && entryWabaId !== config.businessAccountId && !config.isDryRun) {
        console.warn(`[WhatsApp Webhook] Quarantining event: unexpected WABA ID ${entryWabaId}`);
        continue;
      }

      if (!Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        if (!value) continue;

        const phoneNumberId = value.metadata?.phone_number_id;

        // Validate Phone Number ID if configured
        if (config.phoneNumberId && phoneNumberId && phoneNumberId !== config.phoneNumberId && !config.isDryRun) {
          console.warn(`[WhatsApp Webhook] Quarantining event: unexpected Phone Number ID ${phoneNumberId}`);
          continue;
        }

        // Process Outgoing Status Updates (sent, delivered, read, failed)
        if (Array.isArray(value.statuses)) {
          for (const statusItem of value.statuses) {
            try {
              await processWhatsAppStatusUpdate(statusItem, value.metadata);
            } catch (statusErr: any) {
              console.error(`[WhatsApp Webhook] Error processing status ${statusItem.id}:`, statusErr.message);
            }
          }
        }

        // Process Inbound Customer Messages
        if (Array.isArray(value.messages)) {
          for (const messageItem of value.messages) {
            try {
              await recordInboundWhatsAppMessage(messageItem, value.metadata);
            } catch (msgErr: any) {
              console.error(`[WhatsApp Webhook] Error recording inbound message ${messageItem.id}:`, msgErr.message);
            }
          }
        }
      }
    }

    // Always respond HTTP 200 promptly
    return res.status(200).send('EVENT_RECEIVED');
  } catch (error: any) {
    console.error('[WhatsApp Webhook] Unexpected error processing payload:', error.message);
    // Return 200 to prevent Meta webhook delivery storm if payload format is unexpected
    return res.status(200).send('EVENT_RECEIVED');
  }
}

/**
 * Retrieves the full delivery status and page breakdown for a specific bill.
 * Route: GET /api/bills/:id/whatsapp-status
 */
export async function getBillWhatsAppStatus(req: AuthenticatedRequest, res: Response) {
  try {
    const billId = parseInt(String(req.params.id), 10);
    if (!billId || isNaN(billId)) {
      return res.status(400).json({ success: false, message: 'Invalid bill ID' });
    }

    const deliveryStatus = await getBillWhatsAppDeliveryStatus(billId);
    if (!deliveryStatus) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    return res.json({
      success: true,
      data: deliveryStatus
    });
  } catch (error: any) {
    console.error('[WhatsApp Status API] Error fetching delivery status:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
}
