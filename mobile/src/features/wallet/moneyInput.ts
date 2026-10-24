/** Parses an explicitly formatted BRL value, without parseFloat's partial matches. */
export function parseMoneyInput(input: string): number | null {
  const value = input.trim();
  if (!value) return null;

  let whole: string;
  let fraction = '';

  if (/^\d+$/.test(value)) {
    whole = value;
  } else {
    const decimalComma = /^(\d+|[1-9]\d{0,2}(?:\.\d{3})+),(\d{1,2})$/.exec(value);
    const decimalPoint = /^(\d+)\.(\d{1,2})$/.exec(value);
    const match = decimalComma ?? decimalPoint;
    if (!match) return null;
    whole = match[1].replace(/\./g, '');
    fraction = match[2];
  }

  // Work in whole cents. This also avoids turning 0,29 into 0,28 through
  // floating point multiplication followed by truncation.
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return cents / 100;
}
