import type { APIRoute, GetStaticPaths } from "astro";
import { getPublishedPosts, getPageById } from "@/lib/notion";
import { enrichBlocksWithOgp } from "@/lib/enrichBlocks";
import { blocksToMarkdown } from "@/lib/blocksToMarkdown";

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getPublishedPosts();
  return posts.map((post) => ({
    params: { id: post.id },
  }));
};

export const GET: APIRoute = async ({ params, site }) => {
  const data = await getPageById(params.id!);
  if (!data) {
    return new Response("Not found", { status: 404 });
  }

  const { meta, blocks } = data;
  await enrichBlocksWithOgp(blocks);

  const frontMatter = [
    "---",
    `title: ${JSON.stringify(meta.title)}`,
    `date: "${meta.firstPublishedAt}"`,
    `tags: [${meta.tags.map((t) => JSON.stringify(t.name)).join(", ")}]`,
    `url: "${new URL(`/posts/${meta.id}/`, site).href}"`,
    "---",
  ].join("\n");

  const markdown = blocksToMarkdown(blocks);
  const body = `${frontMatter}\n\n${markdown}`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
