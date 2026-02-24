import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("combined"));
  return app;
}

