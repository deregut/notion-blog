import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hashUrl, OGP_META_DIR, recordMediaCacheEntry, type OgpMeta } from "./ogp";

function metaPathForUrl(url: string): string {
  return join(OGP_META_DIR, `${hashUrl(url)}.json`);
}

export async function readMetaCache(url: string): Promise<OgpMeta | null> {
  try {
    const raw = await readFile(metaPathForUrl(url), "utf8");
    return JSON.parse(raw) as OgpMeta;
  } catch {
    return null;
  }
}

export async function writeMetaCache(meta: OgpMeta): Promise<void> {
  try {
    await mkdir(OGP_META_DIR, { recursive: true });
    await writeFile(metaPathForUrl(meta.url), JSON.stringify(meta));
    await recordMediaCacheEntry(`ogp/meta/${hashUrl(meta.url)}.json`);
  } catch {
    // キャッシュ書き込み失敗は致命的でないので無視
  }
}
