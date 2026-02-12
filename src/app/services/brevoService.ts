import { EmailService } from 'multi-mailer';

export interface EmailData {
  email: string;
  name?: string;
  position: number;
}

class BrevoEmailService {
  private emailService: EmailService | null = null;

  constructor() {
    // Initialize EmailService with recipient email
    // This will be set per request in sendWelcomeEmail
  }

  async sendWelcomeEmail(data: EmailData): Promise<{ success: boolean; message?: string }> {
    try {
      // Initialize EmailService with recipient email
      this.emailService = new EmailService(data.email);

      // Define template parameters
      const params = {
        name: data.name || 'Trader',
        position: data.position.toString(),
      };

      console.log('📧 BrevoService: sending welcome email to', data.email);

      // Send email using template
      await this.emailService.sendEmail(
        'welcome.html',
        `🚀 You're Position #${data.position} on ARCTOS.fi Waitlist`,
        params
      );

      console.log('✅ Welcome email sent successfully to', data.email);
      return { success: true };
    } catch (err) {
      const errorMessage = (err as any)?.message || 'Unknown email send error';
      console.error('❌ BrevoService error:', errorMessage);
      return { success: false, message: errorMessage };
    }
  }
}

export const brevoService = new BrevoEmailService();
export default brevoService;
