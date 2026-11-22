import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import {
  getErrorMessage,
  HttpError,
  isMalformedJson,
  isPayloadTooLarge,
} from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    for (const [name, value] of Object.entries(error.headers)) {
      res.setHeader(name, value);
    }
    res.status(error.status).json({ error: error.message });
    return;
  }

  if (
    error instanceof ZodError ||
    isPayloadTooLarge(error) ||
    isMalformedJson(error)
  ) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  logger.error("unhandled request error", {
    method: req.method,
    path: req.path,
    error: getErrorMessage(error),
  });

  res.status(500).json({ status: "error" });
}
