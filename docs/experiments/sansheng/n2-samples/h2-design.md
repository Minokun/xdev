# 市场环境门控优化方案（突破策略）

> 日期：2026-06-26
> 状态：方案（待评审）
> 依据：长周期实证研究（2024-01 ~ 2026-06，2.5 年，3004 个历史突破信号）
> 研究脚本：`backend/scripts/research_tier_returns.py`、`research_walk_forward.py`、`research_market_regime.py`、`research_regime_longterm.py`
> 算法文档：`docs/breakout-algorithm-version-history.md` → 「市场环境三灯模型」章节

---

## 1. 背景与动机

线上"精选/标准/预选"三层框架按**信号质量**分层，但实证发现：
- 信号的**盈亏**主要由**大盘环境**驱动，不是个股二次筛选（精选池二次筛选样本外失效）。
- 现有的市场环境过滤器 `core/market_scanner/signal_filters.py::build_market_regime`
  采用 **MA20 > MA60 = bull = 可交易** 的逻辑，经 2.5 年验证**方向是反的**。

本方案基于实证数据，重新定义市场环境门控（正向 + 反向警示），并给出落地计划。

---

## 2. 关键实证结论

### 2.1 分层框架方向基本正确（但筛的是"质量"非"盈亏"）
- +3~10d 区间 elite > standard ≈ preselect 排序稳健（多环境下成立）。
- 但 elite 绝对收益受大盘环境主导，单靠分层不足以盈利。

### 2.2 现有 MA20>MA60「bull」门控是反的（2.5 年确认）
ELITE close-to-close +10d：

| trend（MA20 vs MA60） | +10d 收益 | 胜率 |
|---|---|---|
| bull（现"可交易"） | **-2.19%** | 35.3% |
| neutral | -0.52% | 42.4% |
| bear（现"该回避"） | **+2.56%** | 50.6% |

> 解释：MA20>MA60 是滞后信号，确认"牛"时往往已是趋势晚期，突破追高被均值回归吃掉。

### 2.3 `close > MA20` 是稳健的正向门控（逐年一致）
ELITE close-to-close +10d，逐年：

| 年份 | 大盘 > MA20 | 大盘 < MA20 |
|---|---|---|
| 2024 | +0.49%（win 43.9%） | **-3.89%**（win 29.4%） |
| 2025 | -0.02%（win 39.5%） | **-4.23%**（win 37.5%） |
| 2026 | -0.15%（win 45.2%） | **-2.65%**（win 33.9%） |

> 每一年"大盘破 MA20"都稳定亏 3~4%。`close > MA20` 主要作用是**避开破位环境**。

### 2.4 2×2 四象限：精确定位最佳与最差（核心结论）
ELITE，trend × above20，close-to-close +10d / 10日内最高 +10d：

| 象限 | 含义 | close+10d | 胜率 | max+10d | n |
|---|---|---|---|---|---|
| **bear + above20** | 跌后刚收复MA20=**反弹早期** | **+4.19%** | **55.2%** | 17.23% | 125 |
| neutral + above20 | 盘整转上 | +0.49% | 44.4% | 12.09% | 189 |
| bull + above20 | 上涨晚期（追高） | -1.72% | 35.7% | 9.31% | 333 |
| neutral + below20 | 盘整破位 | -3.41% | 36.4% | 9.13% | 66 |
| **bull + below20** | **顶部破位** | **-3.73%** | 33.7% | 8.94% | 101 |
| bear + below20 | 深跌中 | -4.03% | 32.3% | 13.25% | 31 |

**最佳 = "bear/neutral + 收复MA20"（反弹早期）；最差 = 任何"跌破MA20"环境。**

### 2.5 真正的 alpha 在退出，不在入场
ELITE + above20：close-to-close +10d ≈ **+0.07%**，但 10 日内最高 +10d = **+11.65%（92% 命中正峰值）**。
> 信号是可靠的**短线脉冲触发器**，死拿到固定日收盘会被回吐。盈利关键是**冲高止盈**。

---

## 3. 三灯模型：指标定义与判断逻辑

### 3.1 两个输入指标

#### 输入 A：`close vs MA20`（短期温度计）
- **MA20** = 沪深300（sh.000300）过去 20 个交易日收盘价的简单移动平均 = "近一个月市场平均成本"
- **判断**：`今天收盘价 > MA20` → 短期偏强（▲上）；`< MA20` → 短期偏弱（▼下）
- **特性**：反应快，当天翻。回答"此刻大盘是强还是弱"。
- **含义**：价格站上近一个月均价 → 买方占优；跌破 → 卖方占优。

#### 输入 B：`MA20 vs MA60`（中期趋势阶段）
- **MA60** = 过去 60 个交易日收盘价的简单移动平均 = "近三个月市场平均成本"
- **判断**（含 1% 缓冲带，避免均线交叉附近抖动）：
  - `MA20 > MA60 × 1.01` → **bull**（中期已涨了一段）
  - `MA20 < MA60 × 0.99` → **bear**（中期已跌了一段）
  - `|MA20 - MA60| / MA60 < 1%` → **neutral**（中期方向不明）
- **特性**：反应慢，滞后约 40 天。回答"过去几个月大方向是涨还是跌"。
- **含义**：MA20 在 MA60 上方 → 近一个月均价比近三个月高 → 中期趋势向上。但因为滞后，确认"bull"时往往已到趋势中后段。

> **为什么 bull 反而最差？** MA20>MA60 是"已经涨完了"的确认，不是"要涨了"的预言。等它确认 bull 时大部分涨幅已走完，此时突破信号买到的是趋势末端的追高点。反过来 bear + close 刚收复 MA20 = 跌后反弹早期，空间最大。

### 3.2 三灯判断规则

两个输入组合成三个状态：

