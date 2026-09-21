import { buildCrudRouter } from "../utils/crudRouter.js";
import { OrganisationModel } from "../models/organisation.model.js";
import { createOrganisationSchema, updateOrganisationSchema } from "../validators/organisations.validator.js";

/**
 * @openapi
 * /api/v1/organisations:
 *   get:
 *     tags: [Organisations]
 *     summary: List partner organisations
 *     description: Anonymous callers only see active organisations; admins see everything.
 *     responses:
 *       200: { description: List of organisations }
 *   post:
 *     tags: [Organisations]
 *     summary: Create an organisation (admin)
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
 *               logo: { type: string }
 *               category: { type: string }
 *               contactEmail: { type: string }
 *               contactPhone: { type: string }
 *               established: { type: string }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201: { description: Created }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/organisations/{id}:
 *   get:
 *     tags: [Organisations]
 *     summary: Get an organisation by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Organisations]
 *     summary: Update an organisation (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Organisations]
 *     summary: Delete an organisation (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
/** Mounted at /api/v1/organisations. */
export const organisationsRouter = buildCrudRouter({
  repository: OrganisationModel,
  createSchema: createOrganisationSchema,
  updateSchema: updateOrganisationSchema,
  publicRead: () => ({
    where: "is_active = TRUE",
    params: [],
    isVisible: (org) => org.isActive,
  }),
});
