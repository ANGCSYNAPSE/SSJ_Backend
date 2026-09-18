import { Router } from "express";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { UserModel } from "../models/user.model.js";
import { changeRoleSchema } from "../validators/users.validator.js";

/**
 * Admin-only user management: list, block/unblock, change role.
 * Mounted at /api/v1/admin/users.
 */
export const adminUsersRouter = Router();

adminUsersRouter.get(
  "/",
  ...requireAdmin,
  asyncHandler(async (_req, res) => {
    const users = await UserModel.list();
    sendSuccess(res, { data: users });
  }),
);

adminUsersRouter.patch(
  "/:id/block",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const updated = await UserModel.setBlocked(req.params.id, true);
    if (!updated) throw ApiError.notFound();
    sendSuccess(res, { message: "Blocked.", data: updated });
  }),
);

adminUsersRouter.patch(
  "/:id/unblock",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const updated = await UserModel.setBlocked(req.params.id, false);
    if (!updated) throw ApiError.notFound();
    sendSuccess(res, { message: "Unblocked.", data: updated });
  }),
);

adminUsersRouter.patch(
  "/:id/role",
  ...requireAdmin,
  validate(changeRoleSchema),
  asyncHandler(async (req, res) => {
    const updated = await UserModel.setRole(req.params.id, req.validated.role);
    if (!updated) throw ApiError.notFound();
    sendSuccess(res, { message: "Role updated.", data: updated });
  }),
);
