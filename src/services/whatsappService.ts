export interface WhatsAppBillDetails {
  customerName: string;
  customerMobile: string;
  billNumber: string;
  totalQty: number;
  totalKg: number;
  totalAmount: number;
  finalPending: number;
  billDownloadUrl?: string;
}

export function generateWhatsAppShareUrl(details: WhatsAppBillDetails): { url: string; message: string; formattedMobile: string } {
  // Format mobile number: if 10 digits without country code, prepend '91' for India
  let cleanMobile = details.customerMobile.replace(/\D/g, '');
  if (cleanMobile.length === 10) {
    cleanMobile = `91${cleanMobile}`;
  }

  const messageLines = [
    `Hello ${details.customerName},`,
    '',
    `Your SS Trading bill *${details.billNumber}* has been generated.`,
    '',
    `*Total Qty:* ${details.totalQty}`,
    `*Total KG:* ${Number(details.totalKg).toFixed(2)} KG`,
    `*Total Amount:* ₹${Number(details.totalAmount).toLocaleString('en-IN')}`,
    `*Pending Balance:* ₹${Number(details.finalPending).toLocaleString('en-IN')}`
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
