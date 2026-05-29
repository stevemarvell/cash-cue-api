import type { Invoice, InvoiceStatus } from '../types/api.js';

export function invoiceTotalMinor(invoice: Invoice): number {
  return invoice.lineItems.reduce(
    (acc, item) => acc + Math.round(item.unitPriceMinor * item.quantity),
    0,
  );
}

export function daysOverdue(invoice: Invoice, today: Date): number {
  if (invoice.status === 'paid' || invoice.status === 'draft') return 0;
  const due = parseISODate(invoice.dueDate);
  const diffMs = startOfDay(today).getTime() - due.getTime();
  return diffMs <= 0 ? 0 : Math.floor(diffMs / 86_400_000);
}

export function deriveStatus(invoice: Invoice, today: Date): InvoiceStatus {
  if (invoice.status === 'draft' || invoice.status === 'paid') return invoice.status;
  return daysOverdue(invoice, today) > 0 ? 'overdue' : 'sent';
}

/**
 * Statutory interest under Late Payment of Commercial Debts (Interest) Act 1998.
 * Rate = Bank of England base rate + 8%, simple interest, daily accrual.
 * @param baseRate Bank of England base rate as a fraction (e.g. 0.0475 for 4.75%)
 */
export function statutoryInterestMinor(
  invoice: Invoice,
  today: Date,
  baseRate: number,
): number {
  const days = daysOverdue(invoice, today);
  if (days <= 0) return 0;
  const annualRate = baseRate + 0.08;
  const principal = invoiceTotalMinor(invoice);
  return Math.round((principal * annualRate * days) / 365);
}

/**
 * Fixed late-payment compensation banded by debt size.
 */
export function latePaymentCompensationMinor(invoice: Invoice): number {
  const total = invoiceTotalMinor(invoice);
  if (total < 100_000) return 4_000;   // < £1,000  → £40
  if (total < 1_000_000) return 7_000; // < £10,000 → £70
  return 10_000;                        // ≥ £10,000 → £100
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
