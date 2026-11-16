import { Router } from "express";
import * as authController from "../controllers/auth.controller.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter, availabilityLimiter } from "../middleware/rateLimiter.js";
import {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  checkAvailabilitySchema,
} from "../validators/auth.validator.js";

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
 *               becomeMember:
 *                 type: boolean
 *                 default: false
 *                 description: Optional membership choice on the plain sign-up path.
 *               category:
 *                 type: string
 *                 enum: [artist, dancer, musician, temple, dharamshala, mandal]
 *                 description: Set to register as one of these instead of a plain member. The profile is stored in that category's own table.
 *               profile:
 *                 type: object
 *                 description: The category's own fields (required when `category` is set). See the Registrations tag.
 *     responses:
 *       201:
 *         description: Account created (and category profile, if `category` was sent)
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
/**
 * @openapi
 * /api/v1/auth/check-availability:
 *   post:
 *     tags: [Auth]
 *     summary: Is this email or mobile already registered?
 *     description: >
 *       Used by the signup form before the person fills in a long registration.
 *       `incomplete` is set when the email belongs to someone who started a
 *       category registration (artist, temple, ...) and has not finished it.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string, format: email }
 *               mobile: { type: string, example: "9876543210" }
 *     responses:
 *       200:
 *         description: Availability
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 emailTaken: { type: boolean }
 *                 mobileTaken: { type: boolean }
 *                 incomplete:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     category: { type: string }
 *                     missing: { type: integer }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post("/check-availability", availabilityLimiter, validate(checkAvailabilitySchema), authController.checkAvailability);

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

/**
 * @openapi
 * /api/v1/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Email a password reset link
 *     description: Always returns 200 so account existence is not revealed.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Request accepted }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Set a new password using an emailed reset token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password, confirmPassword]
 *             properties:
 *               token: { type: string }
 *               password: { type: string, minLength: 8 }
 *               confirmPassword: { type: string }
 *     responses:
 *       200: { description: Password updated }
 *       400: { description: Invalid/expired token or validation error }
 */
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", authLimiter, validate(resetPasswordSchema), authController.resetPassword);

export default router;
