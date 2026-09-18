import { buildCrudRouter } from "../utils/crudRouter.js";
import { StateChapterModel } from "../models/stateChapter.model.js";
import { createStateChapterSchema, updateStateChapterSchema } from "../validators/stateChapters.validator.js";

/** Team > State Team overview. Mounted at /api/v1/state-chapters. */
export const stateChaptersRouter = buildCrudRouter({
  repository: StateChapterModel,
  createSchema: createStateChapterSchema,
  updateSchema: updateStateChapterSchema,
  publicRead: () => ({ where: "", params: [] }),
});
