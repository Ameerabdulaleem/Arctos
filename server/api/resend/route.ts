// Serverless route handler for Resend (compatible with Next.js / Vercel route handlers)
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const RESEND_KEY = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
    const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || process.env.VITE_RESEND_FROM_EMAIL || 'arctos@resend.dev';
    const FROM_NAME = process.env.RESEND_FROM_NAME || process.env.VITE_RESEND_FROM_NAME || 'ARCTOS Team';

    if (!RESEND_KEY) {
      return new Response(JSON.stringify({ error: 'Missing server RESEND_API_KEY' }), { status: 500 });
    }

    const payload: any = {
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [body.email],
      subject: body.subject || `🚀 You're Position #${body.position} on Arctos-fi Waitlist`,
      html: body.html || null,
      text: body.text || null,
      tags: body.tags || []
    };

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const text = await resp.text().catch(() => '');
    const contentType = resp.headers.get('content-type') || 'text/plain';
    return new Response(text, { status: resp.status, headers: { 'Content-Type': contentType } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Unknown error' }), { status: 500 });
  }
}
