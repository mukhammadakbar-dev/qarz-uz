import { generateReceiptPng } from '../src/services/receiptService.js';
import assert from 'assert';

console.log('--- receipt PNG generation test ---');

const pngBuffer = generateReceiptPng({
  shopName: "Fayz Baraka Do'koni",
  debtorName: "Alisher Ro'ziyev",
  type: "given",
  amount: 250000,
  remainingBalance: 1200000,
  payUrl: "http://localhost:3080/pay/test1234"
});

assert(Buffer.isBuffer(pngBuffer), 'Result must be a Buffer');
assert(pngBuffer.length > 1000, `PNG Buffer must be non-empty (got ${pngBuffer.length} bytes)`);

// Check PNG magic number header: 0x89 'P' 'N' 'G'
assert.strictEqual(pngBuffer[0], 0x89, 'PNG magic byte 0');
assert.strictEqual(pngBuffer[1], 0x50, 'PNG magic byte 1 (P)');
assert.strictEqual(pngBuffer[2], 0x4e, 'PNG magic byte 2 (N)');
assert.strictEqual(pngBuffer[3], 0x47, 'PNG magic byte 3 (G)');

console.log(`PASS PNG receipt generated cleanly! (${pngBuffer.length} bytes)`);
