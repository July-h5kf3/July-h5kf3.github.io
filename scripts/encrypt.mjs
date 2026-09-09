#!/usr/bin/env node
/*
 * 构建后加密受保护文章的正文。
 *
 * 工作方式：
 *   1. Hugo 把受保护文章的正文渲染进 <template id="locked-payload" data-source="...">。
 *      <template> 内容浏览器不渲染、不加载图片，只是承载明文供本步骤加密。
 *   2. 本脚本遍历 public/ 下所有 HTML，找到该 <template>，用 data-source 定位源文件、
 *      读取 front matter 里的 password，用 AES-256-GCM(PBKDF2-SHA256, 310k) 加密正文。
 *   3. 把整个 <template>...</template> 替换为 <script id="locked-cipher"> 密文。
 *
 * 结果：部署产物里没有任何正文明文；读者输入正确邀请码后由浏览器 WebCrypto 解密。
 *
 * 用法：node scripts/encrypt.mjs [--public public] [--content content]
 * 口令来源：优先文章 front matter 的 `password`；否则回退环境变量 LOCK_PASSWORD。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ITERATIONS = 310000;

function parseArgs(argv) {
  const args = { public: "public", content: "content" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--public") args.public = argv[++i];
    else if (a === "--content") args.content = argv[++i];
  }
  return args;
}

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile() && e.name.endsWith(".html")) out.push(full);
  }
  return out;
}

// 从 front matter 文本里取 password 值（支持可选引号）。
function passwordFromSource(src) {
  const m = src.match(/^---\s*\n([\s\S]*?)\n---/);
  const block = m ? m[1] : src;
  const line = block.match(/^\s*password\s*:\s*(.+?)\s*$/m);
  if (!line) return null;
  let v = line[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

function encryptBody(plaintext, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iter: ITERATIONS,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ct: Buffer.concat([ct, tag]).toString("base64"),
  };
}

// 定位 <template id="locked-payload" ...> ... </template>，返回 {start,end,inner,attrs}。
function findTemplate(html) {
  const open = html.match(/<template\b[^>]*\bid\s*=\s*["']?locked-payload["']?[^>]*>/i);
  if (!open) return null;
  const openTag = open[0];
  const startIdx = open.index;
  const innerStart = startIdx + openTag.length;
  const closeIdx = html.indexOf("</template>", innerStart);
  if (closeIdx === -1) return null;
  return {
    start: startIdx,
    end: closeIdx + "</template>".length,
    inner: html.slice(innerStart, closeIdx),
    openTag,
  };
}

function attr(tag, name) {
  const re = new RegExp(
    name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
    "i"
  );
  const m = tag.match(re);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

async function main() {
  const args = parseArgs(process.argv);
  const files = await walk(args.public);
  let processed = 0;
  const done = [];

  for (const file of files) {
    let html = await fs.readFile(file, "utf8");
    if (!html.includes("locked-payload")) continue;

    const tpl = findTemplate(html);
    if (!tpl) {
      throw new Error(`发现 locked-payload 标记但无法解析 <template>：${file}`);
    }
    const source = attr(tpl.openTag, "data-source");
    if (!source) {
      throw new Error(`<template> 缺少 data-source 属性：${file}`);
    }
    const srcPath = path.join(args.content, source);
    let password = process.env.LOCK_PASSWORD || null;
    try {
      const srcText = await fs.readFile(srcPath, "utf8");
      const fmPwd = passwordFromSource(srcText);
      if (fmPwd) password = fmPwd;
    } catch {
      // 源文件读不到时，仅在有 LOCK_PASSWORD 时才可继续。
    }
    if (!password) {
      throw new Error(
        `找不到文章口令（front matter password 或 LOCK_PASSWORD）：${source}`
      );
    }

    const payload = encryptBody(tpl.inner, password);
    const cipherScript =
      '<script type="application/json" id="locked-cipher">' +
      JSON.stringify(payload) +
      "</script>";
    html = html.slice(0, tpl.start) + cipherScript + html.slice(tpl.end);

    // 兜底自检：替换后的 HTML 不应再包含 template 标记或密钥/口令。
    if (html.includes("locked-payload")) {
      throw new Error(`加密后仍残留 locked-payload：${file}`);
    }
    if (password.length && html.includes(password)) {
      throw new Error(`加密后产物疑似残留明文口令：${file}`);
    }

    await fs.writeFile(file, html, "utf8");
    processed++;
    done.push({ file, source });
  }

  if (processed === 0) {
    console.log("[encrypt] 未发现受保护文章（locked-payload），跳过。");
  } else {
    console.log(`[encrypt] 已加密 ${processed} 篇受保护文章：`);
    for (const d of done) console.log(`  - ${d.source}  ->  ${d.file}`);
  }
}

main().catch((err) => {
  console.error("[encrypt] 失败：", err.message);
  process.exit(1);
});
