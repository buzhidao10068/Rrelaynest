-- 0007_base_url_scheme：回填存量 base_url 的协议头。纯数据迁移，无 DDL。
-- 背景：前端保存站点时曾主动剥掉 scheme（注释称「scrape 时按需补」，而后端从未补），
-- 于是界面新建的站点在库里是裸域名，爬取拼出 'astu.online/api/pricing' 被 fetch 拒收。
-- 契约已收敛为「库里只存绝对 URL」（见 src/shared/site-url.ts），此处把存量补齐。
--
-- 一律补 https://：裸域名已丢失原协议，无法恢复，https 是唯一合理默认；补错的（原本
-- http-only 的站点）用户可在界面改回，改回后走入口校验、此后不再丢协议。已记入 CHANGELOG。
-- 排除已带协议头的行：SQLite 的 LIKE 对 ASCII 大小写不敏感，故 'HTTPS://E.F' 也会被
-- NOT LIKE 'https://%' 排除，不会被二次加前缀（已实测）。
-- 排除空串：否则 'https://' || '' 得到一个没有主机名的 'https://'。
--
-- 执行方式：migrate.ts 把本文件按 ';' 拆成单条语句，在一个事务(batch)内顺序执行。

UPDATE sites SET base_url = 'https://' || base_url
 WHERE base_url <> ''
   AND base_url NOT LIKE 'http://%'
   AND base_url NOT LIKE 'https://%';
