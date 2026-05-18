#!/usr/bin/env node
// S3 互換ストレージ (Cloudflare R2 / AWS S3 / MinIO 等) 上の単一 tar.gz オブジェクトを
// 使って public/ogp/ をビルド間で永続化する。
//
// `hydrate`: ストレージ → public/ogp/ に展開
// `upload`:  public/ogp/.dirty があれば public/ogp/ を tar.gz 化して PUT
//
// 必要な環境変数 (4 種すべて揃ったときのみ有効。揃わなければ no-op で exit 0):
//   S3_ENDPOINT           例) https://<account_id>.r2.cloudflarestorage.com
//   S3_ACCESS_KEY_ID
//   S3_SECRET_ACCESS_KEY
//   S3_BUCKET
// 任意:
//   S3_REGION             既定 "auto" (R2 はこの値で OK / AWS なら us-east-1 等)
//   S3_OGP_CACHE_KEY      既定 "ogp-cache.tar.gz"

import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { AwsClient } from "aws4fetch";
import * as tar from "tar";

const OGP_DIR = "public/ogp";
const DIRTY_MARKER = "public/ogp/.dirty";
const DEFAULT_CACHE_KEY = "ogp-cache.tar.gz";
const HYDRATE_TMP = "public/ogp/.hydrate.tar.gz";
const UPLOAD_TMP = ".ogp-cache-upload.tar.gz";

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
    S3_OGP_CACHE_KEY,
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
    cacheKey: S3_OGP_CACHE_KEY || DEFAULT_CACHE_KEY,
  };
}

function makeClient(cfg) {
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: "s3",
  });
  const objectUrl = `${cfg.endpoint}/${cfg.bucket}/${cfg.cacheKey}`;
  return { client, objectUrl };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function hydrate() {
  const cfg = getS3Config();
  if (!cfg) {
    console.log("[ogp-cache] hydrate skipped (S3 env not configured)");
    return;
  }
  const { client, objectUrl } = makeClient(cfg);

  let res;
  try {
    res = await client.fetch(objectUrl);
  } catch (err) {
    console.warn(`[ogp-cache] hydrate failed: ${err?.message ?? err}`);
    return;
  }

  if (res.status === 404) {
    console.log("[ogp-cache] hydrate: no cache on remote yet (404)");
    return;
  }
  if (!res.ok) {
    console.warn(`[ogp-cache] hydrate failed: HTTP ${res.status}`);
    return;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(OGP_DIR, { recursive: true });
  await writeFile(HYDRATE_TMP, buf);
  try {
    await tar.x({ file: HYDRATE_TMP, cwd: OGP_DIR });
  } finally {
    await rm(HYDRATE_TMP, { force: true });
  }
  console.log(`[ogp-cache] hydrated ${buf.length} bytes (gz)`);
}

async function upload() {
  const cfg = getS3Config();
  if (!cfg) {
    console.log("[ogp-cache] upload skipped (S3 env not configured)");
    return;
  }

  if (!(await exists(DIRTY_MARKER))) {
    console.log("[ogp-cache] upload skipped (no new entries since last build)");
    return;
  }

  if (!(await exists(OGP_DIR))) {
    console.log("[ogp-cache] upload skipped (public/ogp does not exist)");
    return;
  }

  await tar.c(
    {
      file: UPLOAD_TMP,
      gzip: true,
      cwd: OGP_DIR,
      filter: (p) => basename(p) !== ".dirty",
    },
    ["."],
  );

  const gz = await readFile(UPLOAD_TMP);
  await rm(UPLOAD_TMP, { force: true });

  const { client, objectUrl } = makeClient(cfg);
  let res;
  try {
    res = await client.fetch(objectUrl, {
      method: "PUT",
      body: gz,
      headers: { "Content-Type": "application/gzip" },
    });
  } catch (err) {
    console.warn(`[ogp-cache] upload failed: ${err?.message ?? err}`);
    return;
  }

  if (!res.ok) {
    console.warn(`[ogp-cache] upload failed: HTTP ${res.status}`);
    return;
  }
  console.log(`[ogp-cache] uploaded ${gz.length} bytes (gz)`);
  await rm(DIRTY_MARKER, { force: true });
}

await loadDotEnv();
const cmd = process.argv[2];
if (cmd === "hydrate") {
  await hydrate();
} else if (cmd === "upload") {
  await upload();
} else {
  console.error("Usage: node scripts/ogp-cache.mjs hydrate|upload");
  process.exit(1);
}
