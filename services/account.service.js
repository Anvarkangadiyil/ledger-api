import Account from "../models/account.model.js";
import { minorUnitsToAmount } from "../utils/money.js";

/**
 * Map the internal account document to the public API contract.
 * Internal fields (`_id`, `balanceMinor`, `createdAt`) are not exposed.
 */
export const toAccountResponse = (account) => ({
  id: account._id.toString(),
  name: account.name,
  balance: minorUnitsToAmount(account.balanceMinor),
  created_at: account.createdAt.toISOString(),
});

export const createAccount = async ({ name }) => {
  const account = await Account.create({ name });
  return toAccountResponse(account);
};

export default createAccount;
