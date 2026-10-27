import { config } from "dotenv";

const path = `.env.${process.env.NODE_ENV || "development"}.local`;

config({ path });

export const { PORT } = process.env;