```
                    ┌─────────────────────────────────────────┐
                    │           B = 中期阶段                   │
                    │   bear      neutral      bull           │
    ┌───────────────┼───────────┬──────────┬──────────────┐
    │ A = 短期温度  │           │          │              │
    │  上(close>MA20)│  🟢 GREEN │ 🟢 GREEN │  🟡 YELLOW   │
    │  下(close<MA20)│  🔴 RED   │  🔴 RED  │  🔴 RED      │
    └───────────────┴───────────┴──────────┴──────────────┘
```

| 灯 | 条件 | 覆盖象限 | 预期 elite +10d |
|---|---|---|---|
| 🟢 **GREEN（顺势早期）** | close>MA20 且 MA20≤MA60×1.01 | bear+above20、neutral+above20 | **+1.96%**（n=314） |
| 🟡 **YELLOW（上涨晚期）** | close>MA20 且 MA20>MA60×1.01 | bull+above20 | -1.72%（n=333） |
| 🔴 **RED（破位警示）** | close<MA20（任意 B） | 所有 below20 | **-3.71%**（n=198） |

简化判断：**先看 close 在 MA20 上还是下 → 决定红绿；再看 MA20 在 MA60 上还是下 → 区分绿和黄。**

### 3.3 每个灯的市场含义与操作指导

#### 🟢 GREEN — "反弹早期"：最安全的建仓窗口

**市场含义**：大盘之前跌了一段时间（MA20≤MA60），跌到低点后开始反弹，某天收盘价重新站上 20 日均线。此时位置低、空间大、卖压已释放、均线刚收复信心刚恢复——弹簧被压到最低点刚松手开始弹，跟着弹力道最大。

**操作指导**：
- ✅ 正常建仓，精选池(elite)信号可全仓位介入
- ✅ 标准池(standard)信号可半仓介入
- ⚠️ 持有期锚定 10 个交易日左右（信号 +10d 达峰，+20d 衰减）
- ⚠️ 仍需设止损（GREEN 不等于"持有即盈利"，close+10d 仅 +1.96%）

#### 🟡 YELLOW — "上涨晚期"：追高危险，需控制

**市场含义**：大盘已经涨了好几个月（MA20 远超 MA60），价格还在 MA20 之上看起来"很健康"，但位置高、空间小、获利盘多一有风吹草动就跑——弹簧已弹到最高点附近，再追上去大概率马上回落。

**操作指导**：
- ⚠️ 减半仓位，仅做最强信号（elite 且 score 最高）
- ⚠️ 收紧止盈（冲高即走，不要死拿）
- ⚠️ 收紧止损（跌破信号日收盘价即止损）
- ❌ 避免 preselect 信号（高位弱信号最容易亏）

#### 🔴 RED — "破位警示"：停手 + 保护持仓

**市场含义**：不管中期是牛是熊，收盘价跌破了 20 日均线 = 短期卖方占主导。很多大跌都从跌破 MA20 开始——突破信号在弱市中大多是假突破，突破后很快被打回来。

**操作指导**：
- ❌ **停止新建仓**（不产出新买入信号，或把 elite/standard 全部降级）
- ⚠️ **对现有持仓发反向警示**：建议收紧止损、考虑减仓
- ⚠️ 已持仓的按原止损纪律执行，不要因为"等反弹"而拖延
- 📌 如果是 **bull + below20（顶部破位）**：威胁最大，从高位回落破位，优先减仓

### 3.4 反向警示信号（RED）的精确定义

- **主警示**：`CSI300 close < MA20` —— 三年稳定 -3~4%，是最干净、参数最少的风险信号。
- **强化警示（顶部破位）**：`close < MA20 且 MA20 > MA60`（bull+below20）—— -3.73%，从高位回落破位，对持仓威胁最大。
- **用途**：(a) 暂停发出新买入信号；(b) 对现有持仓推送"市场转弱"提示，建议收紧止损/减仓。

### 3.5 门控效果

**ELITE，close+10d：**
- 不门控（全部）：**-0.81%**
- 仅 GREEN 建仓：**+1.96%**，保留 37% 信号
- → 入场端门控带来 **约 +2.77 个百分点** 的绝对提升

---

## 4. 三灯模型与突破算法的配合机制

### 4.1 核心问题

三灯模型（大盘环境）和突破算法（个股信号）是**两个正交维度**：
- **突破算法**回答："这只股票现在好不好？"→ 产出 elite/standard/preselect
- **三灯模型**回答："现在该不该买股票？"→ 产出 green/yellow/red

两者如何配合决定了系统的实际行为。分析了三种模式后选定 **C 模式（分层降级 + 信号产出与推荐分离）**。

### 4.2 模式对比与选型

| 模式 | 做法 | 优点 | 缺点 | 选型 |
|---|---|---|---|---|
| A. 纯门控 | RED 停产出, YELLOW 照出+提示 | 简单 | RED 丢历史数据; YELLOW 无实质变化 | ❌ |
| B. 阈值联动 | 三灯改算法阈值 (volume/pressure 等) | 算法自适应 | 多套参数, 回测不可比, 复杂 | ❌ |
| **C. 分层降级** | **触发不变, 叠加环境因子到 tier/score** | **历史完整, 可回测, 渐进收紧** | 需新增字段 | **✅** |

### 4.3 选定方案：二维分层 + 信号产出与推荐分离

#### 原则：产出不中断,推荐看环境

1. **信号产出不变**：`should_trigger` 逻辑完全不动,任何环境下都照常计算并记录信号 → 保证历史数据完整,可持续回测验证。
2. **分层叠加环境因子**：在 `classify_signal_tier` 之后,根据三灯状态对 tier 和 score 做调整（不改 `classify_signal_tier` 本身,而是在 scanner 层叠加）。
3. **前端按组合状态展示推荐度**：用户看到的是"环境×个股"的组合推荐度。

#### 二维分层矩阵

|  | 🟢 GREEN | 🟡 YELLOW | 🔴 RED |
|---|---|---|---|
| **elite** | 🟢精选-正常（全仓） | 🟡精选-降级（半仓） | 🔴精选-冻结（不建议） |
| **standard** | 🟢标准-正常（半仓） | 🟡标准-降级（观望） | 🔴标准-冻结 |
| **preselect** | 🟢预选-正常（小仓位） | 🟡预选-降级（不建议） | 🔴预选-冻结 |

