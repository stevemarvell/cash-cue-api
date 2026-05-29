export type ID = string;

export type CurrencyCode = 'GBP' | 'USD' | 'EUR';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';

export type ChaserTone = 'friendly' | 'firm' | 'final';

export type SubscriptionTier = 'starter' | 'pro' | 'business';

export interface LineItem {
  description: string;
  quantity: number;
  unitPriceMinor: number; // integer pence — never floats
}

export interface Invoice {
  id: ID;
  ownerId: ID;
  clientId: ID;
  reference: string;
  currency: CurrencyCode;
  lineItems: LineItem[];
  issueDate: string;  // YYYY-MM-DD
  dueDate: string;    // YYYY-MM-DD
  paidDate?: string;  // YYYY-MM-DD, set when paid
  status: InvoiceStatus;
  remindersSent: number;
}

export interface Client {
  id: ID;
  ownerId?: ID;
  name: string;
  email: string;
  company?: string;
}

export interface User {
  id: ID;
  email: string;
  displayName: string;
  businessName: string;
  tier: SubscriptionTier;
}

export interface ChaserMessage {
  invoiceId: ID;
  tone: ChaserTone;
  subject: string;
  body: string;
  citesStatutoryInterest: boolean;
}

export interface AuthSession {
  user: User;
  token: string;
}

export interface SubscriptionResult {
  tier: SubscriptionTier;
  active: boolean;
  subscriptionId: string;
}

export interface PaymentLink {
  invoiceId: ID;
  url: string;
}
