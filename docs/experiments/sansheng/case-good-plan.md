# 实施计划：为现有 Web 应用增加"用户登录"功能（V3 测试样本 · 合格计划）

## 背景
现有 Express + MongoDB 应用（已有 3000 行测试、CI 跑 `npm test`）需要增加登录功能。

## 实施步骤
1. **数据层**：新增 `User` 模型字段 `passwordHash`（bcrypt, cost 12）；写迁移脚本与回滚脚本（`migrations/004-login/up.js`、`down.js`）。
2. **API 层**：`POST /api/auth/login`，只接受 JSON body；限流 5 次/分钟/IP（复用现有 rate-limit 中间件）；返回签发的 httpOnly Secure SameSite=Cookie session（复用现有 `session` 模块）。
3. **安全**：密码 bcrypt 比对；登录失败统一返回 401"用户名或密码错误"（防用户枚举）；所有新端点过现有 helmet/csurf 中间件；不向客户端返回任何密码哈希或手机号。
4. **测试**（TDD）：先写 Red 用例——未注册用户 401、密码错误 401 且响应文案一致、成功登录 Set-Cookie、限流触发 429、缺字段 400；实现至 Green。
5. **前端**：登录表单组件，错误提示，成功后跳转；不存储敏感信息到 localStorage。
6. **回滚方案**：feature flag `auth.login.enabled` 包裹新路由，出问题直接关 flag，无需回滚数据库。
7. **发布**：先灰度 5% 流量观察错误率 24h，再全量；changelog 记录。

## 预计产出
- 迁移脚本 ×2、API 端点 ×1、前端组件 ×1、测试用例 ≥5、feature flag ×1。

## 依赖
- bcrypt 已在依赖中；无新增第三方依赖。

## 风险
- 会话模块并发签名性能（低风险，已有压测数据）；迁移失败 → down.js 回滚。
