import { pool, callProcedure } from './src/config/db.js';
import {
  getWhatsAppCloudConfig,
  validateWhatsAppConfig,
  maskPhoneNumber,
  logWhatsAppAttempt,
  parseMetaApiError,
  WhatsAppApiError,
  normalizeWhatsAppNumber,
  isCustomerServiceWindowOpen,
  sendWhatsAppTemplateWithImage,
  sendWhatsAppImageMessage,
  sendBillAsWhatsAppImages,
  recordOutgoingWhatsAppMessage,
  recordFailedWhatsAppMessage,
  recalculateBillOverallWhatsAppStatus,
  processWhatsAppStatusUpdate,
  recordInboundWhatsAppMessage,
  getBillWhatsAppDeliveryStatus,
  WhatsAppBillDetails
} from './src/services/whatsappService.js';
import { generateBillPdf, BillData } from './src/services/pdfService.js';

async function runScenarioTestSuite() {
  console.log('================================================================');
  console.log(' RUNNING WHATSAPP 10 SPECIFICATION SCENARIOS TEST SUITE');
  console.log('================================================================\n');

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      testsPassed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}`);
      if (detail) console.error('    Detail:', detail);
      testsFailed++;
    }
  }

  // Ensure test runs in dry run mode for safety
  process.env.WHATSAPP_DRY_RUN = 'true';
  process.env.WHATSAPP_TEMPLATE_NAME = 'ss_trading_invoice';
  process.env.WHATSAPP_TEMPLATE_LANG = 'en';

  // Helper to create a dummy bill
  async function createTestBill(billNum: string, mobile: string): Promise<number> {
    const [custRows]: any = await pool.query('SELECT customer_id FROM t_customer_master LIMIT 1');
    const customerId = custRows?.[0]?.customer_id || 1;

    const [truckRows]: any = await pool.query('SELECT truck_id FROM t_truck_master LIMIT 1');
    const truckId = truckRows?.[0]?.truck_id || 1;

    const [boxes]: any = await pool.query('SELECT box_id FROM t_truck_box LIMIT 2');
    const boxId = boxes?.[0]?.box_id || 1;

    const items = [
      {
        box_number: 1,
        chicken_quantity: 10,
        total_kg: 15.5,
        price_per_kg: 100,
        amount: 1550
      }
    ];

    const results = await callProcedure('spDataFlowAddEditBill', [
      0,
      new Date().toISOString().split('T')[0],
      customerId,
      truckId,
      null,
      'Scenario Test Customer',
      mobile,
      'CR',
      'Test Address, Surat',
      'GJ-05-AB-1234',
      500,
      'Scenario Test Bill',
      1,
      JSON.stringify(items)
    ]);

    let createdId = 0;
    for (const resSet of results) {
      if (Array.isArray(resSet) && resSet.length > 0 && resSet[0]?.bill_id !== undefined) {
        createdId = resSet[0].bill_id;
        break;
      }
    }
    if (!createdId && Array.isArray(results[0]) && results[0][0]) {
      createdId = results[0][0]?.bill_id;
    }

    return createdId;
  }

  // Generate sample 1-page PDF
  const sampleBillData1Page: BillData = {
    bill_number: 'ST-2026-TEST01',
    bill_date: '2026-11-07',
    customer_name_snapshot: 'Scenario Test Customer',
    customer_mobile_snapshot: '9876543210',
    customer_cr_br_snapshot: 'CR',
    customer_address_snapshot: 'Test Market',
    truck_info_snapshot: 'GJ-05-9999',
    total_quantity: 10,
    total_kg: 15.5,
    current_bill_amount: 1550,
    previous_pending_amount: 500,
    total_due_amount: 2050,
    amount_paid: 500,
    final_pending_amount: 1550,
    items: [
      {
        box_number: 1,
        chicken_quantity: 10,
        total_kg: 15.5,
        price_per_kg: 100,
        amount: 1550
      }
    ]
  };

  const pdfBuffer1Page = await generateBillPdf(sampleBillData1Page);

  // Generate multi-page PDF (55 items, > 50 items per page limit)
  const multiItems = Array.from({ length: 55 }, (_, idx) => ({
    box_number: idx + 1,
    chicken_quantity: 10,
    total_kg: 15.5,
    price_per_kg: 100,
    amount: 1550
  }));

  const sampleBillDataMultiPage: BillData = {
    ...sampleBillData1Page,
    bill_number: 'ST-2026-TEST02',
    total_quantity: 550,
    total_kg: 852.5,
    current_bill_amount: 85250,
    final_pending_amount: 85250,
    items: multiItems
  };
  const pdfBufferMultiPage = await generateBillPdf(sampleBillDataMultiPage);

  const cleanupBillIds: number[] = [];

  try {
    // --------------------------------------------------------------------------
    // SCENARIO 1: Customer who has never messaged our business
    // --------------------------------------------------------------------------
    console.log('--- SCENARIO 1: Customer who has never messaged our business ---');
    const newCustPhone = '919999111001';
    // Ensure no inbound messages exist for this number
    await pool.query('DELETE FROM t_whatsapp_webhook_event WHERE recipient_phone = ?', [newCustPhone]);

    const isWindowOpen1 = await isCustomerServiceWindowOpen(newCustPhone);
    assert(isWindowOpen1 === false, 'Customer service window is recognized as closed for new customer');

    const billId1 = await createTestBill('ST-2026-SC01', newCustPhone);
    cleanupBillIds.push(billId1);

    const waDetails1: WhatsAppBillDetails = {
      customerName: 'New Customer One',
      customerMobile: newCustPhone,
      billNumber: 'ST-2026-SC01',
      totalQty: 10,
      totalKg: 15.5,
      totalAmount: 1550,
      finalPending: 1550
    };

    const result1 = await sendBillAsWhatsAppImages(waDetails1, pdfBuffer1Page, { billId: billId1 });
    assert(result1.success === true, 'Bill send succeeded');
    assert(result1.mode === 'template', 'Selected mode is TEMPLATE directly without attempting normal image first');
    assert(result1.messagesSent.length === 1, '1 message sent');
    assert(result1.messagesSent[0].status === 'accepted', 'Initial status is "accepted"');

    const [dbMsg1]: any = await pool.query(
      'SELECT * FROM t_whatsapp_message WHERE whatsapp_message_id = ?',
      [result1.messagesSent[0].messageId]
    );
    assert(dbMsg1.length === 1 && dbMsg1[0].sending_mode === 'template', 'DB records sending_mode as template');

    // --------------------------------------------------------------------------
    // SCENARIO 2: Existing customer with an open 24-hour window
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 2: Existing customer with an open 24-hour window ---');
    const openWindowPhone = '919999222002';
    // Seed an inbound customer message within the last 2 hours
    const inboundTimestamp = Math.floor(Date.now() / 1000) - 7200;
    await pool.query(
      `INSERT INTO t_whatsapp_webhook_event (
        idempotency_key, whatsapp_message_id, event_type, event_status,
        event_timestamp, recipient_phone, phone_number_id, processing_status
      ) VALUES (?, ?, 'inbound_message', 'text', FROM_UNIXTIME(?), ?, 'mock_phone_id', 'acknowledged')`,
      [`inbound_test_${Date.now()}`, `wamid.inbound_${Date.now()}`, inboundTimestamp, openWindowPhone]
    );

    const isWindowOpen2 = await isCustomerServiceWindowOpen(openWindowPhone);
    assert(isWindowOpen2 === true, 'Customer service window is recognized as OPEN due to inbound message in last 24h');

    const billId2 = await createTestBill('ST-2026-SC02', openWindowPhone);
    cleanupBillIds.push(billId2);

    const waDetails2: WhatsAppBillDetails = {
      customerName: 'Active Window Customer',
      customerMobile: openWindowPhone,
      billNumber: 'ST-2026-SC02',
      totalQty: 10,
      totalKg: 15.5,
      totalAmount: 1550,
      finalPending: 1550
    };

    const result2 = await sendBillAsWhatsAppImages(waDetails2, pdfBuffer1Page, { billId: billId2 });
    assert(result2.success === true, 'Bill send succeeded');
    assert(result2.mode === 'session', 'Selected mode is SESSION because customer service window is open');
    assert(result2.messagesSent[0].status === 'accepted', 'Session message recorded as accepted');

    const [dbMsg2]: any = await pool.query(
      'SELECT * FROM t_whatsapp_message WHERE whatsapp_message_id = ?',
      [result2.messagesSent[0].messageId]
    );
    assert(dbMsg2.length === 1 && dbMsg2[0].sending_mode === 'session', 'DB records sending_mode as session');

    // --------------------------------------------------------------------------
    // SCENARIO 3: New customer with a single-page invoice
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 3: New customer with a single-page invoice ---');
    const singlePagePhone = '919999333003';
    const billId3 = await createTestBill('ST-2026-SC03', singlePagePhone);
    cleanupBillIds.push(billId3);

    const waDetails3: WhatsAppBillDetails = {
      customerName: 'Single Page Customer',
      customerMobile: singlePagePhone,
      billNumber: 'ST-2026-SC03',
      totalQty: 10,
      totalKg: 15.5,
      totalAmount: 5000,
      finalPending: 2000
    };

    const result3 = await sendBillAsWhatsAppImages(waDetails3, pdfBuffer1Page, { billId: billId3 });
    assert(result3.totalPages === 1, 'Total pages is exactly 1');
    assert(result3.mode === 'template', 'Mode is template');
    assert(result3.messagesSent.length === 1, 'Exactly 1 message was dispatched');
    assert(result3.messagesSent[0].pageNumber === 1, 'Message is page 1');

    // --------------------------------------------------------------------------
    // SCENARIO 4: New customer with a multi-page invoice
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 4: New customer with a multi-page invoice ---');
    const multiPagePhone = '919999444004';
    const billId4 = await createTestBill('ST-2026-SC04', multiPagePhone);
    cleanupBillIds.push(billId4);

    const waDetails4: WhatsAppBillDetails = {
      customerName: 'Multi Page Customer',
      customerMobile: multiPagePhone,
      billNumber: 'ST-2026-SC04',
      totalQty: 300,
      totalKg: 500.0,
      totalAmount: 50000,
      finalPending: 25000
    };

    const result4 = await sendBillAsWhatsAppImages(waDetails4, pdfBufferMultiPage, { billId: billId4 });
    assert(result4.totalPages > 1, `Multi-page invoice verified with ${result4.totalPages} pages`);
    assert(result4.messagesSent.length === result4.totalPages, `All ${result4.totalPages} pages dispatched`);
    assert(result4.messagesSent[0].pageNumber === 1, 'First message has pageNumber = 1');
    assert(result4.messagesSent[1].pageNumber === 2, 'Second message has pageNumber = 2');

    // Verify all pages in DB have correct total_pages and page_number
    const [dbMultiMsgs]: any = await pool.query(
      'SELECT page_number, total_pages, sending_mode, status FROM t_whatsapp_message WHERE bill_id = ? ORDER BY page_number ASC',
      [billId4]
    );
    assert(dbMultiMsgs.length === result4.totalPages, 'All pages tracked in t_whatsapp_message');
    assert(dbMultiMsgs[0].total_pages === result4.totalPages && dbMultiMsgs[0].page_number === 1, 'Page 1 metadata valid');
    assert(dbMultiMsgs[1].total_pages === result4.totalPages && dbMultiMsgs[1].page_number === 2, 'Page 2 metadata valid');
    // Because customer never messaged, subsequent pages must NOT be sent as normal images
    assert(dbMultiMsgs[1].sending_mode === 'template', 'Subsequent page sent via template outside 24h window');

    // --------------------------------------------------------------------------
    // SCENARIO 5: Template parameter mismatch (Meta Error 132000)
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 5: Template parameter mismatch (Meta Error 132000) ---');
    const metaError132000Json = {
      error: {
        message: 'The number of parameters provided does not match the expected number of parameters.',
        type: 'OAuthException',
        code: 132000,
        error_subcode: 2494010,
        fbtrace_id: 'AbCdEf123456'
      }
    };
    const parsedErr5 = parseMetaApiError(metaError132000Json, 400);
    assert(parsedErr5.code === 132000, 'Error code 132000 parsed correctly');
    assert(parsedErr5.message.includes('parameter mismatch'), 'Friendly error explains parameter mismatch');

    // Verify recordFailedWhatsAppMessage persists failure to database
    const billId5 = await createTestBill('ST-2026-SC05', '919999555005');
    cleanupBillIds.push(billId5);
    await recordFailedWhatsAppMessage({
      billId: billId5,
      billNumber: 'ST-2026-SC05',
      recipientPhone: '919999555005',
      phoneNumberId: 'mock_phone_id',
      pageNumber: 1,
      totalPages: 1,
      sendingMode: 'template',
      errorCode: 132000,
      errorTitle: 'Meta Template Parameter Mismatch',
      errorMessage: parsedErr5.message
    });

    const [dbMsg5]: any = await pool.query(
      'SELECT status, error_code, error_message FROM t_whatsapp_message WHERE bill_id = ?',
      [billId5]
    );
    assert(dbMsg5.length === 1 && dbMsg5[0].status === 'failed', 'DB record status is failed');
    assert(dbMsg5[0].error_code === 132000, 'DB record error_code is 132000');

    const [billRow5]: any = await pool.query('SELECT whatsapp_status FROM t_bill_master WHERE bill_id = ?', [billId5]);
    assert(billRow5[0].whatsapp_status === 'FAILED', 't_bill_master status updated to FAILED');

    // --------------------------------------------------------------------------
    // SCENARIO 6: Invalid customer number
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 6: Invalid customer number ---');
    const invalidPhoneCheck1 = normalizeWhatsAppNumber('');
    assert(invalidPhoneCheck1.valid === false, 'Empty phone number rejected');

    const invalidPhoneCheck2 = normalizeWhatsAppNumber('12345');
    assert(invalidPhoneCheck2.valid === false, 'Short phone number (5 digits) rejected');

    const invalidPhoneCheck3 = normalizeWhatsAppNumber('abcdefghij');
    assert(invalidPhoneCheck3.valid === false, 'Alpha phone number rejected');

    const validNormal = normalizeWhatsAppNumber('9876543210');
    assert(validNormal.valid === true && validNormal.normalized === '919876543210', '10-digit number converted to 91 E.164');

    let threwPhoneError = false;
    try {
      await sendBillAsWhatsAppImages(
        {
          customerName: 'Bad Number Customer',
          customerMobile: 'invalid-num',
          billNumber: 'ST-BAD-PHONE',
          totalQty: 1,
          totalKg: 1,
          totalAmount: 100,
          finalPending: 100
        },
        pdfBuffer1Page
      );
    } catch (err: any) {
      threwPhoneError = true;
      assert(err.message.includes('Invalid') || err.message.includes('phone'), 'Threw clear phone validation error');
    }
    assert(threwPhoneError === true, 'Execution stopped before contacting WhatsApp API for invalid number');

    // --------------------------------------------------------------------------
    // SCENARIO 7: Media upload failure
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 7: Media upload failure ---');
    // Test with simulated oversized buffer (> 5MB)
    let threwMediaError = false;
    try {
      // In dry run, upload handles mock, but let's test uploadMediaToWhatsApp directly with oversize
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024); // 6 MB
      // Switch temporarily to non-dry-run to test size guard
      process.env.WHATSAPP_DRY_RUN = 'false';
      const { uploadMediaToWhatsApp } = await import('./src/services/whatsappService.js');
      await uploadMediaToWhatsApp(largeBuffer, 'large.png');
    } catch (err: any) {
      threwMediaError = true;
      assert(err.message.includes('exceeds WhatsApp 5 MB limit'), 'Oversize media rejected with clear limit message');
    } finally {
      process.env.WHATSAPP_DRY_RUN = 'true';
    }
    assert(threwMediaError === true, 'Media size guard enforced before API call');

    // --------------------------------------------------------------------------
    // SCENARIO 8: Template rejected by Meta (e.g. 132001 template not found)
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 8: Template rejected by Meta (e.g. 132001) ---');
    const metaError132001Json = {
      error: {
        message: 'Template name does not exist in the translated language',
        type: 'OAuthException',
        code: 132001,
        fbtrace_id: 'Trace132001'
      }
    };
    const parsedErr8 = parseMetaApiError(metaError132001Json, 400);
    assert(parsedErr8.code === 132001, 'Error code 132001 parsed correctly');
    assert(parsedErr8.message.includes('not found or unavailable'), 'Friendly explanation for missing template');

    // Verify phone masking in log entry
    const masked8 = maskPhoneNumber('918780743299');
    assert(masked8 === '9187****3299', 'Phone number properly masked in logs without revealing user identity');

    // --------------------------------------------------------------------------
    // SCENARIO 9: Message accepted but subsequently marked failed by webhook
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 9: Message accepted but subsequently marked failed by webhook ---');
    const billId9 = await createTestBill('ST-2026-SC09', '919999999009');
    cleanupBillIds.push(billId9);

    const testMsgId9 = `wamid.test_scen9_${Date.now()}`;
    await recordOutgoingWhatsAppMessage({
      billId: billId9,
      billNumber: 'ST-2026-SC09',
      recipientPhone: '919999999009',
      phoneNumberId: 'mock_phone_id',
      whatsappMessageId: testMsgId9,
      pageNumber: 1,
      totalPages: 1,
      sendingMode: 'template',
      status: 'accepted'
    });

    // Simulate incoming webhook event: failed (e.g. error 131026 message undeliverable)
    const webhookFailedPayload = {
      id: testMsgId9,
      status: 'failed',
      timestamp: String(Math.floor(Date.now() / 1000)),
      recipient_id: '919999999009',
      errors: [
        {
          code: 131026,
          title: 'Message Undeliverable',
          message: 'Receiver is incapable of receiving this message'
        }
      ]
    };

    const webhookResult9 = await processWhatsAppStatusUpdate(webhookFailedPayload, { phone_number_id: 'mock_phone_id' });
    assert(webhookResult9.handled === true, 'Webhook failure update processed');
    assert(webhookResult9.newStatus === 'failed', 'Status transitioned to failed');

    const [dbMsg9]: any = await pool.query(
      'SELECT status, error_code, error_title, failed_at FROM t_whatsapp_message WHERE whatsapp_message_id = ?',
      [testMsgId9]
    );
    assert(dbMsg9[0].status === 'failed', 'Message status in DB updated to failed');
    assert(dbMsg9[0].error_code === 131026, 'Error code 131026 saved in DB');
    assert(dbMsg9[0].failed_at !== null, 'failed_at timestamp recorded');

    const [billRow9]: any = await pool.query('SELECT whatsapp_status FROM t_bill_master WHERE bill_id = ?', [billId9]);
    assert(billRow9[0].whatsapp_status === 'FAILED', 't_bill_master updated to FAILED');

    // --------------------------------------------------------------------------
    // SCENARIO 10: Successful delivery and read status
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 10: Successful delivery and read status ---');
    const billId10 = await createTestBill('ST-2026-SC10', '919999000010');
    cleanupBillIds.push(billId10);

    const testMsgId10 = `wamid.test_scen10_${Date.now()}`;
    await recordOutgoingWhatsAppMessage({
      billId: billId10,
      billNumber: 'ST-2026-SC10',
      recipientPhone: '919999000010',
      phoneNumberId: 'mock_phone_id',
      whatsappMessageId: testMsgId10,
      pageNumber: 1,
      totalPages: 1,
      sendingMode: 'template',
      status: 'accepted'
    });

    const nowSec = Math.floor(Date.now() / 1000);

    // Step 1: Webhook 'sent'
    await processWhatsAppStatusUpdate({
      id: testMsgId10,
      status: 'sent',
      timestamp: String(nowSec)
    });
    const [dbMsg10_sent]: any = await pool.query('SELECT status, sent_at FROM t_whatsapp_message WHERE whatsapp_message_id = ?', [testMsgId10]);
    assert(dbMsg10_sent[0].status === 'sent' && dbMsg10_sent[0].sent_at !== null, 'Message transitioned to sent with timestamp');

    // Step 2: Webhook 'delivered'
    await processWhatsAppStatusUpdate({
      id: testMsgId10,
      status: 'delivered',
      timestamp: String(nowSec + 2)
    });
    const [dbMsg10_del]: any = await pool.query('SELECT status, delivered_at FROM t_whatsapp_message WHERE whatsapp_message_id = ?', [testMsgId10]);
    assert(dbMsg10_del[0].status === 'delivered' && dbMsg10_del[0].delivered_at !== null, 'Message transitioned to delivered with timestamp');

    const [billRow10_del]: any = await pool.query('SELECT whatsapp_status FROM t_bill_master WHERE bill_id = ?', [billId10]);
    assert(billRow10_del[0].whatsapp_status === 'DELIVERED', 't_bill_master updated to DELIVERED');

    // Step 3: Webhook 'read'
    await processWhatsAppStatusUpdate({
      id: testMsgId10,
      status: 'read',
      timestamp: String(nowSec + 5)
    });
    const [dbMsg10_read]: any = await pool.query('SELECT status, read_at FROM t_whatsapp_message WHERE whatsapp_message_id = ?', [testMsgId10]);
    assert(dbMsg10_read[0].status === 'read' && dbMsg10_read[0].read_at !== null, 'Message transitioned to read with timestamp');

    const [billRow10_read]: any = await pool.query('SELECT whatsapp_status FROM t_bill_master WHERE bill_id = ?', [billId10]);
    assert(billRow10_read[0].whatsapp_status === 'READ', 't_bill_master updated to READ');

    // Step 4: Out-of-order protection: An out-of-order 'delivered' must NOT downgrade 'read'
    const outOfOrderResult = await processWhatsAppStatusUpdate({
      id: testMsgId10,
      status: 'delivered',
      timestamp: String(nowSec + 1)
    });
    assert(outOfOrderResult.reason === 'out_of_order_downgrade_prevented', 'Out-of-order downgrade prevented');
    const [dbMsg10_stillRead]: any = await pool.query('SELECT status FROM t_whatsapp_message WHERE whatsapp_message_id = ?', [testMsgId10]);
    assert(dbMsg10_stillRead[0].status === 'read', 'Status preserved as "read" after out-of-order event');

    // Step 5: Verify getBillWhatsAppDeliveryStatus controller reporting
    const fullDeliveryReport = await getBillWhatsAppDeliveryStatus(billId10);
    assert(fullDeliveryReport !== null, 'Full delivery report retrieved');
    assert(fullDeliveryReport?.overallStatus === 'read', 'Report overallStatus is read');
    assert(fullDeliveryReport?.messages[0].readAt !== null, 'Report contains read timestamp');
  } finally {
    // Clean up test data
    console.log('\n--- CLEANING UP SCENARIO TEST DATA ---');
    for (const id of cleanupBillIds) {
      await pool.query('DELETE FROM t_whatsapp_message WHERE bill_id = ?', [id]);
      await pool.query('DELETE FROM t_whatsapp_webhook_event WHERE bill_id = ?', [id]);
      await pool.query('DELETE FROM t_bill_detail WHERE bill_id = ?', [id]);
      await pool.query('DELETE FROM t_bill_master WHERE bill_id = ?', [id]);
    }
    console.log(`Cleaned up ${cleanupBillIds.length} test bills and associated tracking records.`);
    await pool.end();
  }

  console.log('\n================================================================');
  console.log(` 10 SCENARIO SUITE COMPLETE: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runScenarioTestSuite().catch((err) => {
  console.error('Test Suite encountered fatal error:', err);
  process.exit(1);
});