#### 环境因子调整规则

| 三灯 | regime_action | tier 调整 | score 调整 | 前端展示 |
|---|---|---|---|---|
| 🟢 GREEN | `normal` | 不变 | 不变 | 正常卡片 |
| 🟡 YELLOW | `downgrade` | elite → 降级展示为 standard | -10 | 黄色边框 + "追高风险" |
| 🔴 RED | `frozen` | 不变（保留原 tier） | -20 | 灰色卡片 + 冻结图标 + "不建议建仓" |

> **为什么 YELLOW 降级 elite？** YELLOW 时 elite +10d = -1.72%,接近 standard 在 GREEN 时的表现。降级不是否定个股质量,而是说"好股票在坏环境里也难赚钱"。

> **为什么 RED 不改 tier 而用 frozen？** tier 反映个股质量,改了就丢失"这只股票本身好不好"的信息。用 `regime_action=frozen` 叠加,既保留个股判断,又明确环境风险。

#### 数据库变更

`scan_results` 表新增 3 个字段（`schema.py` + `schema.sql`）：

```sql
regime_state        String DEFAULT ''    -- green / yellow / red
regime_action       String DEFAULT ''    -- normal / downgrade / frozen / not_recommended
regime_score_adjust Float64 DEFAULT 0   -- 环境因子对 score 的调整值
```

#### 后端实现流程（`scanner.py`）

```
1. 算法照常运行：
   should_trigger → classify_signal_tier → calculate_score
   （以上完全不改动）

2. 查询当日三灯状态（调用 signal_filters.build_market_regime）

3. 根据三灯状态叠加环境因子：
   GREEN:  regime_action = "normal",        regime_score_adjust = 0
   YELLOW: regime_action = "downgrade",     regime_score_adjust = -10
           如果 tier == elite, 前端展示时降级为 standard
   RED:    regime_action = "frozen",        regime_score_adjust = -20
           前端展示时所有 tier 标记为冻结

4. 持久化时写入 regime_state / regime_action / regime_score_adjust
```

#### 为什么 RED 仍然产出信号（不硬门控）？

1. **历史数据完整性**：保留信号 + 标记冻结,后续可分析"冻结的信号实际表现如何",持续验证门控有效性。
2. **用户判断权**：系统给信息和建议,不替用户决定。用户可能有自己的判断（如"这次破位是假信号"）,应能看到信号但知道风险。
3. **渐进式收紧**：先标记冻结,观察 2-4 周假信号率,再决定是否升级为硬门控（`allowed_regimes` 配置已预留）。

#### 前端展示变化

信号卡片新增两个维度：
- **个股 tier 标签**（精选/标准/预选）—— 不变,反映个股质量
- **环境推荐度标签**（🟢可建仓 / 🟡减仓追高 / 🔴冻结不建议）—— 新增,反映环境风险

RED 时：卡片变灰 + 冻结图标 + "当前市场破位,不建议建仓"提示
YELLOW 时：黄色边框 + "追高风险,建议减半仓"提示
GREEN 时：正常卡片

---

## 5. 界面展示需求

### 4.1 展示位置

在 `MarketScanner.tsx` 页面，**Tab 导航下方、两个 Tab 内容区的最上方**，插入一条全宽的"市场环境"横幅。两个 Tab（开始扫描 / 扫描历史）都显示，作为全局市场环境总览。

> 用户原话："市场扫描不是最前面有这个指标嘛，就在这里给我展示出来" —— 指的是历史页顶部的"历史收盘统计"和"实时价格统计"卡片区上方。

### 4.2 横幅内容

横幅包含四部分：

**① 状态灯（左侧，醒目）**
- 大号圆点 + 文字：🟢 顺势早期 / 🟡 上涨晚期 / 🔴 破位警示
- 颜色：GREEN=绿色、YELLOW=琥珀色、RED=红色
- 下方小字：更新时间（如"2026-06-25 收盘"）

**② 指标数值（中间，数据）**
- 沪深300 收盘价 / MA20 / MA60
- close vs MA20 偏离度（如 "+2.89%" 绿色 / "-3.41%" 红色）
- MA20 vs MA60 偏离度（如 "spread +1.82%"）

**③ 操作指导（右侧，文字）**
- 根据当前灯显示对应的操作建议（见 3.3 节）
- RED 时显示反向警示文案（加粗 + 红色背景）
- 文案示例：
  - 🟢："大盘站上近一月均线且中期未追高，精选池信号可正常建仓，持有期约10天"
  - 🟡："大盘已涨一段仍在线上，追高风险偏大——减半仓、收紧止盈、仅做最强信号"
  - 🔴："大盘跌破近一月均线，短期卖方主导——停止新建仓，持仓请收紧止损/考虑减仓"

**④ 三灯历史趋势色带（底部，全宽）**
- 最近 60 个交易日的 regime_state 色带（绿/黄/红三色横条）
- 每个色块代表一个交易日，颜色对应当天的三灯状态
- 色块 hover 显示日期 + regime_state
- 最新一天有白色竖线标记
- 色带下方显示首日/中间日/末日日期
- 左侧小标签"近60日"
- 让用户一眼看到市场环境的变迁历史（如"最近从 RED 翻 GREEN"或"持续 YELLOW 已 20 天"）

### 4.3 RED 状态的特殊 UI

- 横幅背景变为红色渐变（`bg-red-500/10`）
- "开始扫描" Tab：扫描按钮上方显示红色警示条"⚠ 当前市场处于破位状态，新信号胜率历史均值 -3.71%，建议暂停建仓"
- "扫描历史" Tab：统计卡片区上方同样显示红色警示条
- 不强制禁用扫描按钮（用户仍可手动扫描），但给出明确风险提示

