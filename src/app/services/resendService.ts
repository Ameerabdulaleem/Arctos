const RESEND_API_KEY = import.meta.env.VITE_RESEND_API_KEY
const FROM_EMAIL = import.meta.env.VITE_RESEND_FROM_EMAIL || 'arctos@resend.dev'
const FROM_NAME = import.meta.env.VITE_RESEND_FROM_NAME || 'ARCTOS Team'
const API_BASE = import.meta.env.VITE_API_BASE || ''

export interface EmailData {
  email: string
  name?: string
  position: number
}

class ResendService {
  async sendWelcomeEmail(data: EmailData): Promise<{ success: boolean; message?: string }> {
    // If a server proxy base is provided, prefer using that to keep API key secret
    if (API_BASE) {
      try {
        const res = await fetch(`${API_BASE.replace(/\/$/, '')}/api/resend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: data.email,
            name: data.name || 'Trader',
            position: data.position,
            subject: `🚀 You're Position #${data.position} on ARCTOS.fi Waitlist`,
            html: this.getWelcomeEmailHTML(data.name || 'Trader', data.position),
            text: this.getWelcomeEmailText(data.name || 'Trader', data.position)
          })
        })

        if (!res.ok) {
          const txt = await res.text().catch(() => '')
          console.error('❌ Server resend proxy error:', res.status, txt)
          return { success: false, message: `Server resend proxy error ${res.status}` }
        }

