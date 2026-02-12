import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    email,
    name,
    position,
    subject,
    html,
    text
  } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  const host = process.env.BREVO_HOST || process.env.BREVO_SMTP_HOST || process.env.VITE_BREVO_HOST || 'smtp-relay.brevo.com';
  const port = Number(process.env.BREVO_PORT || process.env.BREVO_SMTP_PORT || process.env.VITE_BREVO_PORT || 587);
  const user = process.env.BREVO_SMTP_LOGIN || process.env.BREVO_SMTP_USER || process.env.VITE_BREVO_SMTP_LOGIN;
  const pass = process.env.BREVO_SMTP_PASSWORD || process.env.BREVO_SMTP_PASS || process.env.VITE_BREVO_SMTP_PASSWORD;
  const fromEmail = process.env.BREVO_FROM_EMAIL || process.env.VITE_BREVO_FROM_EMAIL || 'arctosapp@gmail.com';
  const fromName = process.env.BREVO_FROM_NAME || process.env.VITE_BREVO_FROM_NAME || 'ARCTOS Team';
  const replyTo = process.env.BREVO_REPLY_TO || process.env.VITE_BREVO_REPLY_TO || fromEmail;

  if (!user || !pass) {
    return res.status(500).json({ error: 'Missing Brevo SMTP credentials' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false
      }
    });

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: subject || `Welcome to ARCTOS.fi${position ? ` (#${position})` : ''}`,
      html: html || undefined,
      text: text || undefined,
      replyTo
    };

    const info = await transporter.sendMail(mailOptions);
    return res.status(200).json({ messageId: info.messageId });
  } catch (error) {
    const message = error?.message || 'Brevo send failed';
    return res.status(500).json({ error: message });
  }
}
