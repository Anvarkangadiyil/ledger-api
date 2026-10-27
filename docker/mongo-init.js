/* global db, print, quit, rs, sleep */

/**
 * Idempotent single-node replica-set initialisation for the Compose stack.
 *
 * The application stores money with multi-document transactions, so MongoDB
 * must run as a replica set even for local evaluation. This script is safe to
 * run again: it only calls rs.initiate() when the set has not been created,
 * then waits for the primary before exiting.
 */
const config = {
  _id: "rs0",
  members: [{ _id: 0, host: "mongo:27017" }],
};

try {
  rs.status();
  print("Replica set rs0 is already initiated");
} catch (error) {
  if (error.codeName !== "NotYetInitialized") {
    throw error;
  }

  print("Initiating replica set rs0");
  rs.initiate(config);
}

const maxAttempts = 60;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    if (db.hello().isWritablePrimary) {
      print("Replica set primary is ready");
      quit(0);
    }
  } catch {
    // The set can briefly refuse connections while it elects a primary.
  }

  sleep(1000);
}

print("Timed out waiting for the replica set primary");
quit(1);
