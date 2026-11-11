import { rateLimit } from 'express-rate-limit';

const limitedResponse = {
  error: 'Too many requests. Please try again later.',
};

export function createRateLimit({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json(limitedResponse),
  });
}

function applicationRateLimit(options) {
  const limiter = createRateLimit(options);
  if (process.env.NODE_ENV === 'test') {
    return (_req, _res, next) => next();
  }
  return limiter;
}

export const publicApiRateLimit = applicationRateLimit({
  windowMs: 60_000,
  limit: 120,
});

export const adminApiRateLimit = applicationRateLimit({
  windowMs: 60_000,
  limit: 30,
});

export const uploadRateLimit = applicationRateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
});

export const syncRateLimit = applicationRateLimit({
  windowMs: 5 * 60_000,
  limit: 1,
});
