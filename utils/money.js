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
