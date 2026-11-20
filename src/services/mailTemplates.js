/**
 * Email layouts. Plain HTML with inline styles (email clients ignore stylesheets), a text
 * version for clients that show only text, and nothing that needs an image to make sense.
 */
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const rupees = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

function layout({ preheader, title, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f1e9;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f6f1e9;">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f1e9;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;background:#ffffff;border-radius:14px;border:1px solid #eadfcb;">
        <tr><td align="center" style="padding:26px 24px 0 24px;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;font-weight:bold;color:#6b1f1f;">श्याम जगत</div>
          <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#c8791a;margin-top:4px;">SHYAM JAGAT</div>
          <div style="height:2px;width:44px;background:#e87722;margin:16px auto 0 auto;"></div>
        </td></tr>
        <tr><td style="padding:22px 28px 30px 28px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#3e1815;">
          <h1 style="margin:0 0 14px 0;font-size:20px;line-height:1.3;font-weight:600;color:#3e1815;text-align:center;">${esc(title)}</h1>
          ${bodyHtml}
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;">
        <tr><td align="center" style="padding:16px 12px 0 12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8580;">
          Jai Shri Shyam 🙏<br>This is an automated message from Shyam Jagat. Please do not reply to it.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** The 6-digit code that proves someone owns the email they signed up with. */
/** The code that lets someone choose a new password (forgot password). */
export function passwordResetCodeEmail({ fullName, code, minutes }) {
  return {
    subject: `${code} is your Shyam Jagat password reset code`,
    text: `Hi ${fullName},

Your Shyam Jagat password reset code is ${code}.
It works for ${minutes} minutes. Enter it on the forgot-password page to choose a new password.

If you did not ask to reset your password, you can ignore this email: your password stays as it is. Never share this code with anyone.

Jai Shri Shyam`,
    html: layout({
      preheader: `Your password reset code is ${code}`,
      title: "Reset your password",
      bodyHtml: `
        <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#595656;text-align:center;">Hi ${esc(fullName)}, enter this code on the forgot-password page to choose a new password.</p>
        <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 18px auto;">
          <tr><td align="center" style="background:#fff7ea;border:1px solid #f0d9ad;border-radius:12px;padding:16px 26px;">
            <span style="display:block;white-space:nowrap;font-family:'SF Mono','Cascadia Mono',Consolas,'Courier New',monospace;font-size:34px;line-height:1;font-weight:bold;letter-spacing:7px;color:#6b1f1f;">${esc(code)}</span>
          </td></tr>
        </table>
        <p style="margin:0 0 6px 0;font-size:14px;line-height:1.5;color:#595656;text-align:center;">This code expires in <b>${esc(minutes)} minutes</b>.</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#8a8580;text-align:center;">Never share this code with anyone. If you did not ask for this, you can safely ignore this email: your password has not changed.</p>`,
    }),
  };
}

export function signupOtpEmail({ fullName, code, minutes }) {
  return {
    subject: `${code} is your Shyam Jagat verification code`,
    text: `Hi ${fullName},

Your Shyam Jagat verification code is ${code}.
It works for ${minutes} minutes. Enter it on the sign-up page to continue.

If you did not try to sign up, you can ignore this email. Never share this code with anyone.

Jai Shri Shyam`,
    html: layout({
      preheader: `Your verification code is ${code}`,
      title: "Verify your email",
      bodyHtml: `
        <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#595656;text-align:center;">Hi ${esc(fullName)}, enter this code to verify your email and continue your registration.</p>
        <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 18px auto;">
          <tr><td align="center" style="background:#fff7ea;border:1px solid #f0d9ad;border-radius:12px;padding:16px 26px;">
            <span style="display:block;white-space:nowrap;font-family:'SF Mono','Cascadia Mono',Consolas,'Courier New',monospace;font-size:34px;line-height:1;font-weight:bold;letter-spacing:7px;color:#6b1f1f;">${esc(code)}</span>
          </td></tr>
        </table>
        <p style="margin:0 0 6px 0;font-size:14px;line-height:1.5;color:#595656;text-align:center;">This code expires in <b>${esc(minutes)} minutes</b>.</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#8a8580;text-align:center;">Never share this code with anyone. If you did not try to sign up, you can safely ignore this email.</p>`,
    }),
  };
}

/** Sent once the account exists: what was paid, and what is left. */
export function welcomeEmail({ fullName, paid, balance, receipt, siteUrl }) {
  const balanceHtml =
    balance > 0
      ? `<p style="margin:14px 0 0;padding:12px 14px;background:#fff8ec;border-left:4px solid #e87722;font-size:14px;">A balance of <b>${rupees(balance)}</b> is still pending. You can pay it any time from your profile.</p>`
      : `<p style="margin:14px 0 0;padding:12px 14px;background:#f0fbf3;border-left:4px solid #16a34a;font-size:14px;">Your registration fee is paid in full. Thank you!</p>`;
  return {
    subject: "Welcome to Shyam Jagat - your account is ready",
    text: `Hi ${fullName},\n\nYour Shyam Jagat account is ready.\nPaid: ${rupees(paid)}${balance > 0 ? `\nBalance pending: ${rupees(balance)}` : ""}\nReceipt: ${receipt ?? "-"}\n\nSign in: ${siteUrl}/login\n\nJai Shri Shyam`,
    html: layout({
      preheader: "Your account is ready",
      title: "Welcome to the family 🙏",
      bodyHtml: `
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Hi ${esc(fullName)}, your Shyam Jagat account is ready.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="font-size:14px;border-top:1px solid #ecd9b0;border-bottom:1px solid #ecd9b0;">
          <tr><td style="color:#8a8580;">Amount paid</td><td align="right"><b>${rupees(paid)}</b></td></tr>
          ${balance > 0 ? `<tr><td style="color:#8a8580;">Balance pending</td><td align="right"><b style="color:#dc2626;">${rupees(balance)}</b></td></tr>` : ""}
          <tr><td style="color:#8a8580;">Receipt</td><td align="right">${esc(receipt ?? "-")}</td></tr>
        </table>
        ${balanceHtml}
        <p style="margin:22px 0 0;text-align:center;"><a href="${esc(siteUrl)}/login" style="display:inline-block;background:#e87722;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px;">Sign in</a></p>`,
    }),
  };
}

const when = (iso) =>
  new Date(iso ?? Date.now()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

const row = (label, value, strong = false) =>
  `<tr><td style="color:#8a8580;vertical-align:top;">${esc(label)}</td><td align="right" style="vertical-align:top;">${strong ? "<b>" : ""}${esc(value)}${strong ? "</b>" : ""}</td></tr>`;

/** An invoice-style receipt for a registration-fee payment. */
export function paymentReceiptEmail({ fullName, email, receiptNo, paidAt, amount, paymentRef, offline, note, total, paid, balance, siteUrl, supportEmail }) {
  const method = offline ? `Recorded by the Shyam Jagat team${note ? ` (${note})` : ""}` : paymentRef ? `Online via Razorpay (${paymentRef})` : "Online via Razorpay";
  return {
    subject: `Payment receipt ${receiptNo} - ${rupees(amount)} received`,
    text: `Hi ${fullName},

Thank you. We have received your registration fee payment.

PAYMENT RECEIPT
Receipt no: ${receiptNo}
Date: ${when(paidAt)}
Billed to: ${fullName} (${email})
Description: Registration fee
Payment: ${method}
Amount paid: ${rupees(amount)}

Registration fee: ${rupees(total)}
Paid so far: ${rupees(paid)}
${balance > 0 ? `Balance still to pay: ${rupees(balance)}` : "Your registration fee is paid in full."}

${balance > 0 ? `You can pay the balance any time from your profile: ${siteUrl}/profile\n\n` : ""}This is a computer-generated receipt and needs no signature. Questions? Write to ${supportEmail}.
Refund policy: ${siteUrl}/refund-policy

Jai Shri Shyam`,
    html: layout({
      preheader: `Receipt ${receiptNo}: ${rupees(amount)} received`,
      title: "Payment receipt",
      bodyHtml: `
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Hi ${esc(fullName)}, thank you. We have received your registration fee payment.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="font-size:14px;border-top:2px solid #e87722;border-bottom:1px solid #ecd9b0;">
          ${row("Receipt no", receiptNo, true)}
          ${row("Date", when(paidAt))}
          ${row("Billed to", `${fullName} (${email})`)}
          ${row("Description", "Registration fee")}
          ${row("Payment", method)}
          <tr><td style="color:#3e1815;border-top:1px solid #ecd9b0;"><b>Amount paid</b></td><td align="right" style="border-top:1px solid #ecd9b0;font-size:18px;"><b>${rupees(amount)}</b></td></tr>
        </table>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="font-size:14px;margin-top:14px;">
          ${row("Registration fee", rupees(total))}
          ${row("Paid so far", rupees(paid))}
          ${balance > 0 ? `<tr><td style="color:#8a8580;">Balance still to pay</td><td align="right"><b style="color:#dc2626;">${rupees(balance)}</b></td></tr>` : ""}
        </table>
        <p style="margin:14px 0 0;padding:12px 14px;background:${balance > 0 ? "#fff8ec" : "#f0fbf3"};border-left:4px solid ${balance > 0 ? "#e87722" : "#16a34a"};font-size:14px;line-height:1.5;">${balance > 0 ? `A balance of <b>${rupees(balance)}</b> is still pending. You can pay it any time from your profile.` : "Your registration fee is paid in full. Thank you!"}</p>
        ${balance > 0 ? `<p style="margin:18px 0 0;text-align:center;"><a href="${esc(siteUrl)}/profile" style="display:inline-block;background:#e87722;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px;">Pay the balance</a></p>` : ""}
        <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#8a8580;text-align:center;">This is a computer-generated receipt and needs no signature.<br>Questions? Write to <a href="mailto:${esc(supportEmail)}" style="color:#e87722;">${esc(supportEmail)}</a>. <a href="${esc(siteUrl)}/refund-policy" style="color:#e87722;">Refund policy</a></p>`,
    }),
  };
}

/** A thank-you with a receipt for a donation. */
export function donationReceiptEmail({ donorName, receiptNo, paidAt, amount, cause, paymentRef, siteUrl, supportEmail }) {
  return {
    subject: `Thank you for your donation of ${rupees(amount)} - receipt ${receiptNo}`,
    text: `Dear ${donorName},

Thank you for your generous donation to Shyam Jagat. Your seva makes a real difference.

DONATION RECEIPT
Receipt no: ${receiptNo}
Date: ${when(paidAt)}
Cause: ${cause}
Payment: Online via Razorpay${paymentRef ? ` (${paymentRef})` : ""}
Amount: ${rupees(amount)}

This is a computer-generated receipt and needs no signature. Questions? Write to ${supportEmail}.
Refund policy: ${siteUrl}/refund-policy

Jai Shri Shyam`,
    html: layout({
      preheader: `Thank you for your donation of ${rupees(amount)}`,
      title: "Thank you for your donation 🙏",
      bodyHtml: `
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Dear ${esc(donorName)}, thank you for your generous donation. Your seva makes a real difference.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="font-size:14px;border-top:2px solid #e87722;border-bottom:1px solid #ecd9b0;">
          ${row("Receipt no", receiptNo, true)}
          ${row("Date", when(paidAt))}
          ${row("Cause", cause)}
          ${row("Payment", paymentRef ? `Online via Razorpay (${paymentRef})` : "Online via Razorpay")}
          <tr><td style="color:#3e1815;border-top:1px solid #ecd9b0;"><b>Amount donated</b></td><td align="right" style="border-top:1px solid #ecd9b0;font-size:18px;"><b>${rupees(amount)}</b></td></tr>
        </table>
        <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#8a8580;text-align:center;">This is a computer-generated receipt and needs no signature.<br>Questions? Write to <a href="mailto:${esc(supportEmail)}" style="color:#e87722;">${esc(supportEmail)}</a>. <a href="${esc(siteUrl)}/refund-policy" style="color:#e87722;">Refund policy</a></p>`,
    }),
  };
}

/** Tells a member a refund has been started (or recorded, for a payment taken outside Razorpay). */
export function refundEmail({ fullName, amount, refundId, paid, balance, manual, siteUrl, supportEmail }) {
  const how = manual
    ? "The Shyam Jagat team has recorded this refund. The money is returned to you directly by the team, using the way you paid us."
    : "The money is going back to the same card, UPI or bank account you paid from. It usually reaches you within 5 to 7 working days, depending on your bank.";
  return {
    subject: `Your Shyam Jagat refund of ${rupees(amount)} has been started`,
    text: `Hi ${fullName},

A refund of ${rupees(amount)} has been started for your Shyam Jagat registration fee.
${how}
${refundId ? `Refund reference: ${refundId}\n` : ""}
Registration fee paid now: ${rupees(paid)}${balance > 0 ? `\nBalance still to pay: ${rupees(balance)}` : ""}

If you do not see the money after 10 working days, write to ${supportEmail} with the reference above.
Refund policy: ${siteUrl}/refund-policy

Jai Shri Shyam`,
    html: layout({
      preheader: `A refund of ${rupees(amount)} has been started`,
      title: "Your refund has been started",
      bodyHtml: `
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Hi ${esc(fullName)}, a refund of <b>${rupees(amount)}</b> has been started for your registration fee.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="font-size:14px;border-top:1px solid #ecd9b0;border-bottom:1px solid #ecd9b0;">
          <tr><td style="color:#8a8580;">Refund amount</td><td align="right"><b>${rupees(amount)}</b></td></tr>
          ${refundId ? `<tr><td style="color:#8a8580;">Reference</td><td align="right">${esc(refundId)}</td></tr>` : ""}
          <tr><td style="color:#8a8580;">Registration fee paid now</td><td align="right"><b>${rupees(paid)}</b></td></tr>
          ${balance > 0 ? `<tr><td style="color:#8a8580;">Balance still to pay</td><td align="right"><b style="color:#dc2626;">${rupees(balance)}</b></td></tr>` : ""}
        </table>
        <p style="margin:14px 0 0;padding:12px 14px;background:#fff8ec;border-left:4px solid #e87722;font-size:14px;line-height:1.5;">${esc(how)}</p>
        <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#8a8580;">If you do not see the money after 10 working days, write to <a href="mailto:${esc(supportEmail)}" style="color:#e87722;">${esc(supportEmail)}</a> with the reference above. You can read our <a href="${esc(siteUrl)}/refund-policy" style="color:#e87722;">refund policy</a> any time.</p>`,
    }),
  };
}

export function passwordResetEmail({ fullName, resetUrl, minutes }) {
  return {
    subject: "Reset your Shyam Jagat password",
    text: `Hi ${fullName},\n\nUse the link below to set a new password. It expires in ${minutes} minutes.\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    html: layout({
      preheader: "Reset your password",
      title: "Reset your password",
      bodyHtml: `
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${esc(fullName)}, use the button below to choose a new password. The link works once and expires in ${esc(minutes)} minutes.</p>
        <p style="margin:20px 0;text-align:center;"><a href="${esc(resetUrl)}" style="display:inline-block;background:#e87722;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px;">Reset password</a></p>
        <p style="margin:0;font-size:13px;color:#8a8580;">If you didn't request this, you can ignore this email.</p>`,
    }),
  };
}

/** Tells the owner of an account that its sign-in details just changed, so a change they did not make is noticed. */
export function securityNoticeEmail({ fullName, what, detail }) {
  return {
    subject: `Your Shyam Jagat ${what} was changed`,
    text: `Hi ${fullName},\n\nYour Shyam Jagat ${what} was just changed${detail ? ` (${detail})` : ""}.\n\nIf this was you, there is nothing to do. If it was not, contact the Shyam Jagat team straight away.\n\nJai Shri Shyam`,
    html: layout({
      preheader: `Your ${what} was changed`,
      title: `Your ${what} was changed`,
      bodyHtml: `
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#595656;text-align:center;">Hi ${esc(fullName)}, your Shyam Jagat ${esc(what)} was just changed${detail ? ` (${esc(detail)})` : ""}.</p>
        <p style="margin:0;padding:12px 14px;background:#fff7ea;border:1px solid #f0d9ad;border-radius:10px;font-size:13px;line-height:1.6;color:#6b4a1f;text-align:center;">If this was you, there is nothing to do. If it was not, contact the Shyam Jagat team straight away.</p>`,
    }),
  };
}
