import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DND_CURRENCIES, formatMoney, toBaseMoney } from '../lib/currency';
test('D&D sin electro: cobre, plata, oro y platino con equivalencias exactas', () => {
  assert.deepEqual(
    DND_CURRENCIES.map((c) => [c.name, c.base_units]),
    [
      ['Platino', '1000'],
      ['Oro', '100'],
      ['Plata', '10'],
      ['Cobre', '1'],
    ],
  );
  assert.equal(toBaseMoney('1', '1000'), toBaseMoney('10', '100'));
  assert.equal(toBaseMoney('1', '100'), toBaseMoney('10', '10'));
  assert.equal(toBaseMoney('1', '10'), toBaseMoney('10', '1'));
  assert.equal(formatMoney('1234'), '1 ppt · 2 po · 3 pp · 4 pc');
  assert.equal(formatMoney('0'), '0 pc');
  assert.equal(formatMoney('-1234'), '−1 ppt · 2 po · 3 pp · 4 pc');
});
test('Importes sin errores de coma flotante ni fracciones de cobre', () => {
  assert.equal(toBaseMoney('1,25', '100'), '125');
  assert.equal(toBaseMoney('0.001', '1000'), '1');
  assert.equal(toBaseMoney('-2.5', '10'), '-25');
  assert.equal(toBaseMoney('900719925474099', '1'), '900719925474099');
  assert.throws(() => toBaseMoney('0.1', '1'));
  assert.throws(() => toBaseMoney('1e2', '100'));
  assert.throws(() => toBaseMoney('abc', '100'));
});
