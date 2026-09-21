import { buildCrudRouter } from "../utils/crudRouter.js";
import { ProductModel } from "../models/product.model.js";
import { createProductSchema, updateProductSchema } from "../validators/products.validator.js";

/**
 * @openapi
 * /api/v1/products:
 *   get:
 *     tags: [Products]
 *     summary: List shop/prasad products
 *     description: Anonymous callers only see active products; admins see everything.
 *     responses:
 *       200: { description: List of products }
 *   post:
 *     tags: [Products]
 *     summary: Create a product (admin)
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
 *               price: { type: number, default: 0 }
 *               stock: { type: integer, default: 0 }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201: { description: Created }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Get a product by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Products]
 *     summary: Update a product (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Products]
 *     summary: Delete a product (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
/** Mounted at /api/v1/products. */
export const productsRouter = buildCrudRouter({
  repository: ProductModel,
  createSchema: createProductSchema,
  updateSchema: updateProductSchema,
  publicRead: () => ({
    where: "is_active = TRUE",
    params: [],
    isVisible: (product) => product.isActive,
  }),
});