### 4.4 数据来源

- 新增后端 API：`GET /api/market-scanner/market/regime`
  - 返回：`{ state, csi300_close, ma20, ma60, vs_ma20_pct, spread_pct, trend, updated_at, guidance, history }`
  - `state` ∈ `"green" | "yellow" | "red" | "unknown"`
  - `guidance` 为对应操作指导文案（后端生成，前端直接展示）
  - `history`：最近 60 个交易日的三灯历史，每条 `{ date, close, ma20, ma60, regime_state }`，`regime_state` 为新三灯值（green/yellow/red/unknown），不含旧 `regime` 字段。供前端绘制历史趋势色带
  - 数据源：ClickHouse `stock_daily` WHERE `code='sh.000300'`，取最近 365 天计算 MA 后取最新 60 天
  - 缓存：Redis key `market_scanner:regime:current`，TTL 300 秒（5 分钟，日线数据无需实时）
- 前端：`useQuery` 轮询，`refetchInterval: 300_000`（5 分钟，与后端缓存对齐），`staleTime: 120_000`

### 4.5 响应式

- 桌面端：横幅三栏横排（灯 | 指标 | 指导）+ 底部全宽历史趋势色带
- 移动端：纵排（灯+指标一行，指导文案一行，色带一行）

---

## 6. 优化计划（分阶段，按优先级）

### 阶段一：修正市场环境门控 + 算法配合 + 界面展示（高优先 / 低风险）

**目标**：把 `build_market_regime` 的语义从"MA20>MA60=bull才交易"改为三灯模型，实现与突破算法的二维分层配合，并在前端展示。

> **审查反馈回应（C-H1/C-H3）：** Phase 1 拆分为两个子阶段，降低集成风险：
> - **Phase 1a（后端 + 横幅）**：算法重构 + API + 横幅展示 → 验证用户是否觉得环境信息有用
> - **Phase 1b（卡片叠加层）**：信号卡片环境推荐度 + score 调整 + tier 降级展示 → 在 1a 验证后快速跟进

#### Phase 1a：后端门控重构 + 横幅展示

**后端任务**：
1. 重构 `backend/core/market_scanner/signal_filters.py`：
   - `build_market_regime` **新增** `regime_state ∈ {green, yellow, red, unknown}` 列，基于 `close vs MA20` + `MA20 vs MA60`，保留 ma20/ma60/close 原始列。
   - **兼容策略（E-H1）**：保留旧 `regime`（bull/neutral/bear）列**不删除**，旧 `apply_market_filter` 的 `allowed_regimes` 参数仍接受 bull/neutral/bear 值（向后兼容回测脚本）。新增 `apply_market_filter_v2` 接受 green/yellow/red 值，作为新默认门控。旧函数标记 `# DEPRECATED: use apply_market_filter_v2` 但不删除。
   - `apply_market_filter_v2` 的 `allowed_regimes` 默认改为 `('green',)`（可配 `('green','yellow')`）。
   - **边界处理（E-H2）**：当 MA20/MA60 无法计算（数据不足 60 个交易日）时，`regime_state = 'unknown'`，`apply_market_filter_v2` 默认放行 unknown（保守策略：数据不足时不阻断信号）。
2. 新增 API `GET /api/market-scanner/market/regime`（见第 5 节"界面展示需求 → 4.4 数据来源"）。
   - **端点策略（E-M4）**：替换现有 `/market-regime` 端点。旧端点保留 30 天兼容期，返回 deprecation header `Deprecation: true`，响应体增加 `deprecated: true` 字段。30 天后移除。
3. 参数走配置（`methods/config.py`）：`regime_ma_short=20`、`regime_ma_long=60`、
   `regime_bull_ratio=1.01`、`allowed_regimes`。
4. **算法配合（见第 4 节）**：
   - `scan_results` 表新增 3 字段：`regime_state`、`regime_action`、`regime_score_adjust`。
   - **迁移模式（E-H3）**：表名为 `scan_results`（复数）。使用 ClickHouse `ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS` 模式（与 `schema.py` line 38-41 一致），同时在 `schema.sql` 中更新建表语句。迁移为**纯加列**操作，无数据丢失风险，回滚仅需 `ALTER TABLE ... DROP COLUMN`（可选，加列不影响现有查询）。
   - **查询策略（E-H4）**：regime 在每次扫描开始时**查询一次**（从 `build_market_regime` 返回的 DataFrame 中取扫描日期对应行），缓存在扫描上下文中，所有信号共享同一个 regime 状态。**不逐信号查询**。
   - `scanner.py` 信号产出流程：在 `classify_signal_tier` + `calculate_score` 之后，用缓存的 regime 状态叠加环境因子（regime_action / regime_score_adjust），写入 scan_results。
   - `should_trigger` 和 `classify_signal_tier` **不改动**——环境因子是叠加层，不侵入算法核心。
   - `persistence.py` 的 `_build_scan_row` 增加新字段的持久化。
5. 回填脚本：对历史 scan_results 补算 regime_state（根据 scan_time 当日 CSI300 数据），不回填 regime_action（历史信号保持原样，只标记环境）。
   - **数据缺口处理（E-M3）**：scan_time 当日无 CSI300 数据时，使用最近的前一个交易日 CSI300 数据。仍找不到则 regime_state 留空（NULL），并在日志中记录跳过原因。

**前端任务（Phase 1a）**：
6. 在 `MarketScanner.tsx` Tab 导航下方新增"市场环境"横幅组件（见第 5 节 + 视觉设计规范）。
7. RED 状态特殊样式 + 警示条。
8. 响应式布局。

**Phase 1a 验收**：
- 历史回放下，GREEN 段 elite +10d 显著 > YELLOW > RED（复现本文 2.4 数字）。
- 新增的 regime_state/regime_action 字段正确写入 scan_results。
- 前端横幅正确显示当前三灯状态 + 指标数值 + 操作指导。
- RED 状态下警示条正确展示。
- 旧 `/market-regime` 端点仍可访问（兼容期），返回 deprecation header。
- MA20/MA60 不足 60 日时返回 `regime_state='unknown'`，不报错。

