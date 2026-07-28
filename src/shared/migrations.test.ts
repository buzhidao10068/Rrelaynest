// 漂移检测：db/migrations/*.sql（人读 / wrangler 手动执行的镜像）必须与 migrations.ts
// 里内联的 SQL 逐语句一致。改一处漏改另一处，这里就红 —— 守住「单一真源」承诺。
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MIGRATIONS } from './migrations.js';
import { splitStatements } from './migrate.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../../db/migrations');

test('每个迁移的内联 SQL 与 db/migrations/*.sql 镜像逐语句一致', () => {
  for (const m of MIGRATIONS) {
    const file = resolve(MIGRATIONS_DIR, `${m.version}.sql`);
    const disk = readFileSync(file, 'utf-8');

    const inline = splitStatements(m.sql);
    const mirror = splitStatements(disk);

    // 逐条比较去注释、压平空白后的语句，避免格式差异误报。
    const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
    assert.deepEqual(
      mirror.map(flat),
      inline.map(flat),
      `迁移 ${m.version} 的 .sql 镜像与 migrations.ts 内联 SQL 不一致（改一处需同步另一处）`,
    );
  }
});
