#!/usr/bin/env node
// S3 互換ストレージ (Cloudflare R2 / AWS S3 / MinIO 等) を使ってビルド間で
// メディアキャッシュ (OGP 画像 / favicon / Notion 本文画像) を永続化する。
//
// `hydrate`: ストレージ → public/{ogp,notion-images}/ に展開
// `upload`:  .media-cache-dirty に列挙された画像を個別 PUT (CDN モード時のみ)
//             + 全件 tar.gz を PUT
//
// 必要な環境変数 (4 種すべて揃ったときのみ有効。揃わなければ no-op で exit 0):
//   S3_ENDPOINT           例) https://<account_id>.r2.cloudflarestorage.com
//   S3_ACCESS_KEY_ID
//   S3_SECRET_ACCESS_KEY
//   S3_BUCKET
// 任意:
//   S3_REGION             既定 "auto" (R2 はこの値で OK / AWS なら us-east-1 等)
//   S3_CACHE_KEY          tar.gz オブジェクトキー (旧 S3_OGP_CACHE_KEY を fallback)
//   S3_PUBLIC_BASE_URL    設定されているとき個別 PUT が走り CDN 配信モードになる

import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { AwsClient } from "aws4fetch";
import * as tar from "tar";

const PUBLIC_DIR = "public";
const CACHE_ENTRIES = ["ogp", "notion-images"];
const DIRTY_LIST = ".media-cache-dirty";
const DEFAULT_CACHE_KEY = "ogp-cache.tar.gz";
const HYDRATE_TMP = ".media-cache-hydrate.tar.gz";
const UPLOAD_TMP = ".media-cache-upload.tar.gz";
const PUT_CONCURRENCY = 4;

async function loadDotEnv() {
  let raw;
  try {
    raw = await readFile(".env", "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

function getS3Config() {
  const {
    S3_ENDPOINT,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
    S3_BUCKET,
    S3_REGION,
    S3_CACHE_KEY,
    S3_OGP_CACHE_KEY,
    S3_PUBLIC_BASE_URL,
  } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET) {
    return null;
  }
  return {
    endpoint: S3_ENDPOINT.replace(/\/+$/, ""),
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    bucket: S3_BUCKET,
    region: S3_REGION || "auto",
    cacheKey: S3_CACHE_KEY || S3_OGP_CACHE_KEY || DEFAULT_CACHE_KEY,
    publicBaseUrl: S3_PUBLIC_BASE_URL?.trim() || null,
  };
}

function makeClient(cfg) {
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: "s3",
  });
  const objectBaseUrl = `${cfg.endpoint}/${cfg.bucket}`;
  return { client, objectBaseUrl };
}

