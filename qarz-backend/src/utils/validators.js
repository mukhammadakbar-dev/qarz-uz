import { z } from 'zod';

/**
 * Shared zod primitives for values that reach typed Postgres columns.
 *
 * Anything that isn't a real calendar date or a well-formed UUID raises a
 * driver-level data-type error deep inside a query — a 500 the caller cannot
 * act on — so the shape is checked at the edge instead.
 */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD ko\'rinishida bo\'lishi kerak')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Bunday sana mavjud emas');

export const uuid = z.string().uuid();

/** NUMERIC(14,2) overflows past 10^12; reject that as input, not as a 500. */
export const money = z.number().positive().finite().max(1e12);
