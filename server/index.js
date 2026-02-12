/* Local Express fallback proxy for Resend
   Use this for local development. In production, deploy the route handler under your host (Vercel/Netlify/etc.)
   Make sure to set RESEND_API_KEY, RESEND_FROM_EMAIL and RESEND_FROM_NAME in your environment.
*/
const path = require('path');
const fs = require('fs');
// Load .env from server folder first, then fallback to repo root .env if present
require('dotenv').config();
const rootEnv = path.resolve(__dirname, '..', '.env');
if (!process.env.RESEND_API_KEY && fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv });
  console.log('Loaded environment from repo root .env');
}
const express = require('express');
const { Resend } = require('resend');
const app = express();
app.use(express.json());

app.post('/api/resend', async (req, res) => {
  const key = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.VITE_RESEND_FROM_EMAIL || 'arctos@resend.dev';
  const fromName = process.env.RESEND_FROM_NAME || process.env.VITE_RESEND_FROM_NAME || 'ARCTOS Team';

  if (!key) return res.status(500).json({ error: 'Missing RESEND_API_KEY in server environment' });

  const body = req.body || {};

  // Use Resend SDK to send the email (server-side)
  try {
    const resend = new Resend(key);
    const sendPayload = {
      from: `${fromName} <${fromEmail}>`,
      to: [body.email],
      subject: body.subject || `🚀 You're Position #${body.position} on Arctos-fi Waitlist`,
      html: body.html || undefined,
      text: body.text || undefined,
      // SDK may ignore unknown fields; tag support differs by SDK version
    };

    const result = await resend.emails.send(sendPayload);
    // result contains the API response: return it to caller for debugging
    res.status(200).json(result);
  } catch (err) {
    console.error('Server resend proxy error (SDK)', err);
    res.status(500).json({ error: err?.message || 'Server proxy error' });
  }
});

// Basic info endpoint so visiting `/` in a browser doesn't return 404
app.get('/', (req, res) => {
  res.type('text').send('Resend proxy running. Use POST /api/resend to send emails or GET /send-test?email=you@example.com to send a quick test.');
});

// Browser-friendly test endpoint: GET /send-test?email=you@example.com
// Useful for quickly verifying the server-side Resend integration from a browser.
app.get('/send-test', async (req, res) => {
  const to = req.query.email || 'delivered@resend.dev';
  const key = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.VITE_RESEND_FROM_EMAIL || 'arctos@resend.dev';
  const fromName = process.env.RESEND_FROM_NAME || process.env.VITE_RESEND_FROM_NAME || 'ARCTOS Team';

  if (!key) return res.status(500).json({ error: 'Missing RESEND_API_KEY in server environment' });

  try {
    const resend = new Resend(key);
    const result = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [String(to)],
      subject: 'Test email from Resend proxy',
      html: '<strong>If you see this, Resend integration works!</strong>'
    });
    res.status(200).json(result);
  } catch (err) {
    console.error('Send-test error', err);
    res.status(500).json({ error: err?.message || 'Send test failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Resend proxy running on http://localhost:${PORT}`));
