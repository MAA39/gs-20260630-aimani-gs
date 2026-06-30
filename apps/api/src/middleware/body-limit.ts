import { bodyLimit } from 'hono/body-limit';

export const BODY_LIMITS = {
  /** POST /api/v1/consultations, POST /api/v1/consultations/:id/messages */
  publicLarge: 10 * 1024,
  /** PATCH /api/v1/consultations/:id */
  publicSmall: 1024,
  /** POST /api/auth/** */
  auth: 10 * 1024,
  /** internal generating/repairing — ほぼ空 */
  internalSmall: 1024,
  /** internal complete — 最大5件×500文字 + usage + meta */
  internalComplete: 20 * 1024,
  /** internal fail — errorCode + message */
  internalFail: 2 * 1024,
} as const;

/** JSON 413 を返す bodyLimit middleware factory */
export const jsonBodyLimit = (maxSize: number) =>
  bodyLimit({
    maxSize,
    onError: (c) => c.json({ error: 'payload too large' }, 413),
  });
