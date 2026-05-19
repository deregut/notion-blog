interface Env {
  ASSETS: Fetcher;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const accept = context.request.headers.get("Accept") ?? "";

  if (!accept.includes("text/markdown")) {
    return context.env.ASSETS.fetch(context.request);
  }

  const url = new URL(context.request.url);
  const match = url.pathname.match(/^\/posts\/([^/]+)\/?$/);
  if (!match) {
    return context.env.ASSETS.fetch(context.request);
  }

  const postId = match[1];
  const mdUrl = new URL(`/posts/${postId}/content.md`, url.origin);
  const mdResponse = await context.env.ASSETS.fetch(mdUrl.toString());

  if (!mdResponse.ok) {
    return context.env.ASSETS.fetch(context.request);
  }

  return new Response(mdResponse.body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept",
    },
  });
};
