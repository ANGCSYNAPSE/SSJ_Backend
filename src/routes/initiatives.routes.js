import { buildCrudRouter } from "../utils/crudRouter.js";
import { InitiativeModel } from "../models/initiative.model.js";
import { createInitiativeSchema, updateInitiativeSchema } from "../validators/initiatives.validator.js";

/** "Our Initiatives" home page cards. Mounted at /api/v1/initiatives. */
export const initiativesRouter = buildCrudRouter({
  repository: InitiativeModel,
  createSchema: createInitiativeSchema,
  updateSchema: updateInitiativeSchema,
  publicRead: () => ({ where: "", params: [] }),
});
