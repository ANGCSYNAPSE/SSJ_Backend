# Shyam Jagat API

REST API for the Shree Shyam Jagat platform. Node.js + Express, Neon (serverless
Postgres), JWT auth, documented with Swagger/OpenAPI 3.

## Getting started

```bash
cd backend
npm install
cp .env.example .env   # fill in DATABASE_URL and the two JWT secrets
npm run migrate
npm run dev
```

| URL                                  | What                    |
| ------------------------------------ | ----------------------- |
| http://localhost:5000/api/v1/health  | Liveness probe          |
| http://localhost:5000/api/docs       | Swagger UI              |
| http://localhost:5000/api/docs.json  | Raw OpenAPI spec        |

## Scripts

| Command           | Description                                    |
| ----------------- | ---------------------------------------------- |
| `npm run dev`     | Start with file watching                       |
| `npm start`       | Start the server                               |
| `npm run migrate` | Apply pending SQL migrations (idempotent)      |
| `npm run lint`    | Run ESLint                                     |

## Structure

```
src/
  config/       env.js, database.js (Neon), swagger.js
  controllers/  HTTP layer — parse request, shape response
  services/     Business rules (auth.service.js)
  models/       SQL access, one module per table
  routes/       Express routers + @openapi JSDoc blocks
  middleware/   validate, auth, rateLimiter, errorHandler
  validators/   Zod schemas per resource
  utils/        ApiError, apiResponse, asyncHandler, tokens
  db/
    migrate.js       Migration runner
    migrations/      Numbered .sql files
  app.js        Express app wiring
  server.js     Boot + graceful shutdown
```

The layering is one-directional: `routes → controllers → services → models`.
Controllers never write SQL; models never shape HTTP responses.

## Auth endpoints

| Method | Path                   | Auth   | Purpose                          |
| ------ | ---------------------- | ------ | -------------------------------- |
| POST   | `/api/v1/auth/signup`  | –      | Create an account                |
| POST   | `/api/v1/auth/login`   | –      | Sign in                          |
| POST   | `/api/v1/auth/refresh` | cookie | New access token                 |
| POST   | `/api/v1/auth/logout`  | –      | Clear the refresh cookie         |
| GET    | `/api/v1/auth/me`      | Bearer | Current user                     |

### Token model

- **Access token** — JWT, 15 min, returned in the response body. The frontend
  sends it as `Authorization: Bearer <token>`.
- **Refresh token** — JWT, 7 days, set as an `httpOnly` cookie scoped to
  `/api/v1/auth` so page scripts cannot read it.

### Response envelope

Every response — success or failure — uses the same shape:

```jsonc
// success
{ "success": true, "message": "Signed in successfully.", "data": { ... } }

// failure
{ "success": false, "message": "Validation failed.",
  "errors": [{ "field": "email", "message": "Enter a valid email address." }] }
```

Field-level `errors` let the client highlight the offending input directly.

## Migrations

`npm run migrate` applies every `.sql` file in `src/db/migrations/` in filename
order, records it in `schema_migrations`, and skips anything already applied —
so it is safe to re-run. Each file runs inside a transaction, so a failure
halfway through rolls back rather than leaving a half-migrated schema recorded
as done.

Migrations connect over TCP with `pg` rather than the Neon HTTP driver the app
uses at runtime, because the HTTP driver cannot run multi-statement SQL or
wrap statements in a transaction.

## Notes

- Passwords are hashed with bcrypt (12 rounds by default).
- Login compares against a dummy hash when the email is unknown, so response
  time does not reveal whether an account exists.
- Auth endpoints are rate limited to 10 failed attempts per 15 minutes per IP.
- `users` uses soft deletes (`deleted_at`); unique indexes on email and mobile
  are partial so a deleted row does not block re-registration.
