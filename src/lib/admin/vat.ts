/**
 * VAT arithmetic, shared by the invoice form in the browser and the server
 * that saves and renders invoices — one place, so the figure a person sees
 * while typing is the figure that is stored.
 *
 * An invoice stores `amount` before VAT and `tax` as the VAT on it, and
 * `total = amount + tax - discount`, the shape the table always had.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Split a price into the amount before VAT and the VAT.
 * `inclusive` reads the price as already including VAT (5,000 → 4,310.34 + 689.66);
 * otherwise VAT is added on top (5,000 → 5,000 + 800).
 */
export function vatSplit(price: number, ratePct: number, inclusive: boolean): { amount: number; tax: number } {
  const rate = Math.max(0, ratePct) / 100;
  if (!rate) return { amount: r2(price), tax: 0 };
  if (inclusive) {
    const amount = r2(price / (1 + rate));
    return { amount, tax: r2(price - amount) };
  }
  return { amount: r2(price), tax: r2(price * rate) };
}

/** "VAT (16%)" — the rate read back from the stored figures, so an old invoice keeps its own rate. */
export function vatLabel(amount: number, tax: number): string {
  if (!(tax > 0) || !(amount > 0)) return "VAT";
  const pct = Math.round((tax / amount) * 10000) / 100;
  return `VAT (${Number.isInteger(pct) ? pct : pct.toFixed(2)}%)`;
}
