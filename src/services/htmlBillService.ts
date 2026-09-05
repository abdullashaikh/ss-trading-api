import { BillData } from './pdfService.js';

export function renderBillHtml(bill: BillData, downloadUrl: string): string {
  const formattedDate = bill.bill_date
    ? new Date(bill.bill_date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    : '';

  const formatCurrency = (val: number) => {
    return (
      '₹ ' +
      Number(val || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    );
  };

  const itemRowsHtml = (bill.items || [])
    .map(
      (item, index) => `
    <tr style="background: ${index % 2 === 0 ? '#ffffff' : '#f9fafb'}; border-bottom: 1px solid #f3f4f6;">
      <td style="padding: 10px 8px; text-align: center; font-size: 12px; color: #6b7280;">${index + 1}</td>
      <td style="padding: 10px 8px; text-align: center; font-size: 12px; font-weight: 700; color: #1f2937;">Box ${item.box_number}</td>
      <td style="padding: 10px 8px; text-align: center; font-size: 12px; font-weight: 600; color: #374151;">${item.chicken_quantity}</td>
      <td style="padding: 10px 8px; text-align: right; font-size: 12px; font-weight: 600; color: #374151;">${Number(item.total_kg).toFixed(2)} KG</td>
      <td style="padding: 10px 8px; text-align: right; font-size: 12px; font-weight: 600; color: #374151;">₹ ${Number(item.price_per_kg).toFixed(2)}</td>
      <td style="padding: 10px 8px; text-align: right; font-size: 12px; font-weight: 700; color: #111827;">${formatCurrency(item.amount)}</td>
    </tr>
  `
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="gu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Invoice #${bill.bill_number} - SS TRADING</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #F3F4F6;
      color: #1F2937;
      line-height: 1.5;
      padding: 12px 8px;
      overflow-x: hidden;
    }
    .bill-wrapper {
      max-width: 600px;
      margin: 0 auto;
      background: #FFFFFF;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      overflow: hidden;
      border: 1px solid #E5E7EB;
    }
    .header-bar {
      background: #B91C1C;
      color: #FFFFFF;
      padding: 18px 14px;
      text-align: center;
    }
    .brand-title {
      font-size: 22px;
      font-weight: 900;
      letter-spacing: 1px;
      margin-bottom: 3px;
    }
    .brand-sub {
      font-size: 11px;
      opacity: 0.95;
      font-weight: 500;
    }
    .action-bar {
      display: flex;
      gap: 8px;
      padding: 12px;
      background: #FEF2F2;
      border-bottom: 1px solid #FEE2E2;
      flex-wrap: wrap;
    }
    .btn {
      flex: 1;
      min-width: 130px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 11px 14px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-download {
      background: #B91C1C;
      color: #FFFFFF;
      box-shadow: 0 2px 6px rgba(185, 28, 28, 0.3);
    }
    .btn-download:hover { background: #991B1B; }
    .btn-share {
      background: #059669;
      color: #FFFFFF;
      box-shadow: 0 2px 6px rgba(5, 150, 105, 0.3);
    }
    .btn-share:hover { background: #047857; }
    .meta-box {
      margin: 14px;
      padding: 12px;
      background: #F9FAFB;
      border-radius: 12px;
      border: 1px solid #E5E7EB;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      font-size: 12px;
    }
    .meta-title {
      font-size: 10px;
      font-weight: 800;
      color: #B91C1C;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 3px;
    }
    .meta-value {
      color: #111827;
      font-weight: 700;
      font-size: 13px;
    }
    .meta-label {
      color: #6B7280;
      font-weight: 500;
      font-size: 11px;
      margin-top: 1px;
    }
    .table-container {
      margin: 0 14px 14px 14px;
      border: 1px solid #E5E7EB;
      border-radius: 12px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    thead th {
      background: #B91C1C;
      color: #FFFFFF;
      padding: 8px 6px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.25;
    }
    .sub-head {
      display: block;
      font-size: 9.5px;
      font-weight: 400;
      opacity: 0.9;
    }
    .subtotal-row {
      background: #E5E7EB;
      font-weight: 800;
      font-size: 12px;
      color: #1F2937;
    }
    .summary-card {
      margin: 0 14px 16px 14px;
      border: 1px solid #E5E7EB;
      border-radius: 12px;
      overflow: hidden;
      background: #FFFFFF;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      font-size: 12.5px;
      border-bottom: 1px solid #F3F4F6;
    }
    .summary-row.bold {
      font-weight: 700;
      background: #F9FAFB;
    }
    .summary-row.final {
      background: #FEE2E2;
      color: #B91C1C;
      font-weight: 800;
      font-size: 14.5px;
      border-bottom: none;
    }
    .footer-note {
      padding: 14px;
      background: #F9FAFB;
      border-top: 1px solid #E5E7EB;
      font-size: 11px;
      color: #6B7280;
      text-align: center;
    }
    .footer-sig {
      margin-top: 8px;
      font-weight: 700;
      color: #1F2937;
    }
    @media (max-width: 440px) {
      .meta-box { grid-template-columns: 1fr; }
      .brand-title { font-size: 19px; }
    }
  </style>
</head>
<body>
  <div class="bill-wrapper">
    <!-- Header -->
    <div class="header-bar">
      <div class="brand-title">SS TRADING</div>
      <div class="brand-sub">CHICKEN WHOLESALER & DISTRIBUTION NETWORK</div>
      <div class="brand-sub" style="margin-top: 2px;">Phone: +91 9876543210</div>
    </div>

    <!-- Quick Action Bar -->
    <div class="action-bar">
      <a href="${downloadUrl}" class="btn btn-download">
        <span>📥</span>
        <span>Download PDF (પીડીએફ ડાઉનલોડ)</span>
      </a>
      <button onclick="shareBill()" class="btn btn-share">
        <span>💬</span>
        <span>Share (શેર કરો)</span>
      </button>
    </div>

    <!-- Meta Details (Name, Mobile, Bill No, Date) -->
    <div class="meta-box">
      <div>
        <div class="meta-title">CUSTOMER DETAILS</div>
        <div class="meta-value">${bill.customer_name_snapshot}</div>
        <div class="meta-label">📱 ${bill.customer_mobile_snapshot || 'N/A'}</div>
      </div>
      <div>
        <div class="meta-title">BILL DETAILS</div>
        <div class="meta-value">Invoice: #${bill.bill_number}</div>
        <div class="meta-label">📅 Date: ${formattedDate || bill.bill_date}</div>
      </div>
    </div>

    <!-- Line Items Table -->
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th style="width: 28px; text-align: center;">SR<span class="sub-head">ક્રમ</span></th>
            <th style="text-align: center;">BOX NO<span class="sub-head">બોક્સ નં</span></th>
            <th style="text-align: center;">QTY<span class="sub-head">નંગ</span></th>
            <th style="text-align: right;">WEIGHT<span class="sub-head">વજન (KG)</span></th>
            <th style="text-align: right;">RATE<span class="sub-head">ભાવ (₹)</span></th>
            <th style="text-align: right;">AMOUNT<span class="sub-head">રકમ (₹)</span></th>
          </tr>
        </thead>
        <tbody>
          ${itemRowsHtml}
          <!-- Subtotal Row -->
          <tr class="subtotal-row">
            <td colspan="2" style="padding: 9px 10px; text-align: center;">TOTAL (કુલ)</td>
            <td style="padding: 9px 6px; text-align: center;">${bill.total_quantity}</td>
            <td style="padding: 9px 6px; text-align: right;">${Number(bill.total_kg).toFixed(2)} KG</td>
            <td style="padding: 9px 6px; text-align: right;">—</td>
            <td style="padding: 9px 6px; text-align: right;">${formatCurrency(bill.current_bill_amount)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Financial Calculation Summary -->
    <div class="summary-card">
      <div class="summary-row">
        <span>Current Bill Amount (હાલનું બિલ):</span>
        <strong>${formatCurrency(bill.current_bill_amount)}</strong>
      </div>
      <div class="summary-row">
        <span>Previous Pending (અગાઉની બાકી):</span>
        <strong style="color: ${Number(bill.previous_pending_amount) > 0 ? '#DC2626' : '#2563EB'};">
          ${formatCurrency(bill.previous_pending_amount)}
        </strong>
      </div>
      <div class="summary-row bold">
        <span>Total Due Amount (કુલ બાકી):</span>
        <strong>${formatCurrency(bill.total_due_amount)}</strong>
      </div>
      <div class="summary-row" style="color: #059669;">
        <span>(-) Amount Paid (ચૂકવેલ રકમ):</span>
        <strong style="font-weight: 700;">${formatCurrency(bill.amount_paid)}</strong>
      </div>
      <div class="summary-row final">
        <span>Final Pending Balance (અંતિમ બાકી):</span>
        <span>${formatCurrency(bill.final_pending_amount)}</span>
      </div>
    </div>

    <!-- Bottom Action Button for convenience -->
    <div style="padding: 0 14px 14px 14px;">
      <a href="${downloadUrl}" class="btn btn-download" style="width: 100%; padding: 12px;">
        <span>📥</span>
        <span>Download Official PDF (પીડીએફ ડાઉનલોડ)</span>
      </a>
    </div>

    <!-- Footer Note -->
    <div class="footer-note">
      <p>1. All chicken weights and counts checked at delivery.</p>
      <p>2. Please settle remaining pending amount as per payment terms.</p>
      <div class="footer-sig">SS TRADING — Authorized Signature</div>
    </div>
  </div>

  <script>
    function shareBill() {
      if (navigator.share) {
        navigator.share({
          title: "SS Trading Bill #${bill.bill_number}",
          text: "View bill #${bill.bill_number} from SS Trading. Final Pending: ${formatCurrency(bill.final_pending_amount)}",
          url: window.location.href
        }).catch(function() {});
      } else {
        var text = encodeURIComponent("SS Trading Bill #${bill.bill_number}\\nView bill: " + window.location.href);
        window.open("https://wa.me/?text=" + text, "_blank");
      }
    }
  </script>
</body>
</html>`;
}
