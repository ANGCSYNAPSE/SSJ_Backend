import { createSqlRepository } from "../db/sqlRepository.js";

export const BlogCategoryModel = createSqlRepository("blog_categories");
export const BlogPostModel = createSqlRepository("blog_posts", { jsonColumns: ["tags"] });
