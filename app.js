import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";


import { PORT } from "./config/env.js";
import connectToDatabase from "./config/db.js";


import errorMiddleware from "./middleware/error.middleware.js";


const app = express();

const port = PORT || 3000;

app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));



app.use(errorMiddleware);

app.listen(port, async () => {
  console.log(`Server running on ${port}`);
  await connectToDatabase();
});
