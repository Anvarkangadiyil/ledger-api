import mongoose from "mongoose";

import ApiError from "../errors/api-error.js";
import Account from "../models/account.model.js";
import Transaction from "../models/transaction.model.js";
import { minorUnitsToAmount } from "../utils/money.js";

const DUPLICATE_REFERENCE_MESSAGE =
  "A transaction with this reference_id already exists for this account";

const DUPLICATE_TRANSFER_REFERENCE_MESSAGE =
  "A transaction with this reference_id already exists for the source or destination account";

const TRANSACTION_UNSUPPORTED_PATTERN =
  /Transaction numbers are only allowed|transactions are not supported|replica set member or mongos|does not support retryable writes/i;

const isTransactionUnsupportedError = (error) =>
  (error?.code === 20 &&
    /transaction/i.test(String(error?.message ?? ""))) ||
  TRANSACTION_UNSUPPORTED_PATTERN.test(String(error?.message ?? ""));

const isDuplicateKeyError = (error) =>
  error?.code === 11000 ||
  error?.writeErrors?.some((writeError) => writeError.code === 11000);

export const toTransactionResponse = (transaction) => ({
  id: transaction._id.toString(),
  account_id: transaction.accountId.toString(),
  type: transaction.type,
  amount: minorUnitsToAmount(transaction.amountMinor),
  description: transaction.description,
  reference_id: transaction.referenceId,
  created_at: transaction.createdAt.toISOString(),
});

/**
 * Create a ledger entry and update its account balance in one MongoDB
 * transaction. A failed insert or conditional debit rolls back both writes.
 */
export const createTransaction = async ({
  accountId,
  type,
  amountMinor,
  description,
  referenceId,
}) => {
  const session = await mongoose.startSession();

  try {
    return await session.withTransaction(async () => {
      let updatedAccount;

      if (type === "credit") {
        updatedAccount = await Account.findByIdAndUpdate(
          accountId,
          { $inc: { balanceMinor: amountMinor } },
          { returnDocument: "after", session }
        );

        if (!updatedAccount) {
          throw new ApiError(404, "Account not found");
        }
      } else if (type === "debit") {
        // The $gte predicate is the concurrency guard: only one competing
        // debit can spend the same funds.
        updatedAccount = await Account.findOneAndUpdate(
          {
            _id: accountId,
            balanceMinor: { $gte: amountMinor },
          },
          { $inc: { balanceMinor: -amountMinor } },
          { returnDocument: "after", session }
        );

        if (!updatedAccount) {
          const accountExists = await Account.exists({ _id: accountId }).session(
            session
          );

          if (!accountExists) {
            throw new ApiError(404, "Account not found");
          }

          throw new ApiError(409, "Insufficient funds");
        }
      } else {
        throw new ApiError(400, "type must be either credit or debit");
      }

      const [transaction] = await Transaction.create(
        [
          {
            accountId,
            type,
            amountMinor,
            description,
            referenceId,
          },
        ],
        { session }
      );

      return {
        transaction: toTransactionResponse(transaction),
        balance: minorUnitsToAmount(updatedAccount.balanceMinor),
      };
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (isDuplicateKeyError(error)) {
      throw new ApiError(409, DUPLICATE_REFERENCE_MESSAGE);
    }

    if (isTransactionUnsupportedError(error)) {
      console.error(
        "MongoDB transaction support is unavailable:",
        error.message
      );
      throw new ApiError(
        503,
        "Transaction processing is unavailable because MongoDB does not support transactions"
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/**
 * Move money between two accounts in one MongoDB transaction.
 *
 * The source debit is conditional on sufficient funds, both balances are
 * updated, and both immutable ledger entries are inserted in the same session.
 * Any failure rolls back every write. The transfer reference is used for both
 * ledger entries and is therefore unique per account through the existing
 * compound index.
 */
export const createTransfer = async ({
  sourceAccountId,
  destinationAccountId,
  amountMinor,
  description,
  referenceId,
}) => {
  const session = await mongoose.startSession();

  try {
    return await session.withTransaction(async () => {
      const sourceAccount = await Account.findOneAndUpdate(
        {
          _id: sourceAccountId,
          balanceMinor: { $gte: amountMinor },
        },
        { $inc: { balanceMinor: -amountMinor } },
        { returnDocument: "after", session }
      );

      if (!sourceAccount) {
        const sourceExists = await Account.exists({
          _id: sourceAccountId,
        }).session(session);

        if (!sourceExists) {
          throw new ApiError(404, "Source account not found");
        }

        throw new ApiError(409, "Insufficient funds");
      }

      const destinationAccount = await Account.findByIdAndUpdate(
        destinationAccountId,
        { $inc: { balanceMinor: amountMinor } },
        { returnDocument: "after", session }
      );

      if (!destinationAccount) {
        throw new ApiError(404, "Destination account not found");
      }

      const [debitTransaction, creditTransaction] = await Transaction.create(
        [
          {
            accountId: sourceAccountId,
            type: "debit",
            amountMinor,
            description,
            referenceId,
          },
          {
            accountId: destinationAccountId,
            type: "credit",
            amountMinor,
            description,
            referenceId,
          },
        ],
        { session, ordered: true }
      );

      return {
        transfer: {
          reference_id: referenceId,
          amount: minorUnitsToAmount(amountMinor),
          description,
          source_account_id: sourceAccountId,
          destination_account_id: destinationAccountId,
          created_at: debitTransaction.createdAt.toISOString(),
        },
        source_balance: minorUnitsToAmount(sourceAccount.balanceMinor),
        destination_balance: minorUnitsToAmount(
          destinationAccount.balanceMinor
        ),
        transactions: [
          toTransactionResponse(debitTransaction),
          toTransactionResponse(creditTransaction),
        ],
      };
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (isDuplicateKeyError(error)) {
      throw new ApiError(409, DUPLICATE_TRANSFER_REFERENCE_MESSAGE);
    }

    if (isTransactionUnsupportedError(error)) {
      console.error(
        "MongoDB transaction support is unavailable:",
        error.message
      );
      throw new ApiError(
        503,
        "Transaction processing is unavailable because MongoDB does not support transactions"
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/**
 * Retrieve one page of an account's ledger entries, newest first.
 *
 * Pagination runs in MongoDB via skip/limit, and the `_id` tie-breaker keeps
 * page boundaries stable when multiple entries share a created_at value.
 * `total_pages` is 0 when the account has no matching transactions.
 */
export const getTransactionHistory = async ({
  accountId,
  type,
  page,
  limit,
}) => {
  const accountExists = await Account.exists({ _id: accountId });

  if (!accountExists) {
    throw new ApiError(404, "Account not found");
  }

  const filter = { accountId };
  if (type !== undefined) {
    filter.type = type;
  }

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
  ]);

  return {
    transactions: transactions.map(toTransactionResponse),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  };
};

export default createTransaction;
