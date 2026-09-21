-- Tags and SEO meta description for the blog post editor.
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS meta_description TEXT;
