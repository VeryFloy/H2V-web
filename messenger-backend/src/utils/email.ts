import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY must be set in .env');
    _resend = new Resend(apiKey);
  }
  return _resend;
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const resend = getResend();
  const fromEmail = process.env.SMTP_USER || 'donotreply@h2von.com';

  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:'Courier New',Courier,monospace;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:60px 20px;background:#ffffff;">
    <tr><td align="center">
      <table width="420" cellpadding="0" cellspacing="0" style="border:1px solid #000000;">
        <tr><td style="padding:24px 32px;border-bottom:2px solid #000000;">
          <span style="font-size:13px;font-weight:700;color:#000000;letter-spacing:4px;text-transform:uppercase;">H2V</span>
        </td></tr>
        <tr><td style="padding:40px 32px;">
          <p style="margin:0 0 8px 0;font-size:11px;color:#666666;letter-spacing:2px;text-transform:uppercase;">Код подтверждения</p>
          <p style="margin:0 0 32px 0;font-size:56px;font-weight:700;color:#000000;letter-spacing:12px;">${code}</p>
          <p style="margin:0;font-size:12px;color:#666666;line-height:1.6;">Код действителен <strong style="color:#000">10 минут</strong>.<br/>Никому не сообщайте этот код.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e0e0e0;">
          <span style="font-size:11px;color:#999999;">© 2026 H2V · support@h2von.com</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const { error } = await resend.emails.send({
    from: `H2V <${fromEmail}>`,
    to,
    subject: `${code} — код входа в H2V`,
    html,
    text: `Твой код: ${code}\n\nКод действителен 10 минут.`,
  });

  if (error) throw new Error(error.message);
}