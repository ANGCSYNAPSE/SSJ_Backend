import { buildCrudRouter } from "../utils/crudRouter.js";
import { TeamMemberModel } from "../models/teamMember.model.js";
import { createTeamMemberSchema, updateTeamMemberSchema } from "../validators/teamMembers.validator.js";

/**
 * @openapi
 * /api/v1/team-members:
 *   get:
 *     tags: [Team Members]
 *     summary: List team members
 *     description: Filter by ?section= (trustee, management, advisory, state_leadership, district_member) and ?stateSlug= client-side.
 *     responses:
 *       200: { description: List of team members }
 *   post:
 *     tags: [Team Members]
 *     summary: Create a team member (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [section, name, role]
 *             properties:
 *               section: { type: string, enum: [trustee, management, advisory, state_leadership, district_member] }
 *               name: { type: string }
 *               role: { type: string }
 *               photo: { type: string }
 *               bio: { type: string }
 *               location: { type: string }
 *               unit: { type: string }
 *               order: { type: integer, default: 0 }
 *               stateSlug: { type: string, description: Required for state_leadership and district_member }
 *               districtName: { type: string, description: Required for district_member }
 *     responses:
 *       201: { description: Created }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/team-members/reorder:
 *   patch:
 *     tags: [Team Members]
 *     summary: Bulk-assign new positions (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [id, order]
 *                   properties:
 *                     id: { type: string }
 *                     order: { type: integer }
 *     responses:
 *       200: { description: Reordered }
 * /api/v1/team-members/{id}:
 *   get:
 *     tags: [Team Members]
 *     summary: Get a team member by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Team Members]
 *     summary: Update a team member (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Team Members]
 *     summary: Delete a team member (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
/**
 * Public reads (the whole point is that these render on public Team pages),
 * admin-only writes. Filter by ?section= / ?stateSlug= client-side.
 * Mounted at /api/v1/team-members. Results are sorted by the "order" field.
 *
 * PATCH /team-members/reorder takes { items: [{ id, order }] } to bulk-assign
 * new positions in one call (e.g. after a drag-and-drop reorder in the admin UI).
 */
export const teamMembersRouter = buildCrudRouter({
  repository: TeamMemberModel,
  createSchema: createTeamMemberSchema,
  updateSchema: updateTeamMemberSchema,
  publicRead: () => ({ where: "", params: [] }),
  reorder: true,
});
