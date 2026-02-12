/* Local Express fallback proxy for Resend
   Use this for local development. In production, deploy the route handler under your host (Vercel/Netlify/etc.)
   Make sure to set RESEND_API_KEY, RESEND_FROM_EMAIL and RESEND_FROM_NAME in your environment.
*/
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

app.post('/api/resend', async (req, res) => {
  const key = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.VITE_RESEND_FROM_EMAIL || 'arctos@resend.dev';
  const fromName = process.env.RESEND_FROM_NAME || process.env.VITE_RESEND_FROM_NAME || 'ARCTOS Team';

  if (!key) return res.status(500).json({ error: 'Missing RESEND_API_KEY in server environment' });

  const body = req.body || {};
  const payload = {
    from: `${fromName} <${fromEmail}>`,
    to: [body.email],
    subject: body.subject || `🚀 You're Position #${body.position} on Arctos-fi Waitlist`,
    html: body.html || null,
    text: body.text || null,
    tags: body.tags || []
  };

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text().catch(() => '');
    res.status(r.status).send(text);
  } catch (err) {
    console.error('Server resend proxy error', err);
    res.status(500).json({ error: err?.message || 'Server proxy error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Resend proxy running on http://localhost:${PORT}`));