function contentTypeFor(objectKey) {
  switch (extname(objectKey).toLowerCase()) {
    case ".webp": return "image/webp";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".svg": return "image/svg+xml";
    case ".json": return "application/json";
    default: return "application/octet-stream";
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readDirtyList() {
  let raw;
  try {
    raw = await readFile(DIRTY_LIST, "utf8");
  } catch {
    return [];
  }
  const set = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set];
}

async function writeDirtyList(entries) {
  if (entries.length === 0) {
    await rm(DIRTY_LIST, { force: true });
    return;
  }
  await writeFile(DIRTY_LIST, entries.map((e) => `${e}\n`).join(""));
}

/**
 * tar.gz の中身から旧形式 / 新形式を判定する。
 * 新: トップレベルが `ogp/` または `notion-images/`
 * 旧: トップレベルが `meta/` や `{hash}.webp` (= 直接 public/ogp/ の中身が入っている)
 */
async function detectArchiveFormat(tarGzPath) {
  let isNew = false;
  await tar.list({
    file: tarGzPath,
    onentry: (entry) => {
      const p = entry.path.replace(/^\.\//, "");
      if (p.startsWith("ogp/") || p.startsWith("notion-images/")) {
        isNew = true;
      }
    },
  });
  return isNew ? "new" : "legacy";
}

async function hydrate() {
  const cfg = getS3Config();
  if (!cfg) {
    console.log("[media-cache] hydrate skipped (S3 env not configured)");
    return;
  }
  const { client, objectBaseUrl } = makeClient(cfg);
  const objectUrl = `${objectBaseUrl}/${cfg.cacheKey}`;

  let res;
  try {
    res = await client.fetch(objectUrl);
  } catch (err) {
    console.warn(`[media-cache] hydrate failed: ${err?.message ?? err}`);
    return;
  }

  if (res.status === 404) {
    console.log("[media-cache] hydrate: no cache on remote yet (404)");
    return;
  }
  if (!res.ok) {
    console.warn(`[media-cache] hydrate failed: HTTP ${res.status}`);
    return;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(PUBLIC_DIR, { recursive: true });
  await writeFile(HYDRATE_TMP, buf);
  try {
    const format = await detectArchiveFormat(HYDRATE_TMP);
    if (format === "new") {
      await tar.x({ file: HYDRATE_TMP, cwd: PUBLIC_DIR });
    } else {
      // 旧形式: tar.gz の中身を public/ogp/ 配下に展開
      const legacyCwd = "public/ogp";
      await mkdir(legacyCwd, { recursive: true });
      await tar.x({ file: HYDRATE_TMP, cwd: legacyCwd });
    }
    console.log(`[media-cache] hydrated ${buf.length} bytes (${format} format)`);
  } finally {
    await rm(HYDRATE_TMP, { force: true });
  }
}

async function putObject(client, objectBaseUrl, objectKey, body, contentType) {
  const res = await client.fetch(`${objectBaseUrl}/${objectKey}`, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${objectKey}`);
  }
}

async function uploadIndividualImages(client, objectBaseUrl, entries) {
  const imageEntries = entries.filter((e) => /\.(webp|png|jpe?g|gif|svg)$/i.test(e));
  if (imageEntries.length === 0) {
    return { uploaded: [], failed: [] };
  }

  const uploaded = [];
  const failed = [];
  let cursor = 0;

  async function worker() {
    while (cursor < imageEntries.length) {
      const i = cursor++;
      const objectKey = imageEntries[i];
      const localPath = `${PUBLIC_DIR}/${objectKey}`;
      try {
        const body = await readFile(localPath);
        await putObject(client, objectBaseUrl, objectKey, body, contentTypeFor(objectKey));
        uploaded.push(objectKey);
      } catch (err) {
        failed.push(objectKey);
        console.warn(`[media-cache] PUT failed: ${objectKey}: ${err?.message ?? err}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(PUT_CONCURRENCY, imageEntries.length) }, worker);
  await Promise.all(workers);
  return { uploaded, failed };
}

async function upload() {
  const cfg = getS3Config();
  if (!cfg) {
    console.log("[media-cache] upload skipped (S3 env not configured)");
    return;
  }

  const dirty = await readDirtyList();
  if (dirty.length === 0) {
    console.log("[media-cache] upload skipped (no new entries since last build)");
    return;
  }

  const { client, objectBaseUrl } = makeClient(cfg);

  // 1. 個別 PUT (CDN モード時のみ)
  if (cfg.publicBaseUrl) {
    const { uploaded, failed } = await uploadIndividualImages(client, objectBaseUrl, dirty);
    console.log(`[media-cache] individual PUT: ${uploaded.length} ok, ${failed.length} failed`);
    if (failed.length > 0) {
      // 失敗分のみ残す
      const remaining = new Set(dirty);
      for (const ok of uploaded) remaining.delete(ok);
      // 画像以外 (json 等) は処理対象外なので残しておく
      await writeDirtyList([...remaining]);
      console.warn("[media-cache] upload aborted; tar.gz PUT skipped for retry");
      return;
    }
  }

  // 2. 何かしらの cwd を必ず存在させる (空でも OK)
  for (const dir of CACHE_ENTRIES) {
    await mkdir(`${PUBLIC_DIR}/${dir}`, { recursive: true });
  }

  // 3. tar.gz 作成
  await tar.c(
    {
      file: UPLOAD_TMP,
      gzip: true,
      cwd: PUBLIC_DIR,
    },
    CACHE_ENTRIES,
  );

  const gz = await readFile(UPLOAD_TMP);
  await rm(UPLOAD_TMP, { force: true });

  try {
    await putObject(client, objectBaseUrl, cfg.cacheKey, gz, "application/gzip");
  } catch (err) {
    console.warn(`[media-cache] tar.gz upload failed: ${err?.message ?? err}`);
    return;
  }

  console.log(`[media-cache] uploaded tar.gz ${gz.length} bytes`);
  await rm(DIRTY_LIST, { force: true });

  // CDN モード時は Astro が dist/ にコピーした画像を取り除く
  // (Pages にアップロードされる成果物から外し、CDN 配信に統一する)
  if (cfg.publicBaseUrl) {
    for (const dir of CACHE_ENTRIES) {
      await rm(`dist/${dir}`, { recursive: true, force: true });
    }
    console.log("[media-cache] removed dist/{ogp,notion-images} (CDN mode)");
  }
}

await loadDotEnv();
const cmd = process.argv[2];
if (cmd === "hydrate") {
  await hydrate();
} else if (cmd === "upload") {
  await upload();
} else {
  console.error("Usage: node scripts/media-cache.mjs hydrate|upload");
  process.exit(1);
}
