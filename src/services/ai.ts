import Anthropic from '@anthropic-ai/sdk';
import type { Invoice, Client, ChaserMessage, ChaserTone } from '../types/api.js';
import {
  statutoryInterestMinor,
  latePaymentCompensationMinor,
  daysOverdue,
  invoiceTotalMinor,
} from '../domain/invoice.js';

const anthropic = new Anthropic();
const BASE_RATE = parseFloat(process.env.BOE_BASE_RATE ?? '0.0475');

export async function generateChaser(
  invoice: Invoice,
  clientData: Client,
  senderName: string,
  businessName: string,
  tone: ChaserTone,
  today: Date,
): Promise<ChaserMessage> {
  const totalMinor = invoiceTotalMinor(invoice);
  const overdueDays = daysOverdue(invoice, today);
  const interestMinor = statutoryInterestMinor(invoice, today, BASE_RATE);
  const compensationMinor = latePaymentCompensationMinor(invoice);
  const citesInterest = tone === 'firm' || tone === 'final';

  const toneGuide: Record<ChaserTone, string> = {
    friendly: 'polite and collaborative — assume it is an oversight, offer to help resolve',
    firm:     'professional and direct — state statutory interest entitlement clearly, request payment date commitment',
    final:    'formal and firm — state this is a final notice before legal action or debt collection, cite statutory interest and compensation figures exactly',
  };

  const systemPrompt = `You are a professional invoice-chasing assistant for UK businesses.
You draft payment-chaser emails that are legally accurate, professional, and effective.
You know the Late Payment of Commercial Debts (Interest) Act 1998: creditors are entitled to
statutory interest at the Bank of England base rate + 8% per annum (simple, daily accrual) on
overdue commercial debts, plus fixed compensation (£40 for debts under £1,000; £70 for £1,000–£9,999;
£100 for £10,000+). Always use GBP amounts formatted as £X.XX. Never use floats for intermediate calculations.
Respond only with a JSON object: { "subject": string, "body": string }`;

  const userPrompt = `Draft a ${tone} (${toneGuide[tone]}) payment chaser email.

Sender: ${senderName} at ${businessName}
Recipient: ${clientData.name} at ${clientData.company ?? clientData.email}
Invoice reference: ${invoice.reference}
Invoice total: £${(totalMinor / 100).toFixed(2)}
Due date: ${invoice.dueDate}
Days overdue: ${overdueDays}
${citesInterest ? `Statutory interest accrued: £${(interestMinor / 100).toFixed(2)}` : ''}
${citesInterest ? `Fixed compensation: £${(compensationMinor / 100).toFixed(2)}` : ''}

Return JSON only: { "subject": "...", "body": "..." }`;

  const response = await anthropic.beta.promptCaching.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
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

export async function summariseCashFlow(invoiceList: Invoice[], today: Date): Promise<string> {
  const overdueInvoices = invoiceList.filter(i => daysOverdue(i, today) > 0);
  const totalOutstandingMinor = invoiceList
    .filter(i => i.status !== 'paid')
    .reduce((sum, i) => sum + invoiceTotalMinor(i), 0);
  const totalOverdueMinor = overdueInvoices
    .reduce((sum, i) => sum + invoiceTotalMinor(i), 0);

  const unpaidCount = invoiceList.filter(i => i.status !== 'paid').length;
  const maxOverdueDays = overdueInvoices.length > 0
    ? Math.max(...overdueInvoices.map(i => daysOverdue(i, today)))
    : 0;

  const systemPrompt = `You are a cash-flow analyst for UK freelancers and small businesses.
Write concise (2-3 sentences), plain-English summaries of their outstanding invoice position.
Be specific about amounts in GBP. Flag if overdue invoices pose a cash-flow risk. No bullet points.`;

  const response = await anthropic.beta.promptCaching.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: `Outstanding: £${(totalOutstandingMinor / 100).toFixed(2)} across ${unpaidCount} unpaid invoices. Overdue: £${(totalOverdueMinor / 100).toFixed(2)} across ${overdueInvoices.length} invoices (oldest ${maxOverdueDays} days). Today: ${today.toISOString().slice(0, 10)}. Summarise the cash-flow position.`,
    }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}
