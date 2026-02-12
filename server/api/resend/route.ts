// Serverless route handler for Resend (compatible with Next.js / Vercel route handlers)
import { Resend } from 'resend';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const RESEND_KEY = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
    const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || process.env.VITE_RESEND_FROM_EMAIL || 'arctos@resend.dev';
    const FROM_NAME = process.env.RESEND_FROM_NAME || process.env.VITE_RESEND_FROM_NAME || 'ARCTOS Team';

    if (!RESEND_KEY) {
      return new Response(JSON.stringify({ error: 'Missing server RESEND_API_KEY' }), { status: 500 });
    }

    const resend = new Resend(RESEND_KEY);

    const sendPayload: any = {
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [body.email],
      subject: body.subject || `🚀 You're Position #${body.position} on ARCTOS.fi Waitlist`,
      html: body.html || undefined,
      text: body.text || undefined,
    };

    const result = await resend.emails.send(sendPayload);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Unknown error' }), { status: 500 });
  }
}
