import { defineCollection, z } from 'astro:content';

// Define the schema for products
const products = defineCollection({
  type: 'data',
  schema: z.object({
    id: z.number(),
    name: z.string(),
    description: z.string(),
    price: z.number(),
    image: z.string(),
    category: z.enum(['evergreen', 'deciduous', 'flowering']),
    height: z.string(),
    sunlight: z.string(),
    water: z.string(),
    inStock: z.boolean(),
    featured: z.boolean().optional(),
    careInstructions: z.string().optional(),
    growthRate: z.string().optional(),
  }),
});

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
  products,
  blog,
  pages,
}; 