import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendChaser(
  to: string,
  from: string,
  subject: string,
  body: string,
) {
  await resend.emails.send({ from, to, subject, text: body });
}
