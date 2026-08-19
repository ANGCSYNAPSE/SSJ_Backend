import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";

import { env, isProduction } from "./config/env.js";
import { swaggerSpec } from "./config/swagger.js";
import routes from "./routes/index.js";
import { apiLimiter } from "./middleware/rateLimiter.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

const app = express();

// Behind a proxy (Render/Vercel/Nginx) so rate limiting sees the real client IP.
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(isProduction ? "combined" : "dev"));

app.use("/api", apiLimiter);
app.use("/api/v1", routes);

app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: "Shyam Jagat API Docs",
  }),
);

// Raw spec, for client generators and CI checks.
app.get("/api/docs.json", (_req, res) => res.json(swaggerSpec));

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
