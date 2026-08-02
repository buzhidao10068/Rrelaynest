// 【自动生成 zh-TW】读 src/frontend/i18n/locales/zh-CN.json →
// opencc（简体 → 台湾正体 + 台湾惯用词 'twp'）→ 写 zh-TW.json。
//
// 运行：npm run i18n:tw（已接入 build 前置，zh-TW 永不过期）。
// 维护：只改 zh-CN.json（权威源）后重跑本脚本；请勿手改 zh-TW.json（会被覆盖）。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as OpenCC from 'opencc-js';

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(here, '../src/frontend/i18n/locales');
const srcPath = resolve(localesDir, 'zh-CN.json');
const outPath = resolve(localesDir, 'zh-TW.json');

// 简体 → 繁体（台湾正体 + 台湾惯用词）。
const convert = OpenCC.Converter({ from: 'cn', to: 'twp' });

// opencc 偶尔转不到位的台湾用词，人工兜底（转换后对整串做替换）。
const OVERRIDES = {
  賬: '帳', // 账→賬（一般繁体），台湾标准作「帳」：賬戶→帳戶、賬號→帳號
};

function convertValue(v) {
  if (typeof v === 'string') {
    let out = convert(v);
    for (const [from, to] of Object.entries(OVERRIDES)) out = out.split(from).join(to);
    return out;
  }
  if (Array.isArray(v)) return v.map(convertValue);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = convertValue(val);
    return o;
  }
  return v;
}

const src = JSON.parse(readFileSync(srcPath, 'utf-8'));
const out = convertValue(src);
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
console.log(`✓ 生成 zh-TW.json（${Object.keys(out).length} 个顶层命名空间，源 zh-CN.json）`);
