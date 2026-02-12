import { Resend } from 'resend';

interface EmailPayload {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
}

// Vercel serverless function handler
export default async function handler(req: any, res: any) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    const RESEND_KEY = process.env.RESEND_API_KEY;
    const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'arctos@resend.dev';
    const FROM_NAME = process.env.RESEND_FROM_NAME || 'ARCTOS Team';

    if (!RESEND_KEY) {
      return res.status(500).json({ error: 'Missing server RESEND_API_KEY' });
    }

    const resend = new Resend(RESEND_KEY);

    const sendPayload: EmailPayload = {
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [body.email],
      subject: body.subject || `🚀 You're Position #${body.position} on ARCTOS.fi Waitlist`,
      html: body.html || undefined,
      text: body.text || undefined,
    };

    const result = await resend.emails.send(sendPayload as any);
    return res.status(200).json(result);
  } catch (err) {
    const errorMessage = (err as any)?.message || 'Unknown error';
    console.error('Resend error:', errorMessage);
    return res.status(500).json({ error: errorMessage });
  }
}
