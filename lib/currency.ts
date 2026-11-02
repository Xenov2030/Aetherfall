export type Currency = { name: string; symbol: string; base_units: string };
export const DND_CURRENCIES: Currency[] = [
  { name: 'Platino', symbol: 'ppt', base_units: '1000' },
  { name: 'Oro', symbol: 'po', base_units: '100' },
  { name: 'Plata', symbol: 'pp', base_units: '10' },
  { name: 'Cobre', symbol: 'pc', base_units: '1' },
];
export function formatMoney(value: string, currencies: Currency[] = DND_CURRENCIES) {
  let remaining = BigInt(value);
  const sign = remaining < 0n ? '−' : '';
  if (remaining < 0n) remaining = -remaining;
  const ordered = [...currencies].sort((a, b) =>
    BigInt(a.base_units) > BigInt(b.base_units) ? -1 : 1,
  );
  const parts: string[] = [];
  for (const c of ordered) {
    const units = BigInt(c.base_units);
    if (units <= 0n) continue;
    const count = remaining / units;
    remaining %= units;
    if (count) parts.push(`${count} ${c.symbol}`);
  }
  if (remaining) parts.push(`${remaining} unidades base`);
  return sign + (parts.join(' · ') || `0 ${ordered.at(-1)?.symbol || 'pc'}`);
}
export function toBaseMoney(amount: string, units: string) {
  const match = /^(-?)(\d{1,15})(?:[.,](\d{1,3}))?$/.exec(amount.trim());
  if (!match) throw new Error('Ingresá un importe válido, con hasta tres decimales.');
  const decimals = match[3] || '';
  const scale = 10n ** BigInt(decimals.length);
  const numerator = BigInt(match[2] + decimals) * BigInt(units);
  if (numerator % scale !== 0n)
    throw new Error('El importe no puede incluir fracciones de la moneda base.');
  return (((match[1] ? -1n : 1n) * numerator) / scale).toString();
}
