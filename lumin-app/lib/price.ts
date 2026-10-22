import type { Product } from './types';

// What a shopper is charged for one unit: the list price less the seller's listed discount, worked out by the server
// (lumin-backend/app/pricing.py) and sent as salePrice. Every price shown and every total goes through this, so what is shown is
// what is charged. Old data without salePrice just uses price.
type Priced = Pick<Product, 'price'> & { salePrice?: number };

export const unitPrice = (p: Priced): number => (typeof p.salePrice === 'number' ? p.salePrice : p.price);
export const onSale = (p: Priced): boolean => unitPrice(p) < p.price - 0.004;
export const savePercent = (p: Priced): number => (p.price > 0 ? Math.round((1 - unitPrice(p) / p.price) * 100) : 0);
export const sumCents = (ps: Priced[]): number => ps.reduce((s, p) => s + Math.round(unitPrice(p) * 100), 0) / 100;

/** The same as unitPrice, for a product straight from the API (prices arrive as strings). */
export const apiUnitPrice = (p: { price: string | number; sale_price?: string | number | null }): number => {
  const price = typeof p.price === 'number' ? p.price : parseFloat(p.price);
  const sale = p.sale_price == null ? NaN : typeof p.sale_price === 'number' ? p.sale_price : parseFloat(p.sale_price);
  return Number.isFinite(sale) ? sale : price;
};
