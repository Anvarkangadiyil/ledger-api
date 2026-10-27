import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { pathToFileURL } from "node:url";

import { PORT } from "./config/env.js";
import connectToDatabase from "./config/db.js";
import setupSwagger from "./config/swagger.js";

import healthRouter from "./routes/health.routes.js";
import accountRouter from "./routes/account.routes.js";
import transactionRouter from "./routes/transaction.routes.js";
import errorMiddleware from "./middlewares/error.middleware.js";

const app = express();

const port = PORT || 3000;

app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// API Documentation
setupSwagger(app);

// Routes
app.use("/api/v1", healthRouter);
app.use("/api/v1/accounts", accountRouter);
app.use("/api/v1/accounts", transactionRouter);

app.use(errorMiddleware);

const isMainModule =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  app.listen(port, async () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`API Docs available at http://localhost:${port}/api-docs`);
    await connectToDatabase();
  });
}

export { app };
export default app;
