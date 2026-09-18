import { Router } from "express";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { UserModel } from "../models/user.model.js";
import { changeRoleSchema } from "../validators/users.validator.js";

/**
 * @openapi
 * /api/v1/admin/users:
 *   get:
 *     tags: [Users]
 *     summary: List all users (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { type: array, items: { $ref: '#/components/schemas/User' } }
 * /api/v1/admin/users/{id}/block:
 *   patch:
 *     tags: [Users]
 *     summary: Block a user (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Blocked }
 *       404: { description: Not found }
 * /api/v1/admin/users/{id}/unblock:
 *   patch:
 *     tags: [Users]
 *     summary: Unblock a user (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Unblocked }
 *       404: { description: Not found }
 * /api/v1/admin/users/{id}/role:
 *   patch:
 *     tags: [Users]
 *     summary: Change a user's role (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [member, artist, temple_admin, admin] }
 *     responses:
 *       200: { description: Role updated }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404: { description: Not found }
 */
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
