import { Router } from "express";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { UserModel } from "../models/user.model.js";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { AuthService } from "../services/auth.service.js";
import { changeRoleSchema, createUserSchema, updateUserSchema } from "../validators/users.validator.js";

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

adminUsersRouter.post(
  "/",
  ...requireAdmin,
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const { fullName, email, mobile, password, role, location, avatarUrl, status } = req.validated;

    const [byEmail, byMobile] = await Promise.all([UserModel.findByEmail(email), UserModel.findByMobile(mobile)]);
    const conflicts = [];
    if (byEmail) conflicts.push({ field: "email", message: "An account with this email already exists." });
    if (byMobile) conflicts.push({ field: "mobile", message: "An account with this mobile number already exists." });
    if (conflicts.length > 0) throw ApiError.conflict("This account already exists.", conflicts);

    const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
    const user = await UserModel.create({
      fullName,
      email,
      mobile,
      passwordHash,
      role,
      location,
      avatarUrl,
      isVerified: status !== "pending",
      isBlocked: status === "suspended",
    });
    sendSuccess(res, { status: 201, message: "User created.", data: user });
  }),
);

adminUsersRouter.get(
  "/:id",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.params.id);
    if (!user) throw ApiError.notFound();
    sendSuccess(res, { data: user });
  }),
);

adminUsersRouter.patch(
  "/:id",
  ...requireAdmin,
  validate(updateUserSchema),
  asyncHandler(async (req, res) => {
    const { status, ...fields } = req.validated;
    const existing = await UserModel.findById(req.params.id);
    if (!existing) throw ApiError.notFound();

    const conflicts = [];
    if (fields.email && fields.email !== existing.email && (await UserModel.findByEmail(fields.email))) {
      conflicts.push({ field: "email", message: "An account with this email already exists." });
    }
    if (fields.mobile && fields.mobile !== existing.mobile && (await UserModel.findByMobile(fields.mobile))) {
      conflicts.push({ field: "mobile", message: "An account with this mobile number already exists." });
    }
    if (conflicts.length > 0) throw ApiError.conflict("This account already exists.", conflicts);

    const patch = { ...fields };
    if (status) {
      patch.isVerified = status !== "pending";
      patch.isBlocked = status === "suspended";
    }
    // Admins can't lock themselves out or demote themselves by accident.
    if (req.params.id === req.user.id && (patch.isBlocked || (patch.role && patch.role !== "admin"))) {
      throw ApiError.badRequest("You can't suspend or demote your own account.");
    }

    const updated = await UserModel.update(req.params.id, patch);
    sendSuccess(res, { message: "Updated.", data: updated });
  }),
);

adminUsersRouter.delete(
  "/:id",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) {
      throw ApiError.badRequest("You can't delete your own account.");
    }
    const removed = await UserModel.softDelete(req.params.id);
    if (!removed) throw ApiError.notFound();
    res.status(204).send();
  }),
);

adminUsersRouter.post(
  "/:id/reset-password-link",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.params.id);
    if (!user) throw ApiError.notFound();
    await AuthService.requestPasswordReset(user.email);
    sendSuccess(res, { message: `Reset link sent to ${user.email}.` });
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
