import { buildCrudRouter } from "../utils/crudRouter.js";
import { InitiativeModel } from "../models/initiative.model.js";
import { createInitiativeSchema, updateInitiativeSchema } from "../validators/initiatives.validator.js";

/**
 * @openapi
 * /api/v1/initiatives:
 *   get:
 *     tags: [Initiatives]
 *     summary: List home page initiative cards
 *     responses:
 *       200: { description: List of initiatives }
 *   post:
 *     tags: [Initiatives]
 *     summary: Create an initiative (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tag, title, desc, image]
 *             properties:
 *               tag: { type: string }
 *               title: { type: string }
 *               desc: { type: string }
 *               image: { type: string }
 *               order: { type: integer, default: 0 }
 *     responses:
 *       201: { description: Created }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/initiatives/{id}:
 *   get:
 *     tags: [Initiatives]
 *     summary: Get an initiative by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Initiatives]
 *     summary: Update an initiative (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Initiatives]
 *     summary: Delete an initiative (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
/** "Our Initiatives" home page cards. Mounted at /api/v1/initiatives. */
export const initiativesRouter = buildCrudRouter({
  repository: InitiativeModel,
  createSchema: createInitiativeSchema,
  updateSchema: updateInitiativeSchema,
  publicRead: () => ({ where: "", params: [] }),
});
