import crypto from 'crypto';
import { pool, callProcedure } from './src/config/db.js';
import {
  verifyWebhookChallenge,
  verifyWebhookSignature,
  sendBillAsWhatsAppImages,
  processWhatsAppStatusUpdate,
  getBillWhatsAppDeliveryStatus,
  recordInboundWhatsAppMessage,
  WhatsAppBillDetails
} from './src/services/whatsappService.js';
import {
  handleWhatsAppWebhookGet,
  handleWhatsAppWebhookPost,
  getBillWhatsAppStatus
} from './src/controllers/whatsappWebhookController.js';
import { generateBillPdf, BillData } from './src/services/pdfService.js';

async function runTestSuite() {
  console.log('================================================================');
  console.log(' STARTING WHATSAPP WEBHOOK & DELIVERY TRACKING TEST SUITE');
  console.log('================================================================\n');

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      testsPassed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}`);
      testsFailed++;
    }
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 1: GET Webhook Verification Handshake
  // --------------------------------------------------------------------------
  console.log('--- TEST GROUP 1: GET Webhook Verification Handshake ---');
  const testVerifyToken = 'my_super_secure_webhook_verify_token_2026';
  const testChallenge = '1158201444';

  // 1.1 Correct verify token and mode
  const res1 = verifyWebhookChallenge('subscribe', testVerifyToken, testChallenge, testVerifyToken);
  assert(res1.valid === true && res1.challenge === testChallenge, 'Valid verify token and mode returns challenge');

  // 1.2 Invalid verify token
  const res2 = verifyWebhookChallenge('subscribe', 'wrong_token', testChallenge, testVerifyToken);
  assert(res2.valid === false, 'Invalid verify token is rejected');

  // 1.3 Invalid mode
  const res3 = verifyWebhookChallenge('unsubscribe', testVerifyToken, testChallenge, testVerifyToken);
  assert(res3.valid === false, 'Invalid hub.mode is rejected');

  // 1.4 Missing parameters
  const res4 = verifyWebhookChallenge(undefined, testVerifyToken, testChallenge, testVerifyToken);
  assert(res4.valid === false, 'Missing hub.mode is rejected');

  // 1.5 Controller test for GET
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = testVerifyToken;
  let getStatus = 0;
  let getBody = '';
  const mockGetReq: any = {
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': testVerifyToken,
      'hub.challenge': testChallenge
    }
  };
  const mockGetRes: any = {
    status: (code: number) => {
      getStatus = code;
      return mockGetRes;
    },
    send: (body: any) => {
      getBody = body;
      return mockGetRes;
    }
  };
  await handleWhatsAppWebhookGet(mockGetReq, mockGetRes);
  assert(getStatus === 200 && getBody === testChallenge, 'GET controller returns 200 with exact challenge');

  // --------------------------------------------------------------------------
  // TEST GROUP 2: POST Webhook Signature Validation (HMAC-SHA256)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: POST Webhook Signature Validation (HMAC-SHA256) ---');
  const testAppSecret = 'meta_test_app_secret_998877';
  const rawBodyPayload = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }), 'utf8');

  // 2.1 Correct signature
  const validHmac = crypto.createHmac('sha256', testAppSecret).update(rawBodyPayload).digest('hex');
  const validHeader = `sha256=${validHmac}`;
  const sigResult1 = verifyWebhookSignature(rawBodyPayload, validHeader, testAppSecret);
  assert(sigResult1 === true, 'Valid X-Hub-Signature-256 is accepted');

  // 2.2 Tampered / altered body
  const tamperedBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: ['tampered'] }), 'utf8');
  const sigResult2 = verifyWebhookSignature(tamperedBody, validHeader, testAppSecret);
  assert(sigResult2 === false, 'Tampered body with original signature is rejected');

  // 2.3 Invalid signature header
  const invalidHeader = `sha256=11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff`;
  const sigResult3 = verifyWebhookSignature(rawBodyPayload, invalidHeader, testAppSecret);
  assert(sigResult3 === false, 'Invalid signature hash is rejected');

  // 2.4 Missing signature header
  const sigResult4 = verifyWebhookSignature(rawBodyPayload, undefined, testAppSecret);
  assert(sigResult4 === false, 'Missing signature header is rejected');

  // 2.5 Malformed signature format (no sha256= prefix)
  const sigResult5 = verifyWebhookSignature(rawBodyPayload, validHmac, testAppSecret);
  assert(sigResult5 === false, 'Malformed signature header without sha256= prefix is rejected');

  // 2.6 Controller POST signature rejection
  process.env.META_APP_SECRET = testAppSecret;
  process.env.WHATSAPP_DRY_RUN = 'false';
  let postStatus = 0;
  let postData: any = null;
  const mockPostReqBad: any = {
    headers: { 'x-hub-signature-256': 'sha256=bad_sig' },
    rawBody: rawBodyPayload,
    body: { object: 'whatsapp_business_account' }
  };
  const mockPostResBad: any = {
    status: (code: number) => {
      postStatus = code;
      return mockPostResBad;
    },
    json: (data: any) => {
      postData = data;
      return mockPostResBad;
    },
    send: (body: any) => {
      postData = body;
      return mockPostResBad;
    }
  };
  await handleWhatsAppWebhookPost(mockPostReqBad, mockPostResBad);
  assert(postStatus === 401, 'POST webhook with invalid signature returns HTTP 401');

  // --------------------------------------------------------------------------
  // TEST GROUP 3: Bill Creation & Outgoing Message Acceptance
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Bill Creation & Outgoing Message Acceptance ---');
  process.env.WHATSAPP_DRY_RUN = 'true';

  // Find or create customer
  const [custRows]: any = await pool.query('SELECT customer_id, customer_name, mobile_number FROM t_customer_master LIMIT 1');
  let customerId = custRows?.[0]?.customer_id || 1;
  let customerName = custRows?.[0]?.customer_name || 'Test Customer';
  let customerMobile = custRows?.[0]?.mobile_number || '9876543210';

  // Create test bill
  const billItems = [
    { box_number: 1, chicken_quantity: 15, total_kg: 35.0, price_per_kg: 200, amount: 7000 }
  ];

  const spRes = await callProcedure('spDataFlowAddEditBill', [
    0,
    '2026-10-30',
    customerId,
    null,
    null,
    customerName,
    customerMobile,
    'CR',
    'Test Address',
    'Truck-01',
    0,
    'Webhook Integration Test',
    1,
    JSON.stringify(billItems)
  ]);

  let testBillId: number | null = null;
  for (const set of spRes) {
    if (Array.isArray(set) && set[0]?.bill_id) {
      testBillId = set[0].bill_id;
      break;
    }
  }

  assert(testBillId !== null, `Test bill created in database with bill_id: ${testBillId}`);

  // Fetch bill master
  const [billRow]: any = await pool.query('SELECT * FROM t_bill_master WHERE bill_id = ?', [testBillId]);
  const billData: BillData = {
    bill_number: billRow[0].bill_number,
    bill_date: billRow[0].bill_date,
    customer_name_snapshot: billRow[0].customer_name_snapshot,
    customer_mobile_snapshot: billRow[0].customer_mobile_snapshot,
    total_quantity: billRow[0].total_quantity,
    total_kg: billRow[0].total_kg,
    current_bill_amount: billRow[0].current_bill_amount,
    previous_pending_amount: billRow[0].previous_pending_amount,
    total_due_amount: billRow[0].total_due_amount,
    amount_paid: billRow[0].amount_paid,
    final_pending_amount: billRow[0].final_pending_amount,
    items: billItems
  };

  const pdfBuffer = await generateBillPdf(billData);

  const waDetails: WhatsAppBillDetails = {
    customerName: billData.customer_name_snapshot,
    customerMobile: billData.customer_mobile_snapshot,
    billNumber: billData.bill_number,
    billDate: billData.bill_date,
    totalQty: billData.total_quantity,
    totalKg: billData.total_kg,
    totalAmount: billData.current_bill_amount,
    finalPending: billData.final_pending_amount
  };

  const sendResult = await sendBillAsWhatsAppImages(waDetails, pdfBuffer, {
    billId: testBillId!
  });

  assert(sendResult.success === true, 'sendBillAsWhatsAppImages reports success');
  assert(sendResult.messagesSent.length === 1, 'One image message was generated and sent');
  assert(sendResult.messagesSent[0].status === 'accepted', 'Initial message status is "accepted"');
  assert(
    sendResult.message.includes('accepted the bill image'),
    'API response message specifies acceptance awaiting delivery confirmation'
  );

  const testMessageId = sendResult.messagesSent[0].messageId;

  // Verify database record in t_whatsapp_message
  const [dbMsg]: any = await pool.query('SELECT * FROM t_whatsapp_message WHERE whatsapp_message_id = ?', [testMessageId]);
  assert(dbMsg.length === 1, `Message record inserted in t_whatsapp_message with ID ${testMessageId}`);
  assert(dbMsg[0].status === 'accepted', 'Database message status is "accepted"');

  // Verify t_bill_master status is ACCEPTED
  const [dbBillAfterAccept]: any = await pool.query('SELECT whatsapp_status FROM t_bill_master WHERE bill_id = ?', [testBillId]);
  assert(dbBillAfterAccept[0].whatsapp_status === 'ACCEPTED', 't_bill_master.whatsapp_status updated to ACCEPTED');

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Webhook Message Status Processing & Lifecycle
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Webhook Message Status Processing & Lifecycle ---');

  // 4.1 Process 'sent' status
  const timestamp1 = Math.floor(Date.now() / 1000) - 20;
  const sentStatusPayload = {
    id: testMessageId,
    status: 'sent',
    timestamp: String(timestamp1),
    recipient_id: '919876543210'
  };
  const sentRes = await processWhatsAppStatusUpdate(sentStatusPayload);
  assert(sentRes.handled === true && sentRes.newStatus === 'sent', 'Event "sent" transitions status from accepted to sent');

  const [dbMsgSent]: any = await pool.query('SELECT status, sent_at FROM t_whatsapp_message WHERE whatsapp_message_id = ?', [testMessageId]);
  assert(dbMsgSent[0].status === 'sent' && dbMsgSent[0].sent_at !== null, 't_whatsapp_message updated with status="sent" and sent_at timestamp');

  const [dbBillSent]: any = await pool.query('SELECT whatsapp_status FROM t_bill_master WHERE bill_id = ?', [testBillId]);
  assert(dbBillSent[0].whatsapp_status === 'SENT', 't_bill_master updated to SENT');

  // 4.2 Process 'delivered' status
  const timestamp2 = timestamp1 + 5;
  const deliveredStatusPayload = {
    id: testMessageId,
    status: 'delivered',
    timestamp: String(timestamp2),
    recipient_id: '919876543210'
  };
  const delRes = await processWhatsAppStatusUpdate(deliveredStatusPayload);
  assert(delRes.handled === true && delRes.newStatus === 'delivered', 'Event "delivered" transitions status to delivered');

  const [dbMsgDelivered]: any = await pool.query('SELECT status, delivered_at FROM t_whatsapp_message WHERE whatsapp_message_id = ?', [testMessageId]);
  assert(dbMsgDelivered[0].status === 'delivered' && dbMsgDelivered[0].delivered_at !== null, 't_whatsapp_message updated with status="delivered" and delivered_at timestamp');

  const [dbBillDelivered]: any = await pool.query('SELECT whatsapp_status FROM t_bill_master WHERE bill_id = ?', [testBillId]);
  assert(dbBillDelivered[0].whatsapp_status === 'DELIVERED', 't_bill_master updated to DELIVERED');

  // 4.3 Idempotency: Duplicate 'delivered' event arrives
  const dupRes = await processWhatsAppStatusUpdate(deliveredStatusPayload);
  assert(dupRes.handled === true && dupRes.reason === 'duplicate_event_ignored', 'Duplicate event is recognized and safely ignored');

  // 4.4 Out-of-order protection: An older 'sent' arrives after 'delivered'
  const outOfOrderSentPayload = {
    id: testMessageId,
    status: 'sent',
    timestamp: String(timestamp1 - 10),
    recipient_id: '919876543210'
  };
  const oooRes = await processWhatsAppStatusUpdate(outOfOrderSentPayload);
  assert(oooRes.handled === true && oooRes.newStatus === 'delivered', 'Out-of-order "sent" does NOT downgrade "delivered"');

  const [dbMsgStillDelivered]: any = await pool.query('SELECT status FROM t_whatsapp_message WHERE whatsapp_message_id = ?', [testMessageId]);
  assert(dbMsgStillDelivered[0].status === 'delivered', 't_whatsapp_message remains "delivered" after out-of-order event');

  // 4.5 Process 'read' status
  const timestamp3 = timestamp2 + 10;
  const readStatusPayload = {
    id: testMessageId,
    status: 'read',
    timestamp: String(timestamp3),
    recipient_id: '919876543210'
  };
  const readRes = await processWhatsAppStatusUpdate(readStatusPayload);
  assert(readRes.handled === true && readRes.newStatus === 'read', 'Event "read" transitions status to read');

  const [dbMsgRead]: any = await pool.query('SELECT status, read_at FROM t_whatsapp_message WHERE whatsapp_message_id = ?', [testMessageId]);
  assert(dbMsgRead[0].status === 'read' && dbMsgRead[0].read_at !== null, 't_whatsapp_message updated with status="read" and read_at timestamp');

  const [dbBillRead]: any = await pool.query('SELECT whatsapp_status FROM t_bill_master WHERE bill_id = ?', [testBillId]);
  assert(dbBillRead[0].whatsapp_status === 'READ', 't_bill_master updated to READ');

  // 4.6 Out-of-order protection: Delivered arriving after Read
  const outOfOrderDelivered = {
    id: testMessageId,
    status: 'delivered',
    timestamp: String(timestamp2 + 1),
    recipient_id: '919876543210'
  };
  const oooDelRes = await processWhatsAppStatusUpdate(outOfOrderDelivered);
  assert(oooDelRes.handled === true && oooDelRes.newStatus === 'read', 'Out-of-order "delivered" does NOT downgrade "read"');

  // --------------------------------------------------------------------------
  // TEST GROUP 5: Failure Processing & Error Capture
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: Failure Processing & Error Capture ---');

  // Create a second message record to test failure handling
  const failedMsgId = `wamid.test_fail_${Date.now()}`;
  await pool.query(`
    INSERT INTO t_whatsapp_message (
      bill_id, bill_number, recipient_phone, phone_number_id,
      whatsapp_message_id, page_number, total_pages, status
    ) VALUES (?, ?, ?, ?, ?, 1, 1, 'accepted')
  `, [testBillId, billData.bill_number, '919876543210', '1329233200283665', failedMsgId]);

  const failPayload = {
    id: failedMsgId,
    status: 'failed',
    timestamp: String(Math.floor(Date.now() / 1000)),
    recipient_id: '919876543210',
    errors: [
      {
        code: 131047,
        title: 'Message failed to send',
        message: 'Re-engagement message',
        error_data: { details: 'Customer service window closed.' }
      }
    ]
  };

  const failRes = await processWhatsAppStatusUpdate(failPayload);
  assert(failRes.handled === true && failRes.newStatus === 'failed', 'Event "failed" updates status to failed');

  const [dbMsgFailed]: any = await pool.query('SELECT status, error_code, error_title, error_message, failed_at FROM t_whatsapp_message WHERE whatsapp_message_id = ?', [failedMsgId]);
  assert(dbMsgFailed[0].status === 'failed', 'Status is "failed" in database');
  assert(dbMsgFailed[0].error_code === 131047, 'Error code 131047 correctly captured');
  assert(dbMsgFailed[0].error_title === 'Message failed to send', 'Error title captured');
  assert(dbMsgFailed[0].error_message.includes('Customer service window closed'), 'Error details captured');
  assert(dbMsgFailed[0].failed_at !== null, 'failed_at timestamp recorded');

  // Terminal state: sent or delivered cannot overwrite failed
  const lateSent = {
    id: failedMsgId,
    status: 'sent',
    timestamp: String(Math.floor(Date.now() / 1000) + 1),
    recipient_id: '919876543210'
  };
  const lateSentRes = await processWhatsAppStatusUpdate(lateSent);
  assert(lateSentRes.handled === true && lateSentRes.newStatus === 'failed', 'Late "sent" event cannot overwrite terminal "failed" status');

  // --------------------------------------------------------------------------
  // TEST GROUP 6: Multi-Page Bill Tracking & Partial Delivery
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 6: Multi-Page Bill Tracking & Partial Delivery ---');

  // Create multi-page test bill with 2 pages
  const mpBillMsg1 = `wamid.mp_page_1_${Date.now()}`;
  const mpBillMsg2 = `wamid.mp_page_2_${Date.now()}`;

  // Insert page 1 (delivered) and page 2 (failed)
  await pool.query(`
    INSERT INTO t_whatsapp_message (
      bill_id, bill_number, recipient_phone, phone_number_id,
      whatsapp_message_id, page_number, total_pages, status, delivered_at
    ) VALUES (?, ?, ?, ?, ?, 1, 2, 'delivered', NOW())
  `, [testBillId, billData.bill_number, '919876543210', '1329233200283665', mpBillMsg1]);

  await pool.query(`
    INSERT INTO t_whatsapp_message (
      bill_id, bill_number, recipient_phone, phone_number_id,
      whatsapp_message_id, page_number, total_pages, status, failed_at, error_code, error_message
    ) VALUES (?, ?, ?, ?, ?, 2, 2, 'failed', NOW(), 131031, 'Account locked')
  `, [testBillId, billData.bill_number, '919876543210', '1329233200283665', mpBillMsg2]);

  const deliveryReport = await getBillWhatsAppDeliveryStatus(testBillId!);
  assert(deliveryReport !== null, 'Delivery report retrieved for multi-page bill');
  assert(deliveryReport?.overallStatus === 'partially_delivered', 'Multi-page bill with 1 delivered and 1 failed is PARTIALLY_DELIVERED');
  assert(deliveryReport?.messages.length >= 2, 'Per-page breakdown contains page details');

  // --------------------------------------------------------------------------
  // TEST GROUP 7: Delivery Status API Controller Test
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 7: Delivery Status API Controller Test ---');

  let apiStatus = 0;
  let apiData: any = null;
  const mockApiReq: any = {
    params: { id: String(testBillId) },
    user: { userId: 1, role: 'admin' }
  };
  const mockApiRes: any = {
    status: (code: number) => {
      apiStatus = code;
      return mockApiRes;
    },
    json: (data: any) => {
      apiData = data;
      return mockApiRes;
    }
  };

  await getBillWhatsAppStatus(mockApiReq as any, mockApiRes);
  assert(apiStatus === 200 || apiData?.success === true, 'GET /api/bills/:id/whatsapp-status returns 200 with delivery breakdown');
  assert(apiData?.data?.billNumber === billData.bill_number, 'API returns correct bill number');
  assert(Array.isArray(apiData?.data?.messages), 'API returns messages array with per-page tracking');

  // --------------------------------------------------------------------------
  // TEST GROUP 8: Inbound Message Handling
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 8: Inbound Message Handling ---');

  const inboundMsgId = `wamid.inbound_${Date.now()}`;
  await recordInboundWhatsAppMessage({
    id: inboundMsgId,
    from: '919876543210',
    type: 'text',
    timestamp: String(Math.floor(Date.now() / 1000))
  }, { phone_number_id: '1329233200283665' });

  const [inboundAudit]: any = await pool.query(
    'SELECT * FROM t_whatsapp_webhook_event WHERE whatsapp_message_id = ?',
    [inboundMsgId]
  );
  assert(inboundAudit.length === 1, 'Inbound customer message logged in audit table');
  assert(inboundAudit[0].event_type === 'inbound_message', 'Audit record event_type is "inbound_message"');

  // --------------------------------------------------------------------------
  // CLEANUP TEST DATA
  // --------------------------------------------------------------------------
  console.log('\n--- CLEANING UP TEST DATA ---');
  await pool.query('DELETE FROM t_whatsapp_webhook_event WHERE bill_id = ?', [testBillId]);
  await pool.query('DELETE FROM t_whatsapp_webhook_event WHERE whatsapp_message_id = ?', [inboundMsgId]);
  await pool.query('DELETE FROM t_whatsapp_message WHERE bill_id = ?', [testBillId]);
  await pool.query('DELETE FROM t_bill_detail WHERE bill_id = ?', [testBillId]);
  await pool.query('DELETE FROM t_bill_master WHERE bill_id = ?', [testBillId]);
  console.log('Cleaned up test bill and associated tracking events successfully.');

  console.log('\n================================================================');
  console.log(` TEST SUITE COMPLETE: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    throw new Error(`${testsFailed} tests failed.`);
  }
}

runTestSuite()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Fatal test error:', err);
    await pool.end();
    process.exit(1);
  });
