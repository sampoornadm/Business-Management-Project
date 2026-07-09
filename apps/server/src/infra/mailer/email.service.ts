import { env } from "../../config/env.js";
import { emailQueue } from "../queue/queues.js";

export class EmailService {
  async queueInviteEmail(params: { to: string; firstName: string; setPasswordToken: string }): Promise<void> {
    await emailQueue.add("send-email", {
      type: "invite",
      to: params.to,
      firstName: params.firstName,
      setPasswordUrl: `${env.WEB_APP_URL}/reset-password?token=${params.setPasswordToken}`,
    });
  }

  async queueVerificationEmail(params: {
    to: string;
    firstName: string;
    verificationToken: string;
  }): Promise<void> {
    await emailQueue.add("send-email", {
      type: "verification",
      to: params.to,
      firstName: params.firstName,
      verifyUrl: `${env.WEB_APP_URL}/verify-email?token=${params.verificationToken}`,
    });
  }

  async queuePasswordResetEmail(params: {
    to: string;
    firstName: string;
    resetToken: string;
  }): Promise<void> {
    await emailQueue.add("send-email", {
      type: "password-reset",
      to: params.to,
      firstName: params.firstName,
      resetUrl: `${env.WEB_APP_URL}/reset-password?token=${params.resetToken}`,
    });
  }

  async queueTenderAssignedEmail(params: {
    to: string;
    firstName: string;
    tenderId: string;
    tenderNumber: string;
    tenderTitle: string;
  }): Promise<void> {
    await emailQueue.add("send-email", {
      type: "tender-assigned",
      to: params.to,
      firstName: params.firstName,
      tenderNumber: params.tenderNumber,
      tenderTitle: params.tenderTitle,
      tenderUrl: `${env.WEB_APP_URL}/tenders/${params.tenderId}`,
    });
  }

  async queueRfqEmail(params: { to: string; rfqTitle: string; bodyText: string }): Promise<void> {
    await emailQueue.add("send-email", {
      type: "rfq",
      to: params.to,
      rfqTitle: params.rfqTitle,
      bodyText: params.bodyText,
    });
  }

  async queueTenderDeadlineReminderEmail(params: {
    to: string;
    firstName: string;
    tenderId: string;
    tenderNumber: string;
    tenderTitle: string;
    daysRemaining: number;
  }): Promise<void> {
    await emailQueue.add("send-email", {
      type: "tender-deadline-reminder",
      to: params.to,
      firstName: params.firstName,
      tenderNumber: params.tenderNumber,
      tenderTitle: params.tenderTitle,
      daysRemaining: params.daysRemaining,
      tenderUrl: `${env.WEB_APP_URL}/tenders/${params.tenderId}`,
    });
  }
}
