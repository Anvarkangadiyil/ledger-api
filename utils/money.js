/**
 * Money is stored as integer minor units (for example, cents) to avoid
 * floating-point drift when balances are incremented repeatedly.
 *
 * `minorUnitsToAmount` performs a single conversion at the API boundary.
 * The assessment does not specify a currency, so the public contract uses
 * two decimal places (100 minor units per major unit).
 */
export const MINOR_UNITS_PER_MAJOR_UNIT = 100;

export const minorUnitsToAmount = (minorUnits) =>
  minorUnits / MINOR_UNITS_PER_MAJOR_UNIT;

const AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Convert a public major-unit amount into integer minor units.
 *
 * Accepts a finite JSON number (the API contract) and converts through its
 * decimal string representation so values such as 10.25 do not accumulate
 * floating-point error. More than two decimal places are rejected rather
 * than silently rounded.
 */
export const amountToMinorUnits = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError("Amount must be a positive number");
  }

  const match = AMOUNT_PATTERN.exec(String(value));

  if (!match) {
    throw new RangeError(
      "Amount must be a positive number with at most two decimal places"
    );
  }

  const wholeUnits = Number(match[1]);
  const fractionalUnits = Number((match[2] ?? "").padEnd(2, "0"));
  const minorUnits =
    wholeUnits * MINOR_UNITS_PER_MAJOR_UNIT + fractionalUnits;

  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) {
    throw new RangeError("Amount must be greater than zero");
  }

  return minorUnits;
};
