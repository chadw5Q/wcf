import type { APIRoute } from 'astro';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { customerInfo, orderItems, quantities, orderTotal, isDeposit, depositAmount } = body;

    // Format order items for email
    const formatOrderItems = () => {
      const items = [];
      if (quantities.premiumLine > 0) {
        items.push(`• Premium Line Posts: ${quantities.premiumLine} @ $25 each = $${(quantities.premiumLine * 25).toFixed(2)}`);
      }
      if (quantities.premiumCorner > 0) {
        items.push(`• Premium Corner Posts: ${quantities.premiumCorner} @ $40 each = $${(quantities.premiumCorner * 40).toFixed(2)}`);
      }
      if (quantities.premiumExtraLong > 0) {
        items.push(`• Premium Extra Long Posts: ${quantities.premiumExtraLong} @ $60 each = $${(quantities.premiumExtraLong * 60).toFixed(2)}`);
      }
      if (quantities.regularLine > 0) {
        items.push(`• Regular Line Posts: ${quantities.regularLine} @ $10 each = $${(quantities.regularLine * 10).toFixed(2)}`);
      }
      if (quantities.regularCorner > 0) {
        items.push(`• Regular Corner Posts: ${quantities.regularCorner} @ $25 each = $${(quantities.regularCorner * 25).toFixed(2)}`);
      }
      if (quantities.bowStave > 0) {
        items.push(`• Bow Stave Logs: ${quantities.bowStave} @ $125 each = $${(quantities.bowStave * 125).toFixed(2)}`);
      }
      return items.join('\n');
    };

    const totalPosts = quantities.premiumLine + quantities.premiumCorner + quantities.premiumExtraLong + quantities.regularLine + quantities.regularCorner;
    const hasVolumeDiscount = totalPosts >= 100;
    const discountAmount = hasVolumeDiscount ? orderTotal * 0.1 : 0;
    const finalTotal = orderTotal - discountAmount;

    // Create email content
    const emailSubject = isDeposit 
      ? `🎯 New Hedge Post Deposit Payment - ${customerInfo.firstName} ${customerInfo.lastName}`
      : `📋 New Hedge Post Order Inquiry - ${customerInfo.firstName} ${customerInfo.lastName}`;

    const emailContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background-color: #16a34a; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .order-details { background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .customer-info { background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .payment-info { background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0; border: 1px solid #ffeaa7; }
    .total { font-weight: bold; font-size: 1.2em; color: #16a34a; }
    .notes { background-color: #f8f9fa; padding: 15px; border-left: 4px solid #6c757d; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${isDeposit ? '💰 Deposit Payment Received!' : '📋 New Order Inquiry'}</h1>
    <p>Southwest Iowa Hedge - Order Notification</p>
  </div>
  
  <div class="content">
    <div class="customer-info">
      <h2>👤 Customer Information</h2>
      <p><strong>Name:</strong> ${customerInfo.firstName} ${customerInfo.lastName}</p>
      <p><strong>Email:</strong> ${customerInfo.email}</p>
      <p><strong>Phone:</strong> ${customerInfo.phone}</p>
      <p><strong>Address:</strong> ${customerInfo.address}</p>
      <p><strong>City:</strong> ${customerInfo.city}, ${customerInfo.state} ${customerInfo.zipCode}</p>
    </div>

    <div class="order-details">
      <h2>📦 Order Details</h2>
      <pre style="font-family: Arial, sans-serif; white-space: pre-line;">${formatOrderItems()}</pre>
      
      ${hasVolumeDiscount ? `<p><strong>Volume Discount (10%):</strong> -$${discountAmount.toFixed(2)}</p>` : ''}
      <p class="total">Order Total: $${finalTotal.toFixed(2)}</p>
    </div>

    ${isDeposit ? `
    <div class="payment-info">
      <h2>💳 Payment Information</h2>
      <p><strong>Status:</strong> ✅ Deposit Paid</p>
      <p><strong>Deposit Amount:</strong> $${depositAmount.toFixed(2)}</p>
      <p><strong>Remaining Balance:</strong> $${(finalTotal - depositAmount).toFixed(2)}</p>
      <p><em>Customer has secured their order in the production queue.</em></p>
    </div>
    ` : `
    <div class="payment-info">
      <h2>📋 Order Status</h2>
      <p><strong>Status:</strong> 📧 Inquiry Only (No Payment)</p>
      <p><em>Customer submitted an order inquiry without deposit.</em></p>
    </div>
    `}

    ${customerInfo.notes ? `
    <div class="notes">
      <h2>📝 Customer Notes</h2>
      <p>${customerInfo.notes}</p>
    </div>
    ` : ''}

    <div style="margin-top: 30px; padding: 15px; background-color: #e3f2fd; border-radius: 5px;">
      <h3>🎯 Next Steps:</h3>
      <ol>
        <li>Contact customer within 24 hours to confirm details</li>
        <li>Schedule pickup/visit time for post selection</li>
        ${isDeposit ? '<li>Prepare posts for customer selection (order is secured)</li>' : '<li>Discuss deposit options if interested</li>'}
        <li>Coordinate final payment and pickup</li>
      </ol>
    </div>
  </div>
</body>
</html>
    `;

    // Send email
    const emailData = await resend.emails.send({
      from: 'Southwest Iowa Hedge <orders@southwestiowhedge.com>', // You'll need to set up a domain
      to: ['cchadww@gmail.com'],
      subject: emailSubject,
      html: emailContent,
    });

    console.log('Email sent successfully:', emailData);

    return new Response(JSON.stringify({ success: true, emailId: emailData.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error sending email:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to send email notification',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};