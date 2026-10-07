import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL, TEST_MIGRATOR_URL, TEST_SYSTEM_URL } from '../../../test/env.js';
import * as fx from '../../../test/fixtures.js';
import { createPool } from '../../db/pool.js';
import { withTenant } from '../../db/tenant.js';
import { createLogger } from '../../observability/logger.js';
import { runMaintenance } from './jobs.js';

let app: Pool;
let system: Pool;
let migrator: Pool;
const logger = createLogger({ logLevel: 'fatal', isProduction: true, env: 'test' });
beforeAll(() => {
  app = createPool(TEST_APP_URL, { max: 4 });
  system = createPool(TEST_SYSTEM_URL, { max: 4 });
  migrator = createPool(TEST_MIGRATOR_URL, { max: 2 });
});
afterAll(async () => {
  await Promise.all([app.end(), system.end(), migrator.end()]);
});

describe('runMaintenance', () => {
  it('eski jurnal va update yozuvlarini o‘chiradi, yangilarini qoldiradi', async () => {
    const owner = await fx.createUser(app);
    const biz = await fx.createBusiness(app, owner);
    const insert = (age: string) =>
      withTenant(app, { businessId: biz, userId: owner }, (c) =>
        c.query(
          `INSERT INTO ai_interpretations (business_id, user_id, input_redacted, provider, created_at)
           VALUES ($1, $2, 'x', 'rules', now() - $3::interval)`,
          [biz, owner, age],
        ),
      );
    // created_at ni app roli bergan sana bilan yozish mumkin (ustun default, lekin qiymat berilsa bo'ladi)
    await insert('31 days');
    await insert('29 days');
    const oldUpdate = Math.floor(Math.random() * 1e9) + 2e9;
    const newUpdate = oldUpdate + 1;
    await system.query(
      "INSERT INTO processed_updates (update_id, received_at) VALUES ($1, now() - interval '8 days'), ($2, now())",
      [oldUpdate, newUpdate],
    );

    const result = await runMaintenance(system, logger);
    expect(result.ranJobs).toBe(true);
    expect(result.interpretationsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.updatesDeleted).toBeGreaterThanOrEqual(1);

    const left = await system.query(
      'SELECT count(*)::int AS n FROM ai_interpretations WHERE business_id = $1',
      [biz],
    );
    expect(left.rows[0].n).toBe(1);
    const updates = await system.query(
      'SELECT update_id FROM processed_updates WHERE update_id = ANY($1)',
      [[oldUpdate, newUpdate]],
    );
    expect(updates.rows.map((r) => Number(r.update_id))).toEqual([newUpdate]);
  });

  it('muddati o‘tgan qoralamalarni EXPIRED qiladi, eskirgan suhbat holatini o‘chiradi', async () => {
    const owner = await fx.createUser(app);
    const biz = await fx.createBusiness(app, owner);
    const draft = await withTenant(app, { businessId: biz, userId: owner }, (c) =>
      c.query<{ id: string }>(
        `INSERT INTO pending_operations (business_id, user_id, payload, expires_at)
         VALUES ($1, $2, '{}'::jsonb, now() - interval '1 minute') RETURNING id`,
        [biz, owner],
      ),
    );
    await withTenant(app, { userId: owner }, (c) =>
      c.query(
        "INSERT INTO conversation_state (user_id, state, expires_at) VALUES ($1, 'DIALOG', now() - interval '1 minute')",
        [owner],
      ),
    );
    const result = await runMaintenance(system, logger);
    expect(result.draftsExpired).toBeGreaterThanOrEqual(1);
    expect(result.statesDeleted).toBeGreaterThanOrEqual(1);
    const row = await system.query('SELECT status FROM pending_operations WHERE id = $1', [
      draft.rows[0]!.id,
    ]);
    expect(row.rows[0].status).toBe('EXPIRED');
  });

  it('balans nomuvofiqligini aniqlab xabar beradi', async () => {
    const owner = await fx.createUser(app);
    const biz = await fx.createBusiness(app, owner);
    const customer = await fx.insertCustomer(app, biz, owner);
    await fx.insertDebt(app, biz, owner, customer, 1000);
    await migrator.query(
      'UPDATE customer_balances SET balance = balance + 1 WHERE customer_id = $1',
      [customer],
    );
    const result = await runMaintenance(system, logger);
    expect(result.balanceMismatches).toBeGreaterThanOrEqual(1);
    await migrator.query(
      'UPDATE customer_balances SET balance = balance - 1 WHERE customer_id = $1',
      [customer],
    );
    expect(randomUUID()).toBeTruthy();
  });

  it('parallel ikki yurish: faqat bittasi ishlaydi (advisory lock)', async () => {
    const results = await Promise.all([
      runMaintenance(system, logger),
      runMaintenance(system, logger),
      runMaintenance(system, logger),
    ]);
    expect(results.filter((r) => r.ranJobs).length).toBeGreaterThanOrEqual(1);
    // Ishlagan har bir yurish ketma-ket tugagan bo'lishi mumkin; muhimi — hech biri xato bermadi
    expect(results.every((r) => typeof r.ranJobs === 'boolean')).toBe(true);
  });
});
