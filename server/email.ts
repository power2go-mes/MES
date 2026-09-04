import fs from 'fs';
import path from 'path';

const DEV_OTP_LOG = path.join(process.cwd(), 'memory', 'otp-dev.log');

export interface SendOtpResult {
  delivered: boolean;
  channel: 'resend' | 'dev';
}

/**
 * Delivers the OTP to the user's email.
 *
 * Production: if RESEND_API_KEY is set, the email is sent via Resend. The OTP is
 *   NOT logged in that case.
 * Development / sandbox: with no RESEND_API_KEY, the OTP is written ONLY to a
 *   server-side log file (memory/otp-dev.log) and the server console. It is never
 *   returned in any API response and never reaches the browser.
 */
export async function sendOtpEmail(opts: { to: string; username: string; otp: string }): Promise<SendOtpResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const appUrl = process.env.APP_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

  if (apiKey) {
    try {
      // Dynamic, non-literal specifier so tsc does not try to resolve the module.
      const spec = 'resend';
      const resendMod: any = await import(spec);
      const Resend = resendMod.Resend;
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: process.env.RESEND_FROM || 'Power2Go MES <noreply@power2go.com>',
        to: [opts.to],
        subject: 'Your Power2Go MES Verification Code',
        text:
          `Hello ${opts.username},\n\n` +
          `Your Power2Go MES one-time verification code is: ${opts.otp}\n\n` +
          `This code expires in 5 minutes. If you did not request this, you can safely ignore this email.\n\n` +
          `${appUrl}`,
        html:
          `<div style="font-family:sans-serif;max-width:420px;margin:auto">` +
          `<h2>Power2Go MES</h2>` +
          `<p>Hello <strong>${opts.username}</strong>,</p>` +
          `<p>Your one-time verification code is:</p>` +
          `<p style="font-size:32px;letter-spacing:8px;font-weight:700">${opts.otp}</p>` +
          `<p>This code expires in 5 minutes.</p>` +
          `</div>`,
      });
      return { delivered: true, channel: 'resend' };
    } catch (err) {
      console.error('[email] Resend delivery failed, falling back to dev log', err);
    }
  }

  // Dev fallback (server-side only).
  if (process.env.VERCEL) {
    console.log(`[OTP] delivery skipped on Vercel without RESEND_API_KEY for ${opts.username}`);
    return { delivered: false, channel: 'dev' };
  }

  const line = `${new Date().toISOString()} OTP ${opts.otp} for ${opts.username} <${opts.to}>\n`;
  try {
    fs.mkdirSync(path.dirname(DEV_OTP_LOG), { recursive: true });
    fs.appendFileSync(DEV_OTP_LOG, line);
  } catch {
    /* ignore */
  }
  console.log(`[DEV OTP] ${opts.username} (${opts.to}) => ${opts.otp}`);
  return { delivered: true, channel: 'dev' };
}
