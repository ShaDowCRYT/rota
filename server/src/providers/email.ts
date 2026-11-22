import { logger } from "../lib/logger.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export function createDevEmailSender(environment: string): EmailSender {
  return {
    async send(message) {
      if (environment === "development" || environment === "test") {
        logger.info("password reset link", { text: message.text });
        return;
      }

      logger.warn("no email provider configured");
    },
  };
}
