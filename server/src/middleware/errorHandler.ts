import type { NextFunction, Request, Response } from "express";

import { getErrorMessage } from "../lib/errors.js";
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

  logger.error("unhandled request error", {
    method: req.method,
    path: req.path,
    error: getErrorMessage(error),
  });

  res.status(500).json({ status: "error" });
}
