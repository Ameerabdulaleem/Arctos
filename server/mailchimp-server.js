import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import mailchimp from '@mailchimp/mailchimp_marketing'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5200

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())

const { MAILCHIMP_API_KEY, MAILCHIMP_SERVER_PREFIX, MAILCHIMP_LIST_ID } = process.env

if (!MAILCHIMP_API_KEY || !MAILCHIMP_SERVER_PREFIX || !MAILCHIMP_LIST_ID) {
  console.warn('Mailchimp environment variables not fully configured. Please set MAILCHIMP_API_KEY, MAILCHIMP_SERVER_PREFIX, and MAILCHIMP_LIST_ID.')
}

mailchimp.setConfig({ apiKey: MAILCHIMP_API_KEY || '', server: MAILCHIMP_SERVER_PREFIX || '' })

app.post('/api/waitlist', async (req, res) => {
  const { email } = req.body

  if (!email) return res.status(400).json({ error: 'Missing email' })

  try {
    const response = await mailchimp.lists.addListMember(MAILCHIMP_LIST_ID, {
      email_address: email,
      status: 'subscribed'
    })

    return res.json({ ok: true, id: response.id })
  } catch (err) {
    // If member exists, Mailchimp returns a 400 with title 'Member Exists'
    const body = err?.response?.body || err
    if (body?.title && body.title.toLowerCase().includes('member')) {
      return res.json({ ok: true, message: 'Already subscribed' })
    }
    console.error('Mailchimp error', body)
    return res.status(500).json({ error: body })
  }
})

app.listen(PORT, () => {
  console.log(`Mailchimp proxy running on port ${PORT}`)
})
