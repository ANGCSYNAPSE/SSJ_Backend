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
<body style="margin:0;padding:0;background:#fdf6ec;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#3e1815;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fdf6ec;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #ecd9b0;">
        <tr><td style="background:#6b1f1f;padding:22px 28px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:#ffd66b;letter-spacing:1px;">श्याम जगत</div>
          <div style="font-size:12px;color:#f3dcc0;margin-top:2px;">सहयोग • सेवा • समर्पण</div>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 14px;font-size:20px;color:#6b1f1f;">${esc(title)}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="background:#fff8ec;padding:16px 28px;text-align:center;font-size:12px;color:#8a8580;">
          Jai Shri Shyam 🙏 &nbsp;·&nbsp; Shyam Jagat &nbsp;·&nbsp; This is an automated message, please do not reply.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** The 6-digit code that proves someone owns the email they signed up with. */
export function signupOtpEmail({ fullName, code, minutes }) {
  const spaced = String(code).split("").join(" ");
  return {
    subject: `${code} is your Shyam Jagat verification code`,
    text: `Hi ${fullName},\n\nYour Shyam Jagat verification code is ${code}.\nIt works for ${minutes} minutes. Enter it on the sign-up page to continue.\n\nIf you did not try to sign up, you can ignore this email. Never share this code with anyone.\n\nJai Shri Shyam`,
    html: layout({
      preheader: `Your verification code is ${code}`,
      title: "Verify your email",
      bodyHtml: `
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${esc(fullName)},<br>Use this code to verify your email and continue your registration:</p>
        <div style="margin:20px 0;padding:18px;text-align:center;background:#fff1d8;border:2px dashed #e87722;border-radius:12px;">
          <span style="font-size:34px;font-weight:800;letter-spacing:6px;color:#6b1f1f;">${esc(spaced)}</span>
        </div>
        <p style="margin:0 0 8px;font-size:14px;color:#595656;">The code works for <b>${esc(minutes)} minutes</b>.</p>
        <p style="margin:0;font-size:13px;color:#8a8580;">Never share this code with anyone. If you did not try to sign up, you can ignore this email.</p>`,
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
