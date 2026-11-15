import * as Sentry from "@sentry/node";

import { logger } from "./logger.js";

function scrubSensitiveData(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request === undefined) {
    return event;
  }

  delete event.request.data;
  delete event.request.cookies;

  if (event.request.headers !== undefined) {
    for (const header of Object.keys(event.request.headers)) {
      if (header.toLowerCase() === "authorization") {
        delete event.request.headers[header];
      }
    }
  }

  return event;
}

export function initSentry(options: Partial<Sentry.NodeOptions> = {}): boolean {
  const { dsn } = options;

  if (dsn === undefined || dsn.trim() === "") {
    logger.info("error tracking is off");
    return false;
  }

  Sentry.init({
    ...options,
    dsn,
    // Sentry v11 replaced sendDefaultPii with dataCollection; turning off
    // userInfo keeps personal data out of events.
    dataCollection: { userInfo: false },
    beforeSend: scrubSensitiveData,
  });

  return true;
}

export { scrubSensitiveData };
