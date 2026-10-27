import mongoose from "mongoose";

export const MAX_ACCOUNT_NAME_LENGTH = 120;

const accountSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Account name is required"],
      trim: true,
      minlength: [1, "Account name cannot be empty"],
      maxlength: [
        MAX_ACCOUNT_NAME_LENGTH,
        `Account name cannot exceed ${MAX_ACCOUNT_NAME_LENGTH} characters`,
      ],
    },
    // Stored in integer minor units so balance arithmetic stays exact.
    // Clients cannot set this; the service always creates accounts at zero.
    balanceMinor: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Balance cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Balance must be stored in integer minor units",
      },
    },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: false },
    versionKey: false,
  }
);

const Account = mongoose.model("Account", accountSchema);

export default Account;
