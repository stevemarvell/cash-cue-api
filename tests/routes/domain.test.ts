import { describe, it, expect } from 'vitest';
import {
  invoiceTotalMinor,
  daysOverdue,
  deriveStatus,
  statutoryInterestMinor,
  latePaymentCompensationMinor,
  parseISODate,
} from '../../src/domain/invoice.js';
import type { Invoice } from '../../src/types/api.js';

const BASE_INVOICE: Invoice = {
  id: 'inv_1',
  ownerId: 'user_1',
  clientId: 'client_1',
  reference: 'INV-001',
  currency: 'GBP',
  lineItems: [
    { description: 'Dev', quantity: 2, unitPriceMinor: 50000 },
    { description: 'Design', quantity: 1, unitPriceMinor: 30000 },
  ],
  issueDate: '2025-01-01',
  dueDate: '2025-01-31',
  status: 'sent',
  remindersSent: 0,
};

describe('invoiceTotalMinor', () => {
  it('sums line items correctly', () => {
    expect(invoiceTotalMinor(BASE_INVOICE)).toBe(130000); // 100000 + 30000
  });
});

describe('daysOverdue', () => {
  it('returns 0 for paid invoice', () => {
    const invoice = { ...BASE_INVOICE, status: 'paid' as const };
    expect(daysOverdue(invoice, new Date('2025-03-01'))).toBe(0);
  });

  it('returns 0 for draft invoice', () => {
    const invoice = { ...BASE_INVOICE, status: 'draft' as const };
    expect(daysOverdue(invoice, new Date('2025-03-01'))).toBe(0);
  });

  it('returns 0 when not yet overdue', () => {
    expect(daysOverdue(BASE_INVOICE, new Date('2025-01-15'))).toBe(0);
  });

  it('returns correct days when overdue', () => {
    expect(daysOverdue(BASE_INVOICE, new Date('2025-02-10'))).toBe(10);
  });
});

describe('deriveStatus', () => {
  it('keeps draft', () => {
    const invoice = { ...BASE_INVOICE, status: 'draft' as const };
    expect(deriveStatus(invoice, new Date())).toBe('draft');
  });

  it('keeps paid', () => {
    const invoice = { ...BASE_INVOICE, status: 'paid' as const };
    expect(deriveStatus(invoice, new Date())).toBe('paid');
  });

  it('returns overdue when past due', () => {
    expect(deriveStatus(BASE_INVOICE, new Date('2025-02-10'))).toBe('overdue');
  });

  it('returns sent when not yet due', () => {
    expect(deriveStatus(BASE_INVOICE, new Date('2025-01-15'))).toBe('sent');
  });
});

describe('statutoryInterestMinor', () => {
  it('returns 0 when not overdue', () => {
    expect(statutoryInterestMinor(BASE_INVOICE, new Date('2025-01-15'), 0.0475)).toBe(0);
  });

  it('calculates interest correctly', () => {
    const days = 30;
    const rate = 0.0475 + 0.08; // 12.75%
    const principal = 130000;
    const expected = Math.round((principal * rate * days) / 365);
    expect(statutoryInterestMinor(BASE_INVOICE, new Date('2025-03-02'), 0.0475)).toBe(expected);
  });
});

describe('latePaymentCompensationMinor', () => {
  it('returns £40 for debts under £1,000', () => {
    const inv = { ...BASE_INVOICE, lineItems: [{ description: 'x', quantity: 1, unitPriceMinor: 50000 }] };
    expect(latePaymentCompensationMinor(inv)).toBe(4000);
  });

  it('returns £70 for debts £1,000-£9,999', () => {
    const inv = { ...BASE_INVOICE, lineItems: [{ description: 'x', quantity: 1, unitPriceMinor: 200000 }] };
    expect(latePaymentCompensationMinor(inv)).toBe(7000);
  });

  it('returns £100 for debts >= £10,000', () => {
    const inv = { ...BASE_INVOICE, lineItems: [{ description: 'x', quantity: 1, unitPriceMinor: 1000000 }] };
    expect(latePaymentCompensationMinor(inv)).toBe(10000);
  });
});

describe('parseISODate', () => {
  it('parses YYYY-MM-DD correctly', () => {
    const d = parseISODate('2025-06-15');
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(5); // 0-indexed
    expect(d.getUTCDate()).toBe(15);
  });
});
