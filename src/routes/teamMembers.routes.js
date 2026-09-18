import { buildCrudRouter } from "../utils/crudRouter.js";
import { TeamMemberModel } from "../models/teamMember.model.js";
import { createTeamMemberSchema, updateTeamMemberSchema } from "../validators/teamMembers.validator.js";

/**
 * Public reads (the whole point is that these render on public Team pages),
 * admin-only writes. Filter by ?section= / ?stateSlug= client-side.
 * Mounted at /api/v1/team-members.
 */
export const teamMembersRouter = buildCrudRouter({
  repository: TeamMemberModel,
  createSchema: createTeamMemberSchema,
  updateSchema: updateTeamMemberSchema,
  publicRead: () => ({ where: "", params: [] }),
});
