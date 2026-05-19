import type { APIRoute } from "astro";
import {
  getPublishedPostsWithBlocks,
  extractTextFromBlocks,
} from "@/lib/notion";
import { siteName, siteDescription } from "@/site";

export const GET: APIRoute = async ({ site }) => {
  const posts = await getPublishedPostsWithBlocks();

  const lines = [
    `# ${siteName}`,
    "",
    siteDescription,
    "",
    "## Posts",
    "",
    ...posts.map(({ meta, blocks }) => {
      const title = meta.title || extractTextFromBlocks(blocks, 50);
      const date = meta.firstPublishedAt.slice(0, 10);
      return `- ${date} [${title}](/posts/${meta.id}/)`;
    }),
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
