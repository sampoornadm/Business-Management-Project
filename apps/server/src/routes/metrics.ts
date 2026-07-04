import type { NextFunction, Request, RequestHandler, Response } from "express";
import { collectDefaultMetrics, Histogram, Registry } from "prom-client";

import { isTest } from "../config/env.js";

export const metricsRegistry = new Registry();

if (!isTest) {
  collectDefaultMetrics({ register: metricsRegistry });
}

const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const stopTimer = httpRequestDurationSeconds.startTimer();
  res.on("finish", () => {
    stopTimer({
      method: req.method,
      route: req.route ? (req.baseUrl + req.route.path) : req.path,
      status_code: String(res.statusCode),
    });
  });
  next();
}

export const metricsRouter: RequestHandler = async (_req, res) => {
  res.setHeader("Content-Type", metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
};
