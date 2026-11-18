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
