# 续接说明 / HANDOFF

> 新终端接手本任务时，先读这个文件，再读 `prd.md`。
> 生成时间：2026-07-20 会话中断（用户关机）。任务处于 **Phase 1 规划中**，尚未 `task.py start`。

## 一句话现状

在本项目根（当前空 trellis 脚手架）里，用 trellis 流程**重做**一个已存在但用户不满意的
中转站管理面板；参考基线是废弃版 relaynest（功能已基本完整）。当前卡在与用户确认需求，
最关键的未决问题是**技术栈方向**（见 prd.md Open Questions #1）。

## 关键路径速查

- 参考基线（旧实现，功能完整）：废弃版 relaynest（同机另一目录，未纳入本仓库）
  - 后端 `src/worker/`：index.ts / routes.ts / scraper.ts / scrape-runner.ts / auth.ts / crypto.ts / types.ts
  - 前端 `src/frontend/`：App.vue / Login.vue / Dashboard.vue / SiteEditor.vue / api.ts / main.ts
  - `schema.sql`（D1 表结构）、`wrangler.toml`、`README.md`（含部署步骤）
- 本任务目录：`.trellis/tasks/07-20-relaynest-rebuild/`
- trellis 工作流说明：`.trellis/workflow.md`；技术栈 spec：`.trellis/spec/`
- 开发者身份：`buzhidao10068`（已初始化）

## 已完成的工作

1. 定位了三个相关目录：`废弃/relaynest`（旧实现）、`Rrelaynest`（重做目标，当前目录）、
   `PocketPilot`（无关的另一个项目，勿混淆）。
2. 通读了废弃版全部后端源码 + schema + 前端 Dashboard/api.ts，事实已记进 `prd.md` Background。
3. 建立 trellis 任务 `07-20-relaynest-rebuild`（当前 session 已激活为 active task）。
4. 写好 `prd.md`（含完整背景 + 3 个阻塞性 Open Questions）。

## 下一步（新终端从这里继续）

仍在 Phase 1，用 `trellis-brainstorm` 技能继续访谈。**必须先解决 prd.md 的 Open Question #1（技术栈方向）**，
这是所有后续设计的分叉点。按 brainstorm 规则：一次只问一个问题，带上推荐答案。

建议的第一个问题：向用户确认技术栈方向 (a) 照搬废弃版 vs (b) 对齐 Trellis spec 重写。推荐 (a)。

解决 Open Questions 后：
- 复杂任务需补 `design.md` + `implement.md`，再 curate `implement.jsonl` / `check.jsonl`（各至少一条真实 spec 条目）
- 用户 review 通过后才 `python ./.trellis/scripts/task.py start 07-20-relaynest-rebuild`

## 恢复 active task 指针（如新终端识别不到）

```bash
cd H:/学习/Github/Rrelaynest
python ./.trellis/scripts/task.py current --source   # 确认是否已指向本任务
# 若为 none，重新激活（注意：start 会把状态翻成 in_progress，规划未完成时不要用 start）
# 仅需重新指向、且规划已完成时才 start；否则靠读本文件恢复上下文即可继续 brainstorm
```
