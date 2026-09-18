import { Router } from "express";
import { z } from "zod";
import { ApiError } from "./ApiError.js";
import { asyncHandler } from "./asyncHandler.js";
import { sendSuccess } from "./apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const reorderSchema = z.object({
  items: z
    .array(z.object({ id: z.string().min(1), order: z.number().int() }))
    .min(1),
});

/**
 * Builds a standard REST router (list, detail, create, update, delete) plus
 * any named status-transition routes, all backed by a `createSqlRepository`
 * instance. Used by every module whose API is plain CRUD.
 *
 * `publicRead`, when set, opens GET / and GET /:id to everyone:
 *   - `where`/`params`: SQL fragment (no leading WHERE) applied to the list
 *     query when the caller is not authenticated.
 *   - `isVisible(item)`: extra check applied to a single fetched item on the
 *     detail route so an unpublished item 404s for anonymous callers.
 * Admin routes (POST/PATCH/DELETE, and GET too when `publicRead` is unset)
 * always see/affect everything.
 */
export function buildCrudRouter({
  repository,
  createSchema,
  updateSchema,
  publicRead,
  statusActions = [],
  reorder = false,
}) {
  const router = Router();

  const listHandler = asyncHandler(async (req, res) => {
    const isPublic = Boolean(publicRead) && !req.user;
    const { where, params } = isPublic ? publicRead() : {};
    const items = await repository.list(where, params);
    sendSuccess(res, { data: items });
  });

  const detailHandler = asyncHandler(async (req, res) => {
    const item = await repository.findById(req.params.id);
    if (!item) throw ApiError.notFound();
    const isPublic = Boolean(publicRead) && !req.user;
    if (isPublic && publicRead().isVisible && !publicRead().isVisible(item)) {
      throw ApiError.notFound();
    }
    sendSuccess(res, { data: item });
  });

  if (publicRead) {
    router.get("/", listHandler);
    router.get("/:id", detailHandler);
  } else {
    router.get("/", ...requireAdmin, listHandler);
    router.get("/:id", ...requireAdmin, detailHandler);
  }

  router.post(
    "/",
    ...requireAdmin,
    validate(createSchema),
    asyncHandler(async (req, res) => {
      const created = await repository.create(req.validated);
      sendSuccess(res, { status: 201, message: "Created.", data: created });
    }),
  );

  // Registered before "/:id" so "reorder" isn't swallowed as an :id value.
  if (reorder) {
    router.patch(
      "/reorder",
      ...requireAdmin,
      validate(reorderSchema),
      asyncHandler(async (req, res) => {
        await repository.reorderMany(req.validated.items);
        sendSuccess(res, { message: "Reordered." });
      }),
    );
  }

  router.patch(
    "/:id",
    ...requireAdmin,
    validate(updateSchema),
    asyncHandler(async (req, res) => {
      const updated = await repository.update(req.params.id, req.validated);
      if (!updated) throw ApiError.notFound();
      sendSuccess(res, { message: "Updated.", data: updated });
    }),
  );

  for (const { action, patch } of statusActions) {
    router.patch(
      `/:id/${action}`,
      ...requireAdmin,
      asyncHandler(async (req, res) => {
        const existing = await repository.findById(req.params.id);
        if (!existing) throw ApiError.notFound();
        const resolvedPatch = typeof patch === "function" ? patch(existing) : patch;
        const updated = await repository.update(req.params.id, resolvedPatch);
        sendSuccess(res, { message: "Updated.", data: updated });
      }),
    );
  }

  router.delete(
    "/:id",
    ...requireAdmin,
    asyncHandler(async (req, res) => {
      const removed = await repository.remove(req.params.id);
      if (!removed) throw ApiError.notFound();
      res.status(204).send();
    }),
  );

  return router;
}
