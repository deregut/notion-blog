interface Env {
  ASSETS: Fetcher;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const accept = context.request.headers.get("Accept") ?? "";

  if (!accept.includes("text/markdown")) {
    return context.env.ASSETS.fetch(context.request);
  }

  const url = new URL(context.request.url);
  const mdUrl = new URL("/index.md", url.origin);
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
