export interface EmailContent {
  subject: string;
  html: string;
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, Arial, sans-serif; background:#f4f4f5; padding:32px;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
      <h1 style="font-size:18px;color:#111827;margin-top:0;">${title}</h1>
      ${bodyHtml}
      <p style="color:#9ca3af;font-size:12px;margin-top:32px;">Business Management Platform</p>
    </div>
  </body>
</html>`;
}

export function buildInviteEmail(params: {
  firstName: string;
  setPasswordUrl: string;
}): EmailContent {
  return {
    subject: "You've been invited to the Business Management Platform",
    html: layout(
      `Welcome, ${params.firstName}`,
      `<p>An administrator created an account for you on the Business Management Platform.</p>
       <p>Click the link below to set your password and activate your account:</p>
       <p><a href="${params.setPasswordUrl}">${params.setPasswordUrl}</a></p>`,
    ),
  };
}

export function buildVerificationEmail(params: {
  firstName: string;
  verifyUrl: string;
}): EmailContent {
  return {
    subject: "Verify your email address",
    html: layout(
      `Hi ${params.firstName}, please verify your email`,
      `<p>Click the link below to verify your email address:</p>
       <p><a href="${params.verifyUrl}">${params.verifyUrl}</a></p>
       <p>This link expires in 48 hours.</p>`,
    ),
  };
}

export function buildPasswordResetEmail(params: {
  firstName: string;
  resetUrl: string;
}): EmailContent {
  return {
    subject: "Reset your password",
    html: layout(
      `Hi ${params.firstName}, reset your password`,
      `<p>We received a request to reset your password. Click the link below to choose a new one:</p>
       <p><a href="${params.resetUrl}">${params.resetUrl}</a></p>
       <p>If you didn't request this, you can safely ignore this email. This link expires in 1 hour.</p>`,
    ),
  };
}

export function buildTenderAssignedEmail(params: {
  firstName: string;
  tenderNumber: string;
  tenderTitle: string;
  tenderUrl: string;
}): EmailContent {
  return {
    subject: `You've been assigned to tender ${params.tenderNumber}`,
    html: layout(
      `Hi ${params.firstName}, you've been assigned a tender`,
      `<p><strong>${params.tenderNumber}</strong> &mdash; ${params.tenderTitle}</p>
       <p><a href="${params.tenderUrl}">${params.tenderUrl}</a></p>`,
    ),
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildRfqEmail(params: { rfqTitle: string; bodyText: string }): EmailContent {
  const escapedBody = escapeHtml(params.bodyText).replace(/\n/g, "<br>");
  return {
    subject: `RFQ: ${params.rfqTitle}`,
    html: layout(params.rfqTitle, `<div style="white-space:pre-wrap;">${escapedBody}</div>`),
  };
}

export function buildTenderDeadlineReminderEmail(params: {
  firstName: string;
  tenderNumber: string;
  tenderTitle: string;
  daysRemaining: number;
  tenderUrl: string;
}): EmailContent {
  const dayLabel = params.daysRemaining === 1 ? "1 day" : `${params.daysRemaining} days`;
  return {
    subject: `Submission deadline in ${dayLabel}: ${params.tenderNumber}`,
    html: layout(
      `Hi ${params.firstName}, a submission deadline is approaching`,
      `<p><strong>${params.tenderNumber}</strong> &mdash; ${params.tenderTitle}</p>
       <p>The submission deadline is in <strong>${dayLabel}</strong>.</p>
       <p><a href="${params.tenderUrl}">${params.tenderUrl}</a></p>`,
    ),
  };
}
