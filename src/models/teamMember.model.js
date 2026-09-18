import { createSqlRepository } from "../db/sqlRepository.js";

export const TeamMemberModel = createSqlRepository("team_members", {
  defaultOrderBy: '"order" ASC, created_at ASC',
});
