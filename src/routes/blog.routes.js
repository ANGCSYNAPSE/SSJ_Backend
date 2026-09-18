import { buildCrudRouter } from "../utils/crudRouter.js";
import { BlogCategoryModel, BlogPostModel } from "../models/blog.model.js";
import {
  createBlogCategorySchema,
  createBlogPostSchema,
  updateBlogCategorySchema,
  updateBlogPostSchema,
} from "../validators/blog.validator.js";

/** Mounted at /api/v1/blog-posts. */
export const blogPostsRouter = buildCrudRouter({
  repository: BlogPostModel,
  createSchema: createBlogPostSchema,
  updateSchema: updateBlogPostSchema,
  publicRead: () => ({
    where: "is_published = TRUE",
    params: [],
    isVisible: (post) => post.isPublished,
  }),
  statusActions: [
    { action: "publish", patch: { isPublished: true, publishedAt: new Date().toISOString() } },
    { action: "unpublish", patch: { isPublished: false } },
  ],
});

/** Mounted at /api/v1/blog-categories. */
export const blogCategoriesRouter = buildCrudRouter({
  repository: BlogCategoryModel,
  createSchema: createBlogCategorySchema,
  updateSchema: updateBlogCategorySchema,
  publicRead: () => ({ where: "", params: [] }),
});
