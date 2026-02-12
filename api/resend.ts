import nodemailer from 'nodemailer';

// Vercel serverless function handler for Brevo SMTP
export default async function handler(req: any, res: any) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const { email, position, subject, html, text } = body;

    // Get Brevo SMTP credentials from environment
    const MAIL_HOST = process.env.MAIL_HOST || 'smtp-relay.brevo.com';
    const MAIL_PORT = parseInt(process.env.MAIL_PORT || '587');
    const MAIL_USERNAME = process.env.MAIL_USERNAME;
    const MAIL_PASSWORD = process.env.MAIL_PASSWORD;
    const MAIL_FROM = process.env.MAIL_FROM || 'noreply@arctos-fi.vercel.app';

    if (!MAIL_USERNAME || !MAIL_PASSWORD) {
      console.error('Missing Brevo SMTP credentials');
      return res.status(500).json({ error: 'Missing SMTP configuration' });
    }

    // Create Nodemailer transporter with Brevo SMTP
    const transporter = nodemailer.createTransport({
      host: MAIL_HOST,
      port: MAIL_PORT,
      secure: false, // Use TLS (not SSL)
      auth: {
        user: MAIL_USERNAME,
        pass: MAIL_PASSWORD,
      },
    });

    // Send email
    const info = await transporter.sendMail({
      from: MAIL_FROM,
      to: email,
      subject: subject || `🚀 You're Position #${position} on ARCTOS.fi Waitlist`,
      html: html || '',
      text: text || '',
      replyTo: 'arctosapp@gmail.com',
    });

    console.log('✅ Email sent via Brevo:', info.messageId);
    return res.status(200).json({
      success: true,
      data: { id: info.messageId },
      error: null,
    });
  } catch (err) {
    const errorMessage = (err as any)?.message || 'Unknown error';
    console.error('❌ Brevo SMTP error:', errorMessage);
    return res.status(500).json({ error: errorMessage });
  }
}
