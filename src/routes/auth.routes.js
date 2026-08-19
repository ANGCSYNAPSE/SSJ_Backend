import { Router } from "express";
import * as authController from "../controllers/auth.controller.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { signupSchema, loginSchema } from "../validators/auth.validator.js";

const router = Router();

/**
 * @openapi
 * /api/v1/auth/signup:
 *   post:
 *     tags: [Auth]
 *     summary: Create a new devotee account
 *     description: >
 *       Registers a member, sets an httpOnly refresh cookie and returns a
 *       short-lived access token alongside the created user.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, mobile, email, password, confirmPassword, acceptTerms]
 *             properties:
 *               fullName:
 *                 type: string
 *                 minLength: 2
 *                 example: Radhe Sharma
 *               mobile:
 *                 type: string
 *                 pattern: '^[6-9]\d{9}$'
 *                 example: "9876543210"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: radhe@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 description: Must contain at least one letter and one number.
 *                 example: JaiShyam123
 *               confirmPassword:
 *                 type: string
 *                 example: JaiShyam123
 *               acceptTerms:
 *                 type: boolean
 *                 enum: [true]
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/AuthResult'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       409:
 *         description: Email or mobile already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/signup",
  authLimiter,
  validate(signupSchema),
  authController.signup,
);

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: radhe@example.com
 *               password:
 *                 type: string
 *                 example: JaiShyam123
 *               remember:
 *                 type: boolean
 *                 default: true
 *                 description: Persist the refresh cookie across browser sessions.
 *     responses:
 *       200:
 *         description: Signed in
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/AuthResult'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post("/login", authLimiter, validate(loginSchema), authController.login);

/**
 * @openapi
 * /api/v1/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange the refresh cookie for a new access token
 *     responses:
 *       200:
 *         description: Session refreshed
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/AuthResult'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post("/refresh", authController.refresh);

/**
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Clear the refresh cookie
 *     responses:
 *       200:
 *         description: Signed out
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/logout", authController.logout);

/**
 * @openapi
 * /api/v1/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the currently authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         user:
 *                           $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get("/me", requireAuth, authController.me);

export default router;
