import express from "express";
import cookieParser from "cookie-parser";

import { PORT } from "./config/env.js";

const app = express();

const port = PORT || 3000;

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.listen(port, () => {
  console.log(`Server running on ${port}`);
});
