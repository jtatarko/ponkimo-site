import { defineCollection, reference, z } from "astro:content";
import { glob } from "astro/loaders";

const work = defineCollection({
  loader: glob({ pattern: "*.mdx", base: "./src/content/work" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      client: z.string(),
      /** Shorter title for the homepage card, if it differs. */
      cardTitle: z.string().optional(),
      description: z.string(),
      order: z.number(),
      /** Illustration beside the title; optional (sponsor-online opens on a video). */
      hero: image().optional(),
      heroAlt: z.string().default(""),
      /** Homepage card artwork: illustration in front, screenshot behind. */
      cardIllustration: image(),
      cardBackdrop: image().optional(),
      next: reference("work"),
      draft: z.boolean().default(false),
    }),
});

export const collections = { work };
