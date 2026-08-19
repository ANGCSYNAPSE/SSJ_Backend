import swaggerJsdoc from "swagger-jsdoc";
import { env } from "./env.js";

const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Shree Shyam Jagat API",
      version: "1.0.0",
      description:
        "REST API for the Shree Shyam Jagat platform — authentication, temples, artists, donations.",
      contact: { name: "Shyam Jagat", email: "info@shyamjagat.org" },
    },
    servers: [
      { url: `http://localhost:${env.port}`, description: "Local development" },
    ],
    tags: [{ name: "Auth", description: "Signup, login and session handling" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            fullName: { type: "string", example: "Radhe Sharma" },
            email: { type: "string", format: "email" },
            mobile: { type: "string", example: "9876543210" },
            role: {
              type: "string",
              enum: ["member", "artist", "temple_admin", "admin"],
            },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        AuthResult: {
          type: "object",
          properties: {
            user: { $ref: "#/components/schemas/User" },
            accessToken: { type: "string" },
          },
        },
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" },
            data: { type: "object", nullable: true },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Validation failed" },
            errors: {
              type: "array",
              nullable: true,
              items: {
                type: "object",
                properties: {
                  field: { type: "string", example: "email" },
                  message: { type: "string", example: "Enter a valid email." },
                },
              },
            },
          },
        },
      },
      responses: {
        ValidationError: {
          description: "Request body failed validation",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        Unauthorized: {
          description: "Missing or invalid credentials",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  // JSDoc @openapi blocks live next to the routes they document.
  apis: ["./src/routes/*.js"],
};

export const swaggerSpec = swaggerJsdoc(options);