#### Phase 1b：信号卡片环境推荐度叠加层

**前端任务（Phase 1b）**：
9. 信号卡片新增环境推荐度标签（🟢/🟡/🔴），RED 时卡片变灰+冻结图标，YELLOW 时黄色边框。
10. YELLOW 时 elite 降级展示为 standard（前端展示层，后端 tier 不变）。

**Phase 1b 验收**：
- 信号卡片正确显示环境推荐度标签。
- RED 状态下卡片冻结样式正确展示（灰色+冻结图标）。
- YELLOW 状态下 elite 卡片展示为 standard 样式 + 黄色边框。

### 阶段二：退出策略优化（高优先 / 中风险）
**目标**：把"92% 信号会冲高（峰值 +11.65%）"兑现成实际收益。

任务：
1. 用回测引擎（`run_strategy_backtest` + `EXIT_PRESETS`）系统性网格搜索退出预设：
   - 止盈档（take_profit_levels）、移动止损回撤（trailing_drawdown_pct）、最大持有天数。
   - 目标函数：在 GREEN 段信号上最大化"已实现"收益（非 max，而是按预设退出后的真实收益）。
2. 把最优退出预设作为突破策略默认，并在买入对话框/持仓监控里给出建议止盈/止损位。

验收：GREEN 段信号按最优退出预设回测，实际收益显著高于"固定持有10日收盘"（基线 ≈ +1.96%）。

### 阶段三：持仓联动警示（中优先 / 低风险）
1. 持仓监控页：RED 触发时对持仓推送"市场转弱"提醒（复用现有 sell-signal 推送通道）。
2. 买入对话框：显示当前市场状态灯 + 建议仓位（GREEN=全仓 / YELLOW=半仓 / RED=禁止）。

### 阶段四（可选 / 低优先）：个股二次筛选
- 当前样本外无效，**暂不实施**。待积累更多跨周期数据后，再在 GREEN 段内部研究是否能加 alpha。

---

## 7. 验证与灰度

1. **离线回放**：阶段一/二上线前，用 2024-2026 历史复现本文指标，确认门控与退出预设有效。
2. **影子运行**：先只展示市场状态与反向警示，不改变信号产出，观察 2~4 周与真实走势是否吻合。
3. **灰度切换**：默认 `allowed_regimes=('green','yellow')`（保守保留信号量），观察后再考虑收紧到 `('green',)`。
4. **监控**：在 tier_stats / live summary 基础上，按 regime_state 维度统计实盘前向收益，持续校验。

---

## 8. 风险与局限

- **数据周期有限**：2.5 年、约 3000 信号，且 A 股 2024-2026 以震荡/结构性行情为主。大牛市/大熊市下结论可能漂移。
- **幸存者偏差**：universe 取当前 active 股票，退市股被剔除，长期收益偏乐观。
- **日线粒度**：盘中止盈/止损先后无法判定，退出回测对同日触发的处理有近似。
- **门控是择时**：择时天然有滞后与假信号（破位后又快速收回）。需配合影子运行观察假信号率。
- **`close>MA20` 仍非"持有即盈利"**：GREEN 段 close+10d 仅 +1.96%，必须叠加退出策略（阶段二）才有实际意义。

---

## 9. 一句话总结

> 把市场环境门控从「MA20>MA60 才交易」（反的）改成 **三灯模型**——
> 🟢 收复MA20且非晚期＝建仓，🟡 上涨晚期＝减仓，🔴 跌破MA20＝停手并反向警示；
> 在扫描页顶部展示三灯状态 + 指标数值 + 操作指导，让用户一眼看清当前市场环境；
> 同时把重心从"入场二次筛选"转到"冲高止盈的退出策略"，这才是收益由负转正的关键。

---

## Intent Contract

> **按 Phase 1a / 1b 拆分（C-H1 修复）**：Phase 1a = 后端门控 + 横幅展示；Phase 1b = 卡片叠加层。

### Phase 1a — Must Have

- **IC-1a-1**: 用户在 MarketScanner 页面顶部能看到当前市场环境三灯状态（green/yellow/red）+ 沪深300 收盘价/MA20/MA60 数值 + 操作指导文案 + 最近 60 个交易日的三灯历史趋势色带
- **IC-1a-2**: 后端 `build_market_regime` 新增 `regime_state ∈ {green, yellow, red, unknown}` 列，基于 `close vs MA20` + `MA20 vs MA60`（含 1% 缓冲带），保留旧 `regime`（bull/neutral/bear）列兼容
- **IC-1a-3**: 新增 API `GET /api/market-scanner/market/regime` 返回三灯状态 + 指标数值 + guidance 文案 + 60 天 history（含 regime_state），Redis 缓存 5 分钟；旧 `/market-regime` 端点保留 30 天兼容期
- **IC-1a-4**: `scan_results` 表新增 `regime_state` 字段并正确持久化（Phase 1a 只加 regime_state，regime_action/regime_score_adjust 在 Phase 1b 加）
- **IC-1a-5**: scanner 在扫描开始时查询一次当日三灯状态并缓存，写入 scan_results 的 `regime_state` 字段；`should_trigger` 和 `classify_signal_tier` 不改动
- **IC-1a-6**: RED 状态下扫描页显示红色警示条"当前市场处于破位状态，建议暂停建仓"，但不强制禁用扫描按钮
- **IC-1a-7**: 回填脚本对历史 scan_results 补算 `regime_state`（根据 scan_time 当日 CSI300 数据）

### Phase 1b — Must Have（1a 验证后跟进）

- **IC-1b-1**: `scan_results` 表新增 `regime_action`、`regime_score_adjust` 字段
- **IC-1b-2**: scanner 叠加环境因子（GREEN=normal, YELLOW=downgrade+score-10, RED=frozen+score-20）
- **IC-1b-3**: 前端信号卡片显示环境推荐度标签（🟢可建仓/🟡减仓追高/🔴冻结不建议），RED 时卡片变灰+冻结图标，YELLOW 时黄色边框

