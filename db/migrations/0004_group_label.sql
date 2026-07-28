-- 0004_group_label：站点「用户分组」标签。
-- group_label 是用户自定义的站点归类（主力/备用/测试…），与爬取所得的 site_groups
-- （上游分组倍率，另一个概念）互不相干。空/NULL = 未分组。
-- 只做 DDL；不回填（新列可空，老数据自然为 NULL = 未分组）。见前端 stores/sites.ts。
--
-- 执行方式：migrate.ts 把本文件按 ';' 拆成单条语句，在一个事务(batch)内顺序执行。

-- 站点用户分组标签（空/NULL = 未分组）。SQLite ADD COLUMN 默认 NULL，满足限制。
ALTER TABLE sites ADD COLUMN group_label TEXT;
