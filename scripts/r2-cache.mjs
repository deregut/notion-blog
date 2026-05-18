#!/usr/bin/env node
// R2 上の単一 tar.gz オブジェクトを使った OGP キャッシュの同期スクリプト。
// `hydrate`: R2 → public/ogp/ に展開
// `upload`:  public/ogp/.dirty があれば public/ogp/ を tar.gz 化して R2 に PUT
//
// 4 種の R2 env が揃っていない場合は何もせず終了する (ローカル開発ではこれが正常パス)。

import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { AwsClient } from "aws4fetch";
import * as tar from "tar";

const OGP_DIR = "public/ogp";
const DIRTY_MARKER = "public/ogp/.dirty";
const R2_KEY = "ogp-cache.tar.gz";
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

function getR2Config() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    return null;
  }
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  };
}

function makeClient(cfg) {
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: "auto",
    service: "s3",
  });
  const baseUrl = `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}`;
  return { client, baseUrl };
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
  const cfg = getR2Config();
  if (!cfg) {
    console.log("[r2-cache] hydrate skipped (R2 env not configured)");
    return;
  }
  const { client, baseUrl } = makeClient(cfg);

  let res;
  try {
    res = await client.fetch(`${baseUrl}/${R2_KEY}`);
  } catch (err) {
    console.warn(`[r2-cache] hydrate failed: ${err?.message ?? err}`);
    return;
  }

  if (res.status === 404) {
    console.log("[r2-cache] hydrate: no cache on R2 yet (404)");
    return;
  }
  if (!res.ok) {
    console.warn(`[r2-cache] hydrate failed: HTTP ${res.status}`);
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
  console.log(`[r2-cache] hydrated ${buf.length} bytes (gz)`);
}

async function upload() {
  const cfg = getR2Config();
  if (!cfg) {
    console.log("[r2-cache] upload skipped (R2 env not configured)");
    return;
  }

  if (!(await exists(DIRTY_MARKER))) {
    console.log("[r2-cache] upload skipped (no new entries since last build)");
    return;
  }

  if (!(await exists(OGP_DIR))) {
    console.log("[r2-cache] upload skipped (public/ogp does not exist)");
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

  const { client, baseUrl } = makeClient(cfg);
  let res;
  try {
    res = await client.fetch(`${baseUrl}/${R2_KEY}`, {
      method: "PUT",
      body: gz,
      headers: { "Content-Type": "application/gzip" },
    });
  } catch (err) {
    console.warn(`[r2-cache] upload failed: ${err?.message ?? err}`);
    return;
  }

  if (!res.ok) {
    console.warn(`[r2-cache] upload failed: HTTP ${res.status}`);
    return;
  }
  console.log(`[r2-cache] uploaded ${gz.length} bytes (gz)`);
  await rm(DIRTY_MARKER, { force: true });
}

await loadDotEnv();
const cmd = process.argv[2];
if (cmd === "hydrate") {
  await hydrate();
} else if (cmd === "upload") {
  await upload();
} else {
  console.error("Usage: node scripts/r2-cache.mjs hydrate|upload");
  process.exit(1);
}