### Must Not（约束方向，不约束深度）

- **IC-N1**: 本次不改动 `should_trigger` 和 `classify_signal_tier` 的核心逻辑——环境因子是叠加层，不侵入算法核心
- **IC-N2**: 本次不实施阶段二（退出策略优化）和阶段三（持仓联动警示）——阶段一先完成门控修正+界面展示
- **IC-N3**: 本次不实施个股二次筛选（阶段四）——样本外已验证无效，暂不实施
- **IC-N4**: 本次不将 RED 升级为硬门控（停止产出信号）——先标记冻结+观察假信号率，保留用户判断权
- **IC-N5**: 本次不改动 `classify_signal_tier` 的 tier 定义本身——YELLOW 时 elite 降级展示为 standard 是前端展示层行为，后端 tier 字段不变

### Done Means — Phase 1a

- **IC-D1**: 调用 `GET /api/market-scanner/market/regime` 返回 200 + JSON 包含 `state`/`csi300_close`/`ma20`/`ma60`/`vs_ma20_pct`/`spread_pct`/`trend`/`updated_at`/`guidance`/`history` 字段；`history` 为数组，每条含 `date`/`close`/`ma20`/`ma60`/`regime_state`
- **IC-D2**: `build_market_regime` 对沪深300历史数据计算的三灯状态与设计文档 3.2 节规则一致（close>MA20 且 MA20≤MA60×1.01 → green，含 bear 和 neutral 两种 trend；close>MA20 且 MA20>MA60×1.01 → yellow；close<MA20 → red）；含 1% 缓冲带边界测试（MA20/MA60 比值 = 1.01 时归 green，> 1.01 时归 yellow）
- **IC-D3a**: `regime_state` 字段在 ClickHouse `scan_results` 表中存在（ALTER TABLE ADD COLUMN IF NOT EXISTS 成功），新扫描的信号记录包含 regime_state 值
- **IC-D4**: 前端 MarketScanner 页面加载后横幅组件渲染，显示三灯状态+数值+指导+60 天历史趋势色带；RED 时横幅红色背景+警示条；YELLOW 时黄色边框；色带每个色块 hover 显示日期+regime_state
- **IC-D6**: 回填脚本执行后，历史 scan_results 中 `regime_state` 字段非空率 > 95%（少数 scan_time 当日及邻近日均无 CSI300 数据的允许为空）
- **IC-D7**: 现有扫描功能回归正常——`should_trigger` 产出信号量不因 regime_state 写入而减少

### Done Means — Phase 1b

- **IC-D3b**: `regime_action`、`regime_score_adjust` 字段在 `scan_results` 表中存在，新扫描信号包含值
- **IC-D5**: 信号卡片在 RED 环境下显示灰色+冻结图标，YELLOW 环境下显示黄色边框+追高风险提示
- **IC-D8**: RED 仍产出信号但标记 frozen，信号量不因环境因子叠加而减少（regime_action 是叠加层非门控层）

---

## 视觉设计规范（Visual Design Specs）

> 约束：沿用现有暗色主题（slate-900 底 + crypto-gold 强调色）、Tailwind CSS + shadcn/ui、lucide-react 图标。
> 现有 tier 配色：elite=amber、standard=cyan、preselect=fuchsia。新增环境层不覆盖 tier 配色，而是叠加状态层。

### 1. 三灯横幅组件（MarketRegimeBanner）

**替换**：现有 `frontend/src/components/scanner/MarketRegimeIndicator.tsx`（旧 bull/bear/neutral 三态）→ 重构为 `MarketRegimeBanner.tsx`（新 green/yellow/red 三态）。

**位置变更**：从 Tab 导航**上方**移到 Tab 导航**下方、两个 Tab 内容区最上方**（用户原话要求）。

#### 1.1 三态配色系统

```typescript
const REGIME_THEME = {
  green: {
    // 顺势早期 — 翠绿，传达"安全/建仓"
    dot:          'bg-emerald-400',
    dotGlow:      'shadow-[0_0_12px_rgba(52,211,153,0.6)]',
    icon:         TrendingUp,  // lucide-react
    iconColor:    'text-emerald-300',
    label:        '顺势早期',
    labelColor:   'text-emerald-200',
    border:       'border-emerald-400/35',
    bgGradient:   'from-emerald-500/12 via-emerald-900/6 to-slate-900/40',
    accentBar:    'bg-emerald-400',
    valuePositive:'text-emerald-300',
  },
  yellow: {
    // 上涨晚期 — 琥珀色，传达"警告/追高风险"
    dot:          'bg-amber-400',
    dotGlow:      'shadow-[0_0_12px_rgba(251,191,36,0.6)]',
    icon:         AlertTriangle,  // lucide-react
    iconColor:    'text-amber-300',
    label:        '上涨晚期',
    labelColor:   'text-amber-200',
    border:       'border-amber-400/40',
    bgGradient:   'from-amber-500/12 via-amber-900/6 to-slate-900/40',
    accentBar:    'bg-amber-400',
    valuePositive:'text-amber-300',
  },
  red: {
    // 破位警示 — 红色，传达"危险/停手"
    dot:          'bg-red-500',
    dotGlow:      'shadow-[0_0_16px_rgba(239,68,68,0.7)]',
    icon:         ShieldAlert,  // lucide-react
    iconColor:    'text-red-400',
    label:        '破位警示',
    labelColor:   'text-red-300',
    border:       'border-red-500/45',
    bgGradient:   'from-red-500/15 via-red-900/8 to-slate-900/40',
    accentBar:    'bg-red-500',
    valuePositive:'text-red-400',
  },
  unknown: {
    dot:          'bg-slate-500',
    dotGlow:      '',
    icon:         Minus,
    iconColor:    'text-slate-400',
    label:        '数据加载中',
    labelColor:   'text-slate-400',
    border:       'border-white/10',
    bgGradient:   'from-slate-700/20 to-slate-900/40',
    accentBar:    'bg-slate-500',
    valuePositive:'text-slate-300',
  },
} as const
```

