import { defineConfig, envField } from "astro/config";
import { loadEnv } from "vite";
import vue from "@astrojs/vue";

const env = loadEnv(process.env.NODE_ENV ?? "", process.cwd(), "");

export default defineConfig({
  site: env.SITE_URL ?? "https://your-blog.pages.dev",
  output: "static",
  integrations: [vue()],
  env: {
    schema: {
      SITE_NAME: envField.string({
        context: "server",
        access: "public",
        optional: true,
        default: "Notion Blog",
      }),
      SITE_DESCRIPTION: envField.string({
        context: "server",
        access: "public",
        optional: true,
        default: "Notion數據庫Blog",
      }),
      SITE_AUTHOR: envField.string({
        context: "server",
        access: "public",
        optional: true,
        default: "Derek Gu",
      }),
      SITE_COPYRIGHT_YEAR: envField.string({
        context: "server",
        access: "public",
        optional: true,
        default: String(new Date().getFullYear()),
      }),
    },
  },
});
