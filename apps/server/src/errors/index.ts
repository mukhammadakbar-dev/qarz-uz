/**
 * Domen xatolari. `code` barqaror (log, metrika, bot/Mini App javobi uchun), `expose` esa
 * xatoni foydalanuvchiga ko'rsatish mumkinligini bildiradi. Kutilmagan xatolar (expose=false)
 * foydalanuvchiga hech qachon tafsilot bilan ko'rsatilmaydi (TT §37: log sanitization).
 */

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'OVERPAYMENT'
  | 'INTERNAL';

export interface DomainErrorOptions {
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  /** true: xabar va details foydalanuvchiga ko'rsatilishi mumkin. */
  readonly expose: boolean;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    httpStatus: number,
    message: string,
    options: DomainErrorOptions & { expose?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.expose = options.expose ?? true;
    this.details = options.details ?? {};
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super('VALIDATION', 400, message, options);
  }
}
export class UnauthorizedError extends DomainError {
  constructor(message = 'Autentifikatsiya talab qilinadi', options?: DomainErrorOptions) {
    super('UNAUTHORIZED', 401, message, options);
  }
}
export class ForbiddenError extends DomainError {
  constructor(message = 'Ruxsat yo‘q', options?: DomainErrorOptions) {
    super('FORBIDDEN', 403, message, options);
  }
}
export class NotFoundError extends DomainError {
  constructor(message = 'Topilmadi', options?: DomainErrorOptions) {
    super('NOT_FOUND', 404, message, options);
  }
}
export class ConflictError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super('CONFLICT', 409, message, options);
  }
}
export class RateLimitedError extends DomainError {
  constructor(message = 'So‘rovlar juda ko‘p', options?: DomainErrorOptions) {
    super('RATE_LIMITED', 429, message, options);
  }
}
export class SubscriptionExpiredError extends DomainError {
  constructor(options?: DomainErrorOptions) {
    super('SUBSCRIPTION_EXPIRED', 402, 'Obuna muddati tugagan', options);
  }
}
export class OverpaymentError extends DomainError {
  constructor(readonly maxPayable: number) {
    super('OVERPAYMENT', 422, 'To‘lov qarzdan ko‘p bo‘lishi mumkin emas', {
      details: { maxPayable },
    });
  }
}

export const isDomainError = (error: unknown): error is DomainError => error instanceof DomainError;

export interface PublicError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Tashqariga (HTTP javob, bot xabari) chiqariladigan xavfsiz ko'rinish. */
export function toPublicError(error: unknown): { status: number; body: PublicError } {
  if (isDomainError(error) && error.expose) {
    const hasDetails = Object.keys(error.details).length > 0;
    return {
      status: error.httpStatus,
      body: {
        code: error.code,
        message: error.message,
        ...(hasDetails ? { details: error.details } : {}),
      },
    };
  }
  return {
    status: 500,
    body: { code: 'INTERNAL', message: 'Ichki xatolik. Keyinroq urinib ko‘ring.' },
  };
}
