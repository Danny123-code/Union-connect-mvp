// Minimal transactional email sender using Resend's HTTP API.
// Zero new dependencies -- Node 18+ has a global fetch(), which is all
// Resend's API needs. If RESEND_API_KEY isn't set, sends are logged to
// the console instead of failing, so the rest of the app works fine
// without an email account configured yet.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.EMAIL_FROM || 'Union Connect <onboarding@resend.dev>';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'daniellob890@gmail.com';

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.log(`[email not sent - RESEND_API_KEY not set] To: ${to} | Subject: ${subject}`);
    return { skipped: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Resend send failed:', res.status, text);
      return { error: true, status: res.status };
    }
    return await res.json();
  } catch (e) {
    console.error('Resend send threw:', e.message);
    return { error: true, message: e.message };
  }
}

function wrapper(bodyHtml) {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; color: #1A1A1A;">
    <div style="font-size: 13px; font-weight: 900; letter-spacing: 2px; margin-bottom: 24px;">UNION CONNECT</div>
    ${bodyHtml}
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;">
    <div style="font-size: 12px; color: #9A9A9A;">Questions? Reach us at <a href="mailto:${SUPPORT_EMAIL}" style="color: #534AB7;">${SUPPORT_EMAIL}</a></div>
  </div>`;
}

function welcomeEmail({ name, companyName }) {
  return wrapper(`
    <h2 style="font-size: 18px; margin: 0 0 16px;">Welcome, ${escapeHtml(name)} 👋</h2>
    <p style="font-size: 14px; line-height: 1.6;">Your workspace for <strong>${escapeHtml(companyName)}</strong> is ready. You're the admin, so you can approve operations and invite teammates whenever you're ready.</p>
    <p style="font-size: 14px; line-height: 1.6;">Log back in any time to pick up where you left off.</p>
  `);
}

function resetEmail({ name, resetUrl }) {
  return wrapper(`
    <h2 style="font-size: 18px; margin: 0 0 16px;">Reset your password</h2>
    <p style="font-size: 14px; line-height: 1.6;">Hi ${escapeHtml(name)}, we got a request to reset your Union Connect password. This link expires in 1 hour.</p>
    <p style="margin: 24px 0;"><a href="${resetUrl}" style="background: #1A1A1A; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">Reset password</a></p>
    <p style="font-size: 12px; color: #6B6B6B;">If you didn't request this, you can ignore this email.</p>
  `);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { sendEmail, welcomeEmail, resetEmail, SUPPORT_EMAIL };
