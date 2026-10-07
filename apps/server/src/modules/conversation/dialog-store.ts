import type { DialogState } from '@nasiya/nlp';
import type { Pool } from 'pg';
import { clearState, getState, setState } from './state.js';

/**
 * Dialog holati `conversation_state` da saqlanadi (TTL 15 daqiqa). Holat — kontekst; moliyaviy haqiqat emas.
 * `draftId`/`interpretationId` — shu holatga bog'liq qoralama va jurnal yozuvi.
 */

const KEY = 'DIALOG';

export interface StoredDialog {
  readonly dialog: DialogState;
  readonly draftId: string | null;
  readonly interpretationId: string | null;
}

export const EMPTY_DIALOG: StoredDialog = {
  dialog: { kind: 'IDLE' },
  draftId: null,
  interpretationId: null,
};

export async function loadDialog(pool: Pool, userId: string): Promise<StoredDialog> {
  const row = await getState(pool, userId);
  if (row?.state !== KEY) return EMPTY_DIALOG;
  const data = row.data as Partial<StoredDialog>;
  if (!data.dialog) return EMPTY_DIALOG;
  return {
    dialog: data.dialog,
    draftId: data.draftId ?? null,
    interpretationId: data.interpretationId ?? null,
  };
}

export async function saveDialog(pool: Pool, userId: string, stored: StoredDialog): Promise<void> {
  if (stored.dialog.kind === 'IDLE') {
    await clearState(pool, userId);
    return;
  }
  await setState(pool, userId, KEY, stored as unknown as Record<string, unknown>);
}