#### 1.2 横幅布局（桌面端三栏 + 底部历史趋势色带）

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [accent bar: 左侧 3px 竖条，颜色随灯]                                    │
│                                                                         │
│  ① 状态灯              ② 指标数值                 ③ 操作指导              │
│  ┌──────────┐    ┌──────────────────┐    ┌──────────────────────────┐   │
│  │ ● 大圆点  │    │ 沪深300  4,021.56│    │ 🟢 大盘站上近一月均线且   │   │
│  │ 🟢 顺势   │    │ MA20     3,908.72│    │    中期未追高，精选池信号 │   │
│  │   早期    │    │ MA60     3,845.30│    │    可正常建仓，持有期10天 │   │
│  │ 06-25收盘 │    │ vs MA20  +2.89%  │    │                          │   │
│  │           │    │ spread   +1.65%  │    │ [刷新按钮]                │   │
│  └──────────┘    └──────────────────┘    └──────────────────────────┘   │
│                                                                         │
│  ④ 三灯历史趋势色带（最近 60 个交易日）                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 🟢🟢🟢🟡🟡🔴🔴🟢🟢🟢🟢🟢🟢🟡🟡🟡🟢🟢🟢🟢🔴🔴🟡🟢🟢🟢...  │  │
│  │ 06-01                    06-15                    06-25           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **外层容器**：`rounded-2xl border ${border} bg-gradient-to-r ${bgGradient} px-5 py-4 relative overflow-hidden`
- **左侧 3px 竖条**：`absolute left-0 top-0 bottom-0 w-[3px] ${accentBar}`
- **① 状态灯**：`flex flex-col items-start gap-1`
  - 大圆点：`h-3.5 w-3.5 rounded-full ${dot} ${dotGlow} animate-pulse`
  - 图标+标签行：`flex items-center gap-2` → `<Icon className="h-5 w-5 ${iconColor}" />` + `<span className="text-base font-bold ${labelColor}">${label}</span>`
  - 更新时间：`text-[11px] text-slate-500`（如"2026-06-25 收盘"）
- **② 指标数值**：`flex flex-col gap-1 text-xs`
  - 每行：`<span className="text-slate-500">标签</span> <span className="font-mono font-semibold text-slate-200">数值</span>`
  - `vs MA20` 偏离度：正值用 `${valuePositive}`，负值用 `text-red-400`
  - `spread` (MA20 vs MA60)：同上
- **③ 操作指导**：`flex-1 text-sm leading-6 text-slate-300`
  - guidance 文案由后端返回，前端直接展示
  - **文本溢出处理（D-H3）**：`max-w-md line-clamp-3`（最多 3 行，超出截断 + 原生 `title` 属性显示全文）；移动端 `max-w-full line-clamp-4`。使用原生 `title` 属性而非 tooltip 组件（项目未安装 @radix-ui/react-tooltip）
  - RED 时：`text-red-200 font-medium`，外加 `rounded-lg bg-red-500/10 px-3 py-2` 背景框
- **分隔线**：三栏之间用 `w-px h-12 bg-white/8`
- **刷新按钮**：`ml-auto` 右上角，`rounded-md p-1 text-slate-500 hover:text-slate-300`
- **④ 三灯历史趋势色带**：三栏下方全宽，`mt-3 pt-3 border-t border-white/5`
  - 色带主体：`flex h-5 rounded-md overflow-hidden gap-px`，每个交易日一个色块 `flex-1`
  - 色块颜色（降低透明度，与暗色主题一致，不喧宾夺主）：green=`bg-emerald-500/40`，yellow=`bg-amber-500/40`，red=`bg-red-500/40`，unknown=`bg-slate-600/30`
  - 色块 hover：原生 `title` 属性显示日期 + regime_state（如"2026-06-20 顺势早期"）
  - 色块 `aria-label`：每个色块 `aria-label="{date} {state_label}"`（如"2026-06-20 顺势早期"），确保屏幕阅读器可读
  - 最新一天色块加右侧白色竖线标记：`border-r border-white/40`
  - 色带下方时间轴：`flex justify-between text-[10px] text-slate-600 mt-1`，显示首日、中间日、末日日期
  - 色带左侧标签行：`flex items-center gap-2 text-[10px] text-slate-500 mb-1`
    - "近60日" 文字
    - 三个图例小圆点 + 文字：`🟢顺势` `🟡追高` `🔴破位`（`h-2 w-2 rounded-full` + 对应颜色 + `text-[10px]`）
  - **移动端适配（D-H2）**：`< 640px` 时色带高度降为 `h-4`，色块数仍为 60（`flex-1` 自适应宽度），gap 改为 `0`（去除间距以增加色块宽度）；hover 不可用时点击色块弹出原生 `title`（移动浏览器长按可触发）
  - **部分历史处理（E-M1）**：history 不足 60 天时，按实际天数渲染（`flex-1` 自适应），左侧标签改为"近{N}日"；history 为空数组时整个色带区域不渲染

#### 1.3 移动端布局（纵排）

- `flex-col` 堆叠
- ① + ② 合并为一行（灯在左，数值在右，`flex-wrap`）
- ③ 操作指导独占一行
- ④ 历史趋势色带独占一行（全宽，与桌面端一致）
- 间距：`gap-2`，padding 减为 `px-3 py-3`
- 断点：`sm:flex-row`（≥640px 横排）

#### 1.4 交互状态

| 状态 | 表现 |
|---|---|
| loading | `animate-pulse` 骨架屏：灰色横条 + "加载市场环境..." |
| error | 可点击重试按钮 + RefreshCw 图标 + "加载失败，点击重试" |
| success | 正常三栏渲染 |
| RED 特殊 | 整个横幅外加 `shadow-[0_0_30px_rgba(239,68,68,0.15)]` 红色辉光 |

