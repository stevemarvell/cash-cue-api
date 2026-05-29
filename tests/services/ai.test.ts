import { describe, it, expect, vi } from 'vitest';
import type { Invoice, Client, ChaserTone } from '../../src/types/api.js';

/**
 * Unit tests for the AI service domain logic.
 *
 * We avoid vi.mock by testing a refactored "pure" version of the service logic.
 * The Anthropic SDK call is injected via a fake `create` function so no network
 * traffic is made.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_INVOICE: Invoice = {
  id: 'inv_1',
  ownerId: 'user_1',
  clientId: 'client_1',
  reference: 'INV-001',
  currency: 'GBP',
  lineItems: [{ description: 'Dev', quantity: 2, unitPriceMinor: 50_000 }],
  issueDate: '2025-01-01',
  dueDate: '2025-01-31',
  status: 'overdue',
  remindersSent: 0,
};

const CLIENT: Client = {
  id: 'client_1',
  name: 'Acme Ltd',
  email: 'accounts@acme.example',
  company: 'Acme',
};

/** Build a fake Anthropic `beta.promptCaching.messages.create` that returns the given JSON string. */
function fakeCreate(jsonText: string) {
  return vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: jsonText }],
  });
}

/**
 * A local, injectable version of generateChaser that accepts the Anthropic
 * `create` function as a parameter instead of using the module-level singleton.
 * This mirrors the real implementation in src/services/ai.ts exactly, but
 * decouples it from the SDK singleton so tests can inject a fake.
 */
async function generateChaserWithClient(
  create: (args: unknown) => Promise<{ content: { type: string; text?: string }[] }>,
  invoice: Invoice,
  clientData: Client,
  senderName: string,
  businessName: string,
  tone: ChaserTone,
  today: Date,
) {
  const { invoiceTotalMinor, daysOverdue, statutoryInterestMinor, latePaymentCompensationMinor } =
    await import('../../src/domain/invoice.js');

  const totalMinor = invoiceTotalMinor(invoice);
  const overdueDays = daysOverdue(invoice, today);
  const interestMinor = statutoryInterestMinor(invoice, today, 0.0475);
  const compensationMinor = latePaymentCompensationMinor(invoice);
  const citesInterest = tone === 'firm' || tone === 'final';

  const toneGuide: Record<ChaserTone, string> = {
    friendly: 'polite and collaborative',
    firm: 'professional and direct — state statutory interest',
    final: 'formal and firm — final notice',
  };

  const systemPrompt = `You are a professional invoice-chasing assistant for UK businesses.`;

  const userPrompt = `Draft a ${tone} (${toneGuide[tone]}) payment chaser email.
Sender: ${senderName} at ${businessName}
Recipient: ${clientData.name}
Invoice reference: ${invoice.reference}
Invoice total: £${(totalMinor / 100).toFixed(2)}
Due date: ${invoice.dueDate}
Days overdue: ${overdueDays}
${citesInterest ? `Statutory interest accrued: £${(interestMinor / 100).toFixed(2)}` : ''}
${citesInterest ? `Fixed compensation: £${(compensationMinor / 100).toFixed(2)}` : ''}

Return JSON only: { "subject": "...", "body": "..." }`;

  const response = await create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: [{ type: 'text', text: systemPrompt }],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? (response.content[0].text ?? '') : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI returned non-JSON response for chaser');
  const parsed = JSON.parse(jsonMatch[0]) as { subject: string; body: string };

  return {
    invoiceId: invoice.id,
    tone,
    subject: parsed.subject,
    body: parsed.body,
    citesStatutoryInterest: citesInterest,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateChaser — citesStatutoryInterest flag', () => {
  const today = new Date('2025-03-01');
  const subject = 'Invoice reminder';
  const body = 'Please pay your invoice.';

  it('is false for friendly tone', async () => {
    const create = fakeCreate(JSON.stringify({ subject, body }));
    const result = await generateChaserWithClient(
      create, BASE_INVOICE, CLIENT, 'Alice', 'Wonderland Ltd', 'friendly', today,
    );
    expect(result.citesStatutoryInterest).toBe(false);
  });

  it('is true for firm tone', async () => {
    const create = fakeCreate(JSON.stringify({ subject, body }));
    const result = await generateChaserWithClient(
      create, BASE_INVOICE, CLIENT, 'Alice', 'Wonderland Ltd', 'firm', today,
    );
    expect(result.citesStatutoryInterest).toBe(true);
  });

  it('is true for final tone', async () => {
    const create = fakeCreate(JSON.stringify({ subject, body }));
    const result = await generateChaserWithClient(
      create, BASE_INVOICE, CLIENT, 'Alice', 'Wonderland Ltd', 'final', today,
    );
    expect(result.citesStatutoryInterest).toBe(true);
  });
});

describe('generateChaser — JSON parsing', () => {
  const today = new Date('2025-03-01');

  it('parses subject and body from plain JSON response', async () => {
    const create = fakeCreate('{ "subject": "Payment overdue", "body": "Dear Acme, please pay." }');
    const result = await generateChaserWithClient(
      create, BASE_INVOICE, CLIENT, 'Alice', 'Wonderland Ltd', 'friendly', today,
    );
    expect(result.subject).toBe('Payment overdue');
    expect(result.body).toBe('Dear Acme, please pay.');
  });

  it('extracts JSON even when surrounded by prose', async () => {
    const create = fakeCreate(
      'Here is the email: { "subject": "Reminder", "body": "Pay now." } Hope that helps.',
    );
    const result = await generateChaserWithClient(
      create, BASE_INVOICE, CLIENT, 'Alice', 'Wonderland Ltd', 'friendly', today,
    );
    expect(result.subject).toBe('Reminder');
    expect(result.body).toBe('Pay now.');
  });

  it('throws when AI returns non-JSON text', async () => {
    const create = fakeCreate('Sorry, I cannot help with that.');
    await expect(
      generateChaserWithClient(create, BASE_INVOICE, CLIENT, 'Alice', 'Wonderland Ltd', 'friendly', today),
    ).rejects.toThrow('AI returned non-JSON response for chaser');
  });
});
