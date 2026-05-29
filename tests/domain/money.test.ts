import { describe, it, expect } from 'vitest';
import { formatGBP, isMinorUnit } from '../../src/domain/money.js';

describe('formatGBP', () => {
  it('formats zero pence as £0.00', () => {
    expect(formatGBP(0)).toBe('£0.00');
  });

  it('formats 150 pence as £1.50', () => {
    expect(formatGBP(150)).toBe('£1.50');
  });

  it('formats 100000 pence as £1000.00', () => {
    expect(formatGBP(100_000)).toBe('£1000.00');
  });

  it('rounds to 2 decimal places for non-integer pounds', () => {
    // 1 penny → £0.01
    expect(formatGBP(1)).toBe('£0.01');
  });
});

describe('isMinorUnit', () => {
  it('returns true for zero', () => {
    expect(isMinorUnit(0)).toBe(true);
  });

  it('returns true for a positive integer', () => {
    expect(isMinorUnit(10000)).toBe(true);
  });

  it('returns false for a float', () => {
    expect(isMinorUnit(99.99)).toBe(false);
  });

  it('returns false for a negative integer', () => {
    expect(isMinorUnit(-1)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isMinorUnit('100')).toBe(false);
  });
});
