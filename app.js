import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import { PORT } from "./config/env.js";
import connectToDatabase from "./config/db.js";
import setupSwagger from "./config/swagger.js";

import healthRouter from "./routes/health.routes.js";
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

app.use(errorMiddleware);

app.listen(port, async () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`API Docs available at http://localhost:${port}/api-docs`);
  await connectToDatabase();
});
