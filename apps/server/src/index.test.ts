import { describe, expect, it } from 'vitest';
import { SERVICE_NAME, SUPPORTED_INTENTS } from './index.js';

describe('server scaffold', () => {
  it('shared paketni workspace orqali import qiladi', () => {
    expect(SERVICE_NAME).toBe('nasiya-server');
    expect(SUPPORTED_INTENTS).toContain('CREATE_DEBT');
  });
});
