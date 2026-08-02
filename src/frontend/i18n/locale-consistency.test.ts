// 三语 locale key 一致性测试:zh-CN / en / zh-TW 的深度 key 集合必须完全相同,
// 且无空串值(防漏译/占位)。zh-TW 由 scripts/gen-zh-tw.mjs 从 zh-CN 构建期生成。
// 放在前端目录、走相对 import(vitest 未配 @ 别名);*.test.ts 已被 tsconfig 排除,不入 typecheck。
import { test, expect } from 'vitest';
import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';

type Tree = { [k: string]: string | Tree };

// 收集所有叶子 key 的点路径(如 settings.security.changePassword)。
function leafKeys(obj: Tree, prefix = '', out: string[] = []): string[] {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') leafKeys(v as Tree, key, out);
    else out.push(key);
  }
  return out;
}

function diff(a: string[], b: string[]) {
  return { onlyInA: a.filter((k) => !b.includes(k)), onlyInB: b.filter((k) => !a.includes(k)) };
}

const zhKeys = leafKeys(zhCN as Tree).sort();
const enKeys = leafKeys(en as Tree).sort();
const twKeys = leafKeys(zhTW as Tree).sort();

test('zh-CN 与 en 的 key 集合完全一致', () => {
  const d = diff(zhKeys, enKeys);
  expect(d.onlyInA, `仅 zh-CN 有:${d.onlyInA.join(', ')}`).toEqual([]);
  expect(d.onlyInB, `仅 en 有:${d.onlyInB.join(', ')}`).toEqual([]);
});

test('zh-CN 与 zh-TW 的 key 集合完全一致(gen-zh-tw 保结构)', () => {
  const d = diff(zhKeys, twKeys);
  expect(d.onlyInA, `仅 zh-CN 有:${d.onlyInA.join(', ')}`).toEqual([]);
  expect(d.onlyInB, `仅 zh-TW 有:${d.onlyInB.join(', ')}`).toEqual([]);
});

test('三语均无空串值(防漏译/占位)', () => {
  for (const [name, obj] of [['zh-CN', zhCN], ['en', en], ['zh-TW', zhTW]] as const) {
    const empties = leafKeys(obj as Tree).filter((k) => {
      const val = k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], obj);
      return typeof val === 'string' && val.trim() === '';
    });
    expect(empties, `${name} 存在空串 key:${empties.join(', ')}`).toEqual([]);
  }
});
