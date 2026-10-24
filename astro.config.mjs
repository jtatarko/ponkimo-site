import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://ponkimo.com",
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [mdx(), sitemap()],
  image: {
    // Emits the CSS that makes <Image layout="constrained|full-width"> scale.
    responsiveStyles: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
