// Using Brevo's official SMTP with nodemailer - NO multi-mailer!
import nodemailer from 'nodemailer';

export interface EmailData {
  email: string;
  name?: string;
  position: number;
}

class BrevoEmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    // Create transporter once
    this.initTransporter();
  }

  private initTransporter() {
  try {
    this.transporter = nodemailer.createTransport({
      host: import.meta.env.VITE_BREVO_HOST || 'smtp-relay.brevo.com',
      port: parseInt(import.meta.env.VITE_BREVO_PORT) || 587,
      secure: false, // true for 465, false for 587
      auth: {
        user: import.meta.env.VITE_BREVO_SMTP_LOGIN,  // ← This is the LOGIN (a2363f001@smtp-brevo.com)
        pass: import.meta.env.VITE_BREVO_SMTP_PASSWORD, // ← This is the PASSWORD
      },
      tls: {
        rejectUnauthorized: false, // Brevo uses self-signed certs
      },
    });
    console.log('✅ Brevo transporter initialized with SMTP login');
  } catch (error) {
    console.error('❌ Failed to initialize Brevo transporter:', error);
  }
}
  async sendWelcomeEmail(data: EmailData): Promise<{ success: boolean; message?: string }> {
    try {
      if (!this.transporter) {
        this.initTransporter();
      }

      if (!this.transporter) {
        throw new Error('Email service not initialized');
      }

      console.log('📧 Brevo: sending welcome email to', data.email);

      const mailOptions = {
        from: `"ARCTOS Team" <${import.meta.env.VITE_BREVO_FROM_EMAIL || 'arctosapp@gmail.com'}>`,
        to: data.email,
        subject: `🚀 You're Position #${data.position} on ARCTOS.fi Waitlist`,
        html: this.getWelcomeEmailHTML(data.name || 'Trader', data.position),
        text: this.getWelcomeEmailText(data.name || 'Trader', data.position),
        replyTo: 'arctosapp@gmail.com',
      };

      const info = await this.transporter.sendMail(mailOptions);
      
      console.log('✅ Brevo: Email sent successfully! Message ID:', info.messageId);
      return { success: true };
      
    } catch (err: any) {
      const errorMessage = err?.message || 'Unknown email send error';
      console.error('❌ Brevo email error:', errorMessage);
      return { success: false, message: errorMessage };
    }
  }

  private getWelcomeEmailHTML(name: string, position: number): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Welcome to ARCTOS.fi</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 20px; background: #f9fafb; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; }
          .header h1 { color: white; font-size: 28px; margin: 0 0 10px 0; }
          .content { padding: 30px; }
          .badge { background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: white; padding: 10px 20px; border-radius: 20px; display: inline-block; font-weight: bold; font-size: 18px; margin: 10px 0; }
          .feature { background: #f8fafc; padding: 15px; border-left: 4px solid #3b82f6; margin: 15px 0; border-radius: 4px; }
          .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; background: #f1f5f9; color: #64748b; font-size: 14px; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to ARCTOS.fi</h1>
            <p style="color: rgba(255,255,255,0.9);">AI-Powered DEX Trading Platform</p>
          </div>
          <div class="content">
            <h2>You're Position #${position}</h2>
            <div class="badge">🚀 EARLY ACCESS GRANTED</div>
            <p>Hi <strong>${name}</strong>,</p>
            <p>Welcome aboard! You've secured your spot among the first to experience AI-powered DEX trading.</p>
            <h3 style="color: #1e40af;">🎯 What's Coming:</h3>
            <div class="feature"><strong>🤖 AI Trading Assistant</strong><br>Intelligent trade suggestions</div>
            <div class="feature"><strong>⚡ Multi-Chain Sniper Bot</strong><br>Execute trades across 4 chains</div>
            <div class="feature"><strong>🐋 Real-Time Whale Tracking</strong><br>Monitor large wallet movements</div>
            <div class="feature"><strong>📰 Fundamental News AI</strong><br>AI-processed market news</div>
            <center>
              <a href="https://arctos-fi.vercel.app" class="button">Visit ARCTOS.fi</a>
            </center>
          </div>
          <div class="footer">
            <p>You're receiving this because you joined the ARCTOS.fi waitlist</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getWelcomeEmailText(name: string, position: number): string {
    return `
WELCOME TO ARCTOS.FI
AI-Powered DEX Trading Platform

Hi ${name},

You're Position #${position} on the ARCTOS.fi waitlist!

🎯 WHAT'S COMING:
• 🤖 AI Trading Assistant
• ⚡ Multi-Chain Sniper Bot
• 🐋 Real-Time Whale Tracking
• 📰 Fundamental News AI

VISIT: https://arctos-fi.vercel.app

© 2024 ARCTOS Labs
    `;
  }
}

export const brevoService = new BrevoEmailService();
export default brevoService;