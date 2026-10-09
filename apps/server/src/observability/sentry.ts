import * as Sentry from '@sentry/node';
import type { Config } from '../config/index.js';
import { isDomainError } from '../errors/index.js';
import { getContext } from './context.js';

/** Sentry hodisasidan so'rov tanasi, header va foydalanuvchi ma'lumotlarini olib tashlaydi. */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  delete event.user;
  return event;
}

export function initSentry(config: Pick<Config, 'sentryDsn' | 'env'>): boolean {
  if (!config.sentryDsn) return false;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.env,
    // Maxfiy moliyaviy ma'lumot: hech narsa avtomatik yig'ilmaydi (TT §37).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
    },
    beforeSend: scrubEvent,
  });
  return true;
}

let unexpectedErrorListener: ((error: unknown) => void) | undefined;

/** Kutilmagan xatolarni kuzatish (operator ogohlantirishlari, T6.3). Qaytgan funksiya obunani bekor qiladi. */
export function onUnexpectedError(listener: (error: unknown) => void): () => void {
  unexpectedErrorListener = listener;
  return () => {
    if (unexpectedErrorListener === listener) unexpectedErrorListener = undefined;
  };
}

/** Faqat kutilmagan xatolar yuboriladi; kutilgan domen xatolari (validatsiya, ruxsat) yuborilmaydi. */
export function reportError(error: unknown): void {
  if (isDomainError(error) && error.expose) return;
  try {
    unexpectedErrorListener?.(error);
  } catch {
    /* kuzatuvchi xatosi asosiy oqimni buzmasin */
  }
  const ctx = getContext();
  Sentry.captureException(error, {
    tags: {
      ...(ctx?.businessId ? { businessId: ctx.businessId } : {}),
      ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    },
  });
}
