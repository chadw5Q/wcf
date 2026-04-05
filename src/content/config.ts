import { defineCollection, z } from 'astro:content';

// Define the schema for blog posts
const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    updatedDate: z.date().optional(),
    heroImage: z.string().optional(),
    author: z.string(),
    tags: z.array(z.string()).optional(),
    featured: z.boolean().optional(),
  }),
});

// Define the schema for pages
const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    heroImage: z.string().optional(),
    sections: z.array(z.object({
      type: z.enum(['text', 'image', 'gallery', 'cta']),
      content: z.any(),
    })).optional(),
  }),
});

export const collections = {
  blog,
  pages,
}; 