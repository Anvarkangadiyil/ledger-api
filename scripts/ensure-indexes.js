/**
 * Explicit, non-destructive index setup.
 *
 * Run with `npm run indexes` (or `npm run indexes` with a production
 * environment file). Mongoose automatic index creation is disabled on the
 * Transaction model so indexes are created deliberately instead of during
 * application startup. This script only creates the indexes declared in the
 * schema; it never drops indexes.
 */
import mongoose from "mongoose";

import connectToDatabase from "../config/db.js";
import Transaction from "../models/transaction.model.js";

try {
  await connectToDatabase();
  await Transaction.createIndexes();

  const indexes = await Transaction.collection.indexes();
  const names = indexes.map((index) => index.name).join(", ");
  console.log(`Transaction indexes ensured: ${names}`);
} catch (error) {
  console.error("Failed to ensure transaction indexes:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
