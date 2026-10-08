import type { Request, Response } from 'express';
import { randomToken, safeEqual } from '@ordemcerta/server';
import { ErrorCode } from '@ordemcerta/shared';
import { DomainError } from '../../core/errors';
import type { AppEnv } from '../../core/env.provider';

export const REFRESH_COOKIE = 'oc_rt';
export const CSRF_COOKIE = 'oc_csrf';
const REFRESH_PATH = '/api/v1/auth';

/** Refresh token rotativo em cookie HttpOnly + token CSRF double-submit (não HttpOnly). */
export function setAuthCookies(res: Response, env: AppEnv, refreshToken: string): string {
  const csrf = randomToken(24);
  const maxAge = env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: REFRESH_PATH, maxAge });
  res.cookie(CSRF_COOKIE, csrf, { httpOnly: false, secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/', maxAge });
  return csrf;
}

export function clearAuthCookies(res: Response, env: AppEnv) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: REFRESH_PATH });
  res.clearCookie(CSRF_COOKIE, { secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/' });
}

/** Rotas baseadas em cookie: exige header X-CSRF-Token igual ao cookie e Origin permitido. */
export function assertCsrf(req: Request, env: AppEnv) {
  const header = req.headers['x-csrf-token'];
  const cookie = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
  if (typeof header !== 'string' || !cookie || !safeEqual(header, cookie)) {
    throw new DomainError(ErrorCode.CSRF_INVALID, 'Token CSRF inválido', 403);
  }
  const origin = req.headers.origin;
  if (origin) {
    const allowed = env.CORS_ORIGINS.split(',').map((s) => s.trim());
    if (!allowed.includes(origin) && origin !== env.APP_URL) throw new DomainError(ErrorCode.CSRF_INVALID, 'Origem não permitida', 403);
  }
}
