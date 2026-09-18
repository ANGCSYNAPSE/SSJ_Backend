import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";

import { env, isProduction } from "./config/env.js";
import { swaggerSpec } from "./config/swagger.js";
import routes from "./routes/index.js";
import { donationsWebhookRouter } from "./routes/donations.routes.js";
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

// Razorpay's webhook needs the raw request body to verify its HMAC
// signature, so it's mounted (with express.raw()) before the global JSON
// body parser below — see routes/donations.routes.js.
app.use("/api/v1", apiLimiter, donationsWebhookRouter);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(isProduction ? "combined" : "dev"));

// Uploaded files (registration attachments, team photos, ad creatives, ...).
app.use("/uploads", express.static(path.join(process.cwd(), env.uploads.dir)));

app.use("/api", apiLimiter);
app.use("/api/v1", routes);

// Raw spec, for client generators and CI checks.
app.get("/api/docs.json", (_req, res) => res.json(swaggerSpec));

// Swagger UI, loaded from a CDN instead of the swagger-ui-express bundled
// static files — those live in node_modules/swagger-ui-dist and don't reach
// Vercel's serverless bundle (they're read from disk at runtime, not
// imported), so they 404 in production even though they work locally.
app.get("/api/docs", (_req, res) => {
  res.removeHeader("Content-Security-Policy");
  res.type("html").send(`<!DOCTYPE html>
<html>
  <head>
    <title>Shyam Jagat API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "/api/docs.json",
          dom_id: "#swagger-ui",
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        });
      };
    </script>
  </body>
</html>`);
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
