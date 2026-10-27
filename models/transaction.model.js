import mongoose from "mongoose";

export const TRANSACTION_TYPES = Object.freeze(["credit", "debit"]);
export const MAX_TRANSACTION_DESCRIPTION_LENGTH = 500;
export const MAX_REFERENCE_ID_LENGTH = 255;

const transactionSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: [true, "Account ID is required"],
    },
    type: {
      type: String,
      required: [true, "Transaction type is required"],
      enum: {
        values: TRANSACTION_TYPES,
        message: "Transaction type must be either credit or debit",
      },
    },
    // Stored in integer minor units so ledger arithmetic stays exact.
    amountMinor: {
      type: Number,
      required: [true, "Amount is required"],
      min: [1, "Amount must be greater than zero"],
      validate: {
        validator: Number.isInteger,
        message: "Amount must be stored in integer minor units",
      },
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      minlength: [1, "Description cannot be empty"],
      maxlength: [
        MAX_TRANSACTION_DESCRIPTION_LENGTH,
        `Description cannot exceed ${MAX_TRANSACTION_DESCRIPTION_LENGTH} characters`,
      ],
    },
    referenceId: {
      type: String,
      required: [true, "Reference ID is required"],
      trim: true,
      minlength: [1, "Reference ID cannot be empty"],
      maxlength: [
        MAX_REFERENCE_ID_LENGTH,
        `Reference ID cannot exceed ${MAX_REFERENCE_ID_LENGTH} characters`,
      ],
    },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: false },
    versionKey: false,
    strict: "throw",
    // Indexes are created explicitly by `npm run indexes`; do not rely on
    // Mongoose's automatic index creation at startup.
    autoIndex: false,
  }
);

// Ledger entries are immutable; the creation time is server-controlled.
transactionSchema.path("createdAt").immutable(true);
transactionSchema.pre("validate", function setServerCreatedAt() {
  if (this.isNew) {
    this.createdAt = new Date();
  }
});

// The same reference ID may be reused by different accounts, but never twice
// within one account.
transactionSchema.index(
  { accountId: 1, referenceId: 1 },
  { unique: true, name: "uniq_account_reference" }
);

// Supports newest-first history queries, including the deterministic _id
// tie-breaker used for equal timestamps.
transactionSchema.index(
  { accountId: 1, createdAt: -1, _id: -1 },
  { name: "account_history" }
);

// Supports history queries filtered by transaction type.
transactionSchema.index(
  { accountId: 1, type: 1, createdAt: -1, _id: -1 },
  { name: "account_type_history" }
);

const Transaction = mongoose.model("Transaction", transactionSchema);

export default Transaction;
