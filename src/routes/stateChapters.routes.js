import { buildCrudRouter } from "../utils/crudRouter.js";
import { StateChapterModel } from "../models/stateChapter.model.js";
import { createStateChapterSchema, updateStateChapterSchema } from "../validators/stateChapters.validator.js";

/**
 * @openapi
 * /api/v1/state-chapters:
 *   get:
 *     tags: [State Chapters]
 *     summary: List state chapters
 *     responses:
 *       200: { description: List of state chapters }
 *   post:
 *     tags: [State Chapters]
 *     summary: Create a state chapter (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, slug]
 *             properties:
 *               name: { type: string }
 *               slug: { type: string, pattern: '^[a-z0-9-]+$' }
 *               members: { type: integer, default: 0 }
 *               totalMembers: { type: string }
 *               districtsCovered: { type: string }
 *               established: { type: string }
 *     responses:
 *       201: { description: Created }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/state-chapters/{id}:
 *   get:
 *     tags: [State Chapters]
 *     summary: Get a state chapter by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [State Chapters]
 *     summary: Update a state chapter (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [State Chapters]
 *     summary: Delete a state chapter (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
/** Team > State Team overview. Mounted at /api/v1/state-chapters. */
export const stateChaptersRouter = buildCrudRouter({
  repository: StateChapterModel,
  createSchema: createStateChapterSchema,
  updateSchema: updateStateChapterSchema,
  publicRead: () => ({ where: "", params: [] }),
});
