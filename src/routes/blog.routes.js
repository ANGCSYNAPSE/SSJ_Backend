import { buildCrudRouter } from "../utils/crudRouter.js";
import { BlogCategoryModel, BlogPostModel } from "../models/blog.model.js";
import {
  createBlogCategorySchema,
  createBlogPostSchema,
  updateBlogCategorySchema,
  updateBlogPostSchema,
} from "../validators/blog.validator.js";

/**
 * @openapi
 * /api/v1/blog-posts:
 *   get:
 *     tags: [Blog]
 *     summary: List blog posts
 *     description: Anonymous callers only see published posts; admins see everything.
 *     responses:
 *       200: { description: List of blog posts }
 *   post:
 *     tags: [Blog]
 *     summary: Create a blog post (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, slug, excerpt, content, author]
 *             properties:
 *               title: { type: string }
 *               slug: { type: string, pattern: '^[a-z0-9-]+$' }
 *               excerpt: { type: string }
 *               content: { type: string }
 *               coverImage: { type: string }
 *               categoryId: { type: string }
 *               author: { type: string }
 *               isPublished: { type: boolean, default: false }
 *               publishedAt: { type: string, format: date-time }
 *     responses:
 *       201: { description: Created }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/blog-posts/{id}:
 *   get:
 *     tags: [Blog]
 *     summary: Get a blog post by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Blog]
 *     summary: Update a blog post (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Blog]
 *     summary: Delete a blog post (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 * /api/v1/blog-posts/{id}/publish:
 *   patch:
 *     tags: [Blog]
 *     summary: Publish a blog post (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Published }
 *       404: { description: Not found }
 * /api/v1/blog-posts/{id}/unpublish:
 *   patch:
 *     tags: [Blog]
 *     summary: Unpublish a blog post (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Unpublished }
 *       404: { description: Not found }
 */
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

/**
 * @openapi
 * /api/v1/blog-categories:
 *   get:
 *     tags: [Blog]
 *     summary: List blog categories
 *     responses:
 *       200: { description: List of categories }
 *   post:
 *     tags: [Blog]
 *     summary: Create a blog category (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, slug]
 *             properties:
 *               title: { type: string }
 *               slug: { type: string, pattern: '^[a-z0-9-]+$' }
 *     responses:
 *       201: { description: Created }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/blog-categories/{id}:
 *   get:
 *     tags: [Blog]
 *     summary: Get a blog category by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Blog]
 *     summary: Update a blog category (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Blog]
 *     summary: Delete a blog category (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
/** Mounted at /api/v1/blog-categories. */
export const blogCategoriesRouter = buildCrudRouter({
  repository: BlogCategoryModel,
  createSchema: createBlogCategorySchema,
  updateSchema: updateBlogCategorySchema,
  publicRead: () => ({ where: "", params: [] }),
});