#### 1.5 数据轮询

- `useQuery` + `refetchInterval: 300_000`（5 分钟，与后端 Redis 缓存对齐）
- `staleTime: 120_000`（2 分钟内不重复请求）
- 错误时 `retry: 2`，`retryDelay: 5000`

### 2. 信号卡片环境推荐度叠加层

**不新建组件**，而是在现有 `getResultCardClassName` / `getTierBadgeClassName` 等函数中叠加 `regime_action` 维度。

#### 2.1 环境推荐度标签（新增 Badge）

在 tier badge 旁边新增一个环境 badge：

```typescript
const getRegimeBadgeClassName = (regimeAction: string) => {
  if (regimeAction === 'frozen') {
    return 'inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300'
  }
  if (regimeAction === 'downgrade') {
    return 'inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-400/12 px-2 py-0.5 text-[10px] font-semibold text-amber-200'
  }
  return 'inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200'
}

const getRegimeBadgeContent = (regimeAction: string) => {
  if (regimeAction === 'frozen') return { icon: ShieldAlert, text: '不建议建仓' }
  if (regimeAction === 'downgrade') return { icon: AlertTriangle, text: '追高风险' }
  return { icon: CheckCircle2, text: '可建仓' }
}
```

**布局**：tier badge 和 regime badge 并排，`flex items-center gap-1.5`：
```tsx
<div className="flex items-center gap-1.5">
  <div className={getTierBadgeClassName(result)}>{getTierLabel(result)}</div>
  {result.regime_action && (
    <div className={getRegimeBadgeClassName(result.regime_action)}>
      <RegimeIcon className="h-3 w-3" />
      {regimeBadgeContent.text}
    </div>
  )}
</div>
```

#### 2.2 卡片整体样式叠加（RED 灰色冻结 / YELLOW 黄边）

修改 `getResultCardClassName`，在 tier 基础样式上叠加 regime 层：

```typescript
const getResultCardClassName = (result: ScanResultItem) => {
  // 1. 原有 tier 基础样式（不变）
  const tierBase = result.signal_tier === 'elite'
    ? 'group relative overflow-hidden rounded-2xl border border-amber-300/45 bg-[radial-gradient(...)] shadow-[...] hover:border-amber-200/70 hover:shadow-[...]'
    : result.signal_tier === 'standard'
      ? '...cyan...'
      : '...fuchsia...'

  // 2. 叠加 regime 层
  if (result.regime_action === 'frozen') {
    // RED: 灰色滤镜 + 降低饱和度 + 冻结辉光
    return `${tierBase} opacity-60 grayscale-[0.4] border-red-500/30 shadow-[0_0_0_1px_rgba(239,68,68,0.15),0_8px_30px_rgba(239,68,68,0.08)]`
  }
  if (result.regime_action === 'downgrade') {
    // YELLOW: 叠加琥珀色边框光
    return `${tierBase} border-amber-400/50 shadow-[0_0_0_1px_rgba(251,191,36,0.12),0_8px_30px_rgba(251,191,36,0.1)]`
  }
  return tierBase
}
```

#### 2.3 RED 冻结图标覆盖

RED 时在卡片右上角叠加一个冻结图标水印：

```tsx
{result.regime_action === 'frozen' && (
  <div className="pointer-events-none absolute top-2 right-2 z-10">
    <ShieldAlert className="h-5 w-5 text-red-400/70" />
  </div>
)}
```

#### 2.4 RED 警示条（扫描按钮上方）

在"开始扫描" Tab 和"扫描历史" Tab 内容区最上方（横幅下方）：

```tsx
{regimeData?.state === 'red' && (
  <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
    <ShieldAlert className="h-4 w-4 shrink-0" />
    <span>当前市场处于破位状态，新信号历史均值 -3.71%，建议暂停建仓</span>
  </div>
)}
```

### 3. 响应式断点

| 断点 | 横幅 | 卡片 |
|---|---|---|
| `< 640px` (mobile) | 纵排：灯+数值一行，指导一行，色带一行 | 单列，regime badge 在 tier badge 下方 |
| `≥ 640px` (sm) | 横排三栏 + 底部色带 | 单列，badge 并排 |
| `≥ 768px` (md) | 横排三栏，间距加大 + 底部色带 | 双列网格 |
| `≥ 1024px` (lg) | 同上 | 三列网格 |

### 4. 无障碍

- 状态灯不仅用颜色区分，同时有文字标签（"顺势早期"/"上涨晚期"/"破位警示"）→ 色盲友好
- regime badge 有 `aria-label`：`aria-label="市场环境：不建议建仓"`
- RED 警示条用 `role="alert"`
- 状态灯区域：`aria-label="当前市场环境：{label}，更新于 {updatedAt}"`
- 刷新按钮：`aria-label="刷新市场环境数据"`
- 指标数值区域：`aria-label="沪深300收盘价 {close}，MA20 {ma20}，MA60 {ma60}"`
- 历史趋势色带：`aria-label="近60日三灯历史趋势，当前状态：{state}"`
- **null 值处理（D-M4）**：当 ma20/ma60/close 为 null 时，对应行不渲染（`{value !== null && (...)}`），不留空行；history 为空数组时色带区域不渲染
- 对比度：emerald-200/amber-200/red-300 on slate-900 均满足 WCAG AA（≥4.5:1），实现时统一使用 -200 色号

### 5. 动画

- 状态灯圆点：`animate-pulse`（持续呼吸，2s 周期）
- 横幅入场：`animate-in fade-in slide-in-from-top-2 duration-500`
- RED 警示条入场：`animate-in fade-in slide-in-from-bottom-1 duration-300`
- 卡片 regime 叠加层：无额外动画（避免干扰已有 hover 动画）
- 数据刷新时：圆点短暂 `animate-ping` 一次（通过 key change 触发）
