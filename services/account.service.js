import ApiError from "../errors/api-error.js";
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

/**
 * Read the persisted balance for one account.
 *
 * The balance is stored in integer minor units and converted once at the API
 * boundary, so the value is never recomputed from transaction history.
 */
export const getAccountBalance = async (accountId) => {
  const account = await Account.findById(accountId)
    .select({ balanceMinor: 1 })
    .lean();

  if (!account) {
    throw new ApiError(404, "Account not found");
  }

  return {
    account_id: account._id.toString(),
    balance: minorUnitsToAmount(account.balanceMinor),
  };
};

export default createAccount;
