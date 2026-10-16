// PII redaction for free text that may reach logs or third-party tools.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 13–19 digits, optionally separated by spaces/dashes (payment card numbers).
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
// Phone numbers: optional +, 9–15 digits with common separators.
const PHONE = /(?<![\w])\+?\d(?:[\s().-]?\d){8,14}(?![\w])/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Replaces emails, Luhn-valid card numbers and phone numbers with placeholders. */
export function redactPii(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(CARD, (match) => (luhnValid(match.replace(/\D/g, "")) ? "[card]" : match))
    .replace(PHONE, "[phone]");
}
