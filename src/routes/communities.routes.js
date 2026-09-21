import { buildCrudRouter } from "../utils/crudRouter.js";
import { CommunityModel } from "../models/community.model.js";
import { createCommunitySchema, updateCommunitySchema } from "../validators/communities.validator.js";

/**
 * @openapi
 * /api/v1/communities:
 *   get:
 *     tags: [Communities]
 *     summary: List devotional communities
 *     description: Anonymous callers only see active communities; admins see everything.
 *     responses:
 *       200: { description: List of communities }
 *   post:
 *     tags: [Communities]
 *     summary: Create a community (admin)
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
 *               description: { type: string }
 *               image: { type: string }
 *               category: { type: string }
 *               memberCount: { type: integer, default: 0 }
 *               dailyDiscussions: { type: integer, default: 0 }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201: { description: Created }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/communities/{id}:
 *   get:
 *     tags: [Communities]
 *     summary: Get a community by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Communities]
 *     summary: Update a community (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Communities]
 *     summary: Delete a community (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
/** Mounted at /api/v1/communities. */
export const communitiesRouter = buildCrudRouter({
  repository: CommunityModel,
  createSchema: createCommunitySchema,
  updateSchema: updateCommunitySchema,
  publicRead: () => ({
    where: "is_active = TRUE",
    params: [],
    isVisible: (community) => community.isActive,
  }),
});
