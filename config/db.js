import mongoose from "mongoose";
import { DB_URI, NODE_ENV } from "./env.js";

if (!DB_URI) {
  throw new Error(
    "Please define the DB_URI environment variable inside .env.<development/production>.local"
  );
}

const connectToDatabase = async () => {
  try {
    await mongoose.connect(DB_URI);
    console.log(`Connected to database in ${NODE_ENV || "development"} mode`);
  } catch (error) {
    console.error("Error connecting to database: ", error);
    process.exit(1);
  }
};

export { connectToDatabase, connectToDatabase as connectDB };
export default connectToDatabase;