        return { success: true }
      } catch (err) {
        console.error('❌ Error calling server resend proxy:', err)
        // fall through to client-side attempt
      }
    }

    if (!RESEND_API_KEY) {
      console.error('Resend API key missing (VITE_RESEND_API_KEY)')
      return { success: false, message: 'Missing Resend API key' }
    }

    try {
      console.log('📧 ResendService: sending email to', data.email)
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [data.email],
          reply_to: 'arctosapp@gmail.com',
          subject: `🚀 You're Position #${data.position} on ARCTOS.fi Waitlist`,
          html: this.getWelcomeEmailHTML(data.name || 'Trader', data.position),
          text: this.getWelcomeEmailText(data.name || 'Trader', data.position),
          tags: [{ name: 'waitlist', value: 'welcome' }]
        })
      })

      console.log('📤 Resend API status:', response.status)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        console.error('❌ Resend API error body:', text)
        return { success: false, message: `Resend API error ${response.status}` }
      }

      const result = await response.json().catch(() => ({}))
      console.log('✅ Resend result:', result)
      return { success: true }
    } catch (err) {
      console.error('❌ Resend service error:', err)
      return { success: false, message: (err as any)?.message || 'Resend request failed' }
    }
  }

  private getWelcomeEmailHTML(name: string, position: number): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to ARCTOS.fi</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 0; background: #f9fafb; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 48px 24px; text-align: center; }
          .header h1 { color: white; font-size: 32px; font-weight: 700; margin: 0 0 8px 0; }
          .header p { color: rgba(255, 255, 255, 0.9); font-size: 18px; margin: 0; }
          .content { padding: 40px 32px; }
          .position-badge { background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: white; padding: 12px 24px; border-radius: 9999px; display: inline-block; font-weight: 700; font-size: 20px; margin: 16px 0; }
          .feature-grid { display: grid; grid-template-columns: 1fr; gap: 16px; margin: 32px 0; }
          .feature-card { background: #f8fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #3b82f6; }
          .feature-card h3 { color: #1e40af; margin: 0 0 8px 0; font-size: 16px; font-weight: 600; }
          .feature-card p { color: #4b5563; margin: 0; font-size: 14px; }
          .cta-button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 24px 0; transition: transform 0.2s; }
          .cta-button:hover { transform: translateY(-2px); }
          .footer { text-align: center; padding: 32px; background: #f1f5f9; color: #64748b; font-size: 14px; border-top: 1px solid #e2e8f0; }
          .footer a { color: #667eea; text-decoration: none; margin: 0 8px; }
          @media (max-width: 640px) { .content { padding: 24px 16px; } .header { padding: 32px 16px; } }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to ARCTOS.fi</h1>
            <p>AI-Powered DEX Trading Platform</p>
          </div>
          
          <div class="content">
            <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0;">Your Early Access is Confirmed</h2>
            
            <div class="position-badge">
              🚀 Position #${position}
            </div>
            
            <p style="color: #4b5563; margin: 16px 0;">Hi <strong>${name}</strong>, welcome aboard! You're now part of an exclusive group shaping the future of decentralized trading.</p>
            
            <h3 style="color: #1e40af; font-size: 18px; font-weight: 600; margin: 32px 0 16px 0;">🎯 What's Coming to ARCTOS.fi:</h3>
            
            <div class="feature-grid">
              <div class="feature-card">
                <h3>🤖 AI Trading Assistant</h3>
                <p>Intelligent trade suggestions powered by advanced algorithms</p>
              </div>
              <div class="feature-card">
                <h3>⚡ Multi-Chain Sniper Bot</h3>
                <p>Execute trades across Solana, Ethereum, BNB Chain & Base</p>
              </div>
              <div class="feature-card">
                <h3>🐋 Real-Time Whale Tracking</h3>
                <p>Monitor large wallet movements with instant alerts</p>
              </div>
              <div class="feature-card">
                <h3>📰 Fundamental News AI</h3>
                <p>AI-processed market news with impact ratings</p>
              </div>
            </div>
            
            <center>
              <a href="https://arctos-fi.vercel.app" class="cta-button">
                Visit ARCTOS.fi
              </a>
            </center>
            
            <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 32px 0;">
              <h4 style="color: #1e40af; margin: 0 0 12px 0; font-size: 16px; font-weight: 600;">📅 What Happens Next?</h4>
              <ul style="color: #334155; padding-left: 20px; margin: 0;">
                <li>Weekly development updates</li>
                <li>Beta access invitations (first 1,000 positions)</li>
                <li>Feature voting rights</li>
                <li>Exclusive community access</li>
              </ul>
            </div>
            
            <p style="font-size: 14px; color: #64748b; margin: 24px 0 0 0;">
              Stay updated: 
              <a href="https://twitter.com/arctos_app">Twitter</a> • 
              <a href="https://github.com/arctos-fi">GitHub</a> • 
              <a href="https://discord.gg/arctos">Discord</a>
            </p>
          </div>
          
          <div class="footer">
            <p>You're receiving this because you joined the ARCTOS.fi waitlist</p>
            <p style="margin: 8px 0;">
              <a href="https://arctos-fi.vercel.app/unsubscribe">Unsubscribe</a> • 
              <a href="mailto:support@arctos.fi">Contact Support</a>
            </p>
            <p style="font-size: 12px; color: #94a3b8; margin: 16px 0 0 0;">
              © 2024 ARCTOS Labs. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private getWelcomeEmailText(name: string, position: number): string {
    return `
WELCOME TO ARCTOS-FI
AI-Powered DEX Trading Platform

Hi ${name},

You're Position #${position} on the ARCTOS.fi waitlist!

Thank you for joining our community of forward-thinking traders. 
You've secured early access to our AI-powered trading platform.

🎯 WHAT'S COMING:

🤖 AI Trading Assistant
Intelligent trade suggestions powered by advanced algorithms

⚡ Multi-Chain Sniper Bot
Execute trades across Solana, Ethereum, BNB Chain & Base

🐋 Real-Time Whale Tracking
Monitor large wallet movements with instant alerts

📰 Fundamental News AI
AI-processed market news with impact ratings

📅 WHAT HAPPENS NEXT?
• Weekly development updates
• Beta access invitations (first 1,000 positions)
• Feature voting rights
• Exclusive community access

VISIT: https://arctos-fi.vercel.app

STAY UPDATED:
Twitter: https://twitter.com/arctos_app

You're receiving this because you joined the Arctos-fi waitlist.
Unsubscribe: https://arctos-fi.vercel.app/unsubscribe

© 2026 ARCTOS Labs. All rights reserved.
    `
  }

  // Optional: Send test email
  async sendTestEmail(to: string): Promise<boolean> {
    try {
      // reuse sendWelcomeEmail for a quick test (position=0)
      const res = await this.sendWelcomeEmail({ email: to, name: 'Test', position: 0 })
      return res.success
    } catch {
      return false
    }
  }
}

export const resendService = new ResendService()