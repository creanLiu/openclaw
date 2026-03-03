# 项目开发提示词 - 有客AI智能客户管理系统

## 项目概述

开发一个面向二手车商的 AI 智能客户管理系统（产品名：有客）。系统包含两个前端和一个后端：

1. **企业微信自建应用**：车商在个人微信中通过企微通道与 AI 助手对话，完成语音录入客户、接收跟进提醒、生成文案等快捷操作
2. **微信小程序**：车商和买家的结构化操作界面，包含客户管理、车源管理、AI 工具箱、数据看板等
3. **后端 API 服务**：统一的业务逻辑层，同时服务企微和小程序

---

## 技术栈

### 后端
- **运行时**：Node.js 22+
- **语言**：TypeScript（严格模式，避免 any）
- **Web 框架**：Fastify
- **ORM**：Drizzle ORM
- **数据库**：PostgreSQL 16
- **缓存**：Redis 7
- **AI API**：DeepSeek（主力），智谱 GLM（备用）
- **定时任务**：node-cron
- **部署**：Docker Compose

### 前端（小程序）
- **框架**：UniApp + Vue3 + TypeScript
- **UI 组件库**：uni-ui 或 uv-ui
- **状态管理**：Pinia
- **网络请求**：封装 uni.request

### 企微对接
- **企业微信自建应用**：通过回调 URL 接收消息，通过 API 发送消息
- **消息加解密**：使用企微官方加解密方案（AES）
- **微信插件**：使应用在个人微信中可见

---

## 系统角色

系统有三种用户角色：

### 1. 平台管理员（我自己）
- 管理所有租户（商户）
- 查看全平台数据（用量、营收、租户状态）
- 管理 Prompt 模板
- 暂时通过直接操作数据库管理，MVP 不需要管理后台界面

### 2. 商户员工（车商老板或销售）
- 通过企微自建应用或小程序登录
- 管理自己店铺的客户和车源
- 使用 AI 工具（文案、话术、脚本）
- 接收跟进提醒和客户匹配通知

### 3. C 端买家（看车的人）
- 通过小程序浏览车源（不需要登录即可浏览）
- 在线咨询（需要微信授权登录）
- 预约看车（需要登录）
- 买家的咨询和行为自动进入商户的客户管理系统

---

## 多租户架构

- 所有数据共用一个 PostgreSQL 数据库
- 通过 `tenant_id` 字段做行级数据隔离
- API 层中间件自动从 JWT 中提取 tenant_id，注入到所有数据库查询
- 禁止跨租户数据访问

---

## 数据库设计

### tenants 表（租户/商户）
```sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,               -- 店铺名称
    industry VARCHAR(50) DEFAULT 'used_car',   -- 行业
    owner_name VARCHAR(50),                    -- 老板姓名
    owner_phone VARCHAR(20),                   -- 老板手机号
    wecom_user_id VARCHAR(100),                -- 企微中对应的 userId
    plan VARCHAR(20) DEFAULT 'basic',          -- 套餐：basic/standard/premium
    token_quota INTEGER DEFAULT 500000,        -- 每月 token 配额
    token_used INTEGER DEFAULT 0,              -- 当月已用 token
    status VARCHAR(20) DEFAULT 'active',       -- active/suspended/expired
    config JSONB DEFAULT '{}',                 -- 商户个性化配置（AI风格偏好等）
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ                     -- 服务到期时间
);
```

### employees 表（商户员工）
```sql
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(50) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(20) DEFAULT 'staff',          -- owner/manager/staff
    wecom_user_id VARCHAR(100),                -- 企微 userId
    mp_openid VARCHAR(100),                    -- 小程序 openid
    mp_unionid VARCHAR(100),                   -- 微信 unionid（可选）
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### customers 表（客户线索）
```sql
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    created_by UUID REFERENCES employees(id),  -- 哪个员工录入的
    name VARCHAR(50),
    phone VARCHAR(20),
    wechat VARCHAR(50),                        -- 微信号或备注
    source VARCHAR(30),                        -- douyin/kuaishou/wechat/phone/walk_in/referral/miniprogram
    interested_listing_ids UUID[],             -- 感兴趣的车源 ID 列表
    budget_min DECIMAL(12,2),
    budget_max DECIMAL(12,2),
    preferred_brand VARCHAR(50),               -- 偏好品牌
    preferred_type VARCHAR(30),                -- sedan/suv/mpv/truck 等
    needs_financing BOOLEAN DEFAULT false,
    intent_score INTEGER DEFAULT 5,            -- 意向度 1-10
    status VARCHAR(20) DEFAULT 'new',          -- new/following/appointed/visited/deal/lost
    tags VARCHAR(50)[],                        -- 自定义标签
    notes TEXT,
    next_followup_at TIMESTAMPTZ,              -- 下次应跟进时间
    last_contacted_at TIMESTAMPTZ,             -- 上次联系时间
    deal_listing_id UUID,                      -- 成交的车源 ID
    deal_price DECIMAL(12,2),                  -- 成交价格
    deal_at TIMESTAMPTZ,                       -- 成交时间
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

### customer_followups 表（跟进记录）
```sql
CREATE TABLE customer_followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    employee_id UUID REFERENCES employees(id),
    action VARCHAR(30) NOT NULL,               -- called/messaged/visited/showed_car/deal/lost/other
    content TEXT,                               -- 本次跟进内容
    ai_suggested_script TEXT,                   -- AI 建议的话术
    next_followup_at TIMESTAMPTZ,              -- 建议下次跟进时间
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### listings 表（车源）
```sql
CREATE TABLE listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    brand VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INTEGER,
    mileage DECIMAL(8,1),                      -- 万公里
    price DECIMAL(12,2) NOT NULL,              -- 万元
    color VARCHAR(20),
    highlights TEXT,                            -- 车辆卖点描述
    images TEXT[],                              -- 图片 URL 数组
    status VARCHAR(20) DEFAULT 'active',       -- active/sold/archived
    ai_content JSONB DEFAULT '{}',             -- AI 生成的各平台文案
    view_count INTEGER DEFAULT 0,              -- 小程序浏览次数
    inquiry_count INTEGER DEFAULT 0,           -- 咨询次数
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

### customer_inquiries 表（C端买家咨询）
```sql
CREATE TABLE customer_inquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    listing_id UUID REFERENCES listings(id),
    buyer_openid VARCHAR(100),                 -- 买家的小程序 openid
    buyer_name VARCHAR(50),
    buyer_phone VARCHAR(20),
    inquiry_type VARCHAR(20),                  -- chat/appointment/call_request
    messages JSONB DEFAULT '[]',               -- 对话记录 [{role, content, time}]
    ai_handled BOOLEAN DEFAULT false,          -- 是否 AI 自动回复的
    intent_score INTEGER,                      -- AI 判断的意向度
    status VARCHAR(20) DEFAULT 'new',          -- new/replied/converted/closed
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

### token_usage_log 表（Token 用量）
```sql
CREATE TABLE token_usage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    action VARCHAR(50) NOT NULL,               -- voice_extract/followup_script/copywriting/live_script/intent_classify/screenshot_ocr/general_chat
    model VARCHAR(50) NOT NULL,
    tokens_in INTEGER NOT NULL,
    tokens_out INTEGER NOT NULL,
    cost_yuan DECIMAL(8,4),
    created_at TIMESTAMPTZ DEFAULT now()
);
```

所有含 tenant_id 的表需建立索引：
```sql
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_status ON customers(tenant_id, status);
CREATE INDEX idx_customers_next_followup ON customers(tenant_id, next_followup_at);
CREATE INDEX idx_followups_customer ON customer_followups(customer_id);
CREATE INDEX idx_listings_tenant ON listings(tenant_id, status);
CREATE INDEX idx_inquiries_tenant ON customer_inquiries(tenant_id);
CREATE INDEX idx_token_usage_tenant ON token_usage_log(tenant_id, created_at);
```

---

## 后端 API 接口清单

### 认证模块

| 路径 | 方法 | 用途 | 认证 |
|------|------|------|------|
| `POST /api/auth/mp-login` | POST | 小程序微信登录（code→openid→JWT） | 无 |
| `POST /api/auth/bind-wecom` | POST | 绑定员工的企微 userId 和小程序 openid | JWT |
| `GET /api/auth/profile` | GET | 获取当前登录用户信息 | JWT |

### 企微网关

| 路径 | 方法 | 用途 | 认证 |
|------|------|------|------|
| `GET /wecom/callback` | GET | 企微 URL 验证 | 企微签名 |
| `POST /wecom/callback` | POST | 接收企微消息 | 企微签名 |

### 客户管理

| 路径 | 方法 | 用途 | 认证 |
|------|------|------|------|
| `GET /api/customers` | GET | 客户列表（支持按 status/intent_score/source 筛选，支持分页和排序） | JWT |
| `GET /api/customers/:id` | GET | 客户详情（含跟进记录时间线） | JWT |
| `POST /api/customers` | POST | 新增客户 | JWT |
| `PUT /api/customers/:id` | PUT | 更新客户信息/状态 | JWT |
| `POST /api/customers/:id/followup` | POST | 记录一次跟进 | JWT |
| `POST /api/customers/voice-input` | POST | 语音文本→AI 结构化提取→返回待确认的结构化数据 | JWT |
| `GET /api/customers/today-followups` | GET | 获取今日跟进清单（含 AI 话术建议） | JWT |
| `POST /api/customers/:id/generate-script` | POST | 为某客户生成跟进话术 | JWT |

### 车源管理

| 路径 | 方法 | 用途 | 认证 |
|------|------|------|------|
| `GET /api/listings` | GET | 车源列表 | JWT |
| `GET /api/listings/:id` | GET | 车源详情 | JWT |
| `POST /api/listings` | POST | 新增车源（新增后自动触发客户匹配） | JWT |
| `PUT /api/listings/:id` | PUT | 编辑车源 | JWT |
| `DELETE /api/listings/:id` | DELETE | 下架车源 | JWT |
| `POST /api/listings/import/screenshot` | POST | 上传截图→AI 识别→返回车源列表待确认 | JWT |
| `POST /api/listings/import/batch` | POST | 批量确认导入 | JWT |
| `POST /api/listings/:id/generate-copy` | POST | 为某台车生成多平台文案（抖音/小红书/朋友圈/快手/视频脚本） | JWT |
| `POST /api/listings/generate-script` | POST | 选多台车生成直播脚本+弹幕FAQ | JWT |

### 文件上传

| 路径 | 方法 | 用途 | 认证 |
|------|------|------|------|
| `POST /api/upload/image` | POST | 上传图片到对象存储，返回 URL | JWT |

### C 端买家接口（小程序公开/半公开）

| 路径 | 方法 | 用途 | 认证 |
|------|------|------|------|
| `GET /api/shop/:tenantId/listings` | GET | 获取某商户的在售车源（公开，无需登录） | 无 |
| `GET /api/shop/:tenantId/listings/:id` | GET | 车辆详情（公开） | 无 |
| `GET /api/shop/:tenantId/info` | GET | 商户基本信息（店名、地址、电话） | 无 |
| `POST /api/shop/:tenantId/inquiry` | POST | 买家发起咨询/预约看车 | 微信登录 |
| `POST /api/shop/:tenantId/inquiry/:id/message` | POST | 买家发送咨询消息 | 微信登录 |
| `GET /api/shop/:tenantId/inquiry/:id` | GET | 买家查看咨询对话记录 | 微信登录 |

---

## 企微消息处理流程

当企微 POST 回调消息到 `/wecom/callback` 时：

1. 验证签名，解密 XML，提取消息内容
2. 根据消息发送者的 wecom_user_id 查找对应的 tenant 和 employee
3. 如果找不到对应员工，回复"请先联系管理员开通账号"
4. 如果是文本消息，进入 AI 意图识别
5. 如果是语音消息，提取 Recognition 字段（企微自动语音转文字），进入意图识别
6. 如果是图片消息，进入截图识别流程
7. 如果是事件消息（关注/进入应用），发送欢迎语

### 意图分类

AI 根据用户消息判断意图，返回以下分类之一：

- `record_customer`：录入客户线索（例："刚才一个姓李的问卡罗拉"）
- `check_followup`：查看跟进清单（例："今天该联系谁"）
- `generate_copy`：生成文案（例："帮卡罗拉出几条朋友圈"）
- `generate_script`：生成直播脚本（例："今晚播卡罗拉和思域，帮我出个脚本"）
- `new_listing`：录入新车源（例："到了一台雅阁，14万"）
- `update_status`：更新客户状态（例："张哥今天来看车了"、"李姐那台卡罗拉成交了"）
- `query_customer`：查询客户信息（例："那个问思域的是谁来着"）
- `query_listing`：查询车源信息（例："卡罗拉卖多少钱来着"）
- `general`：其他问题或闲聊

### 各意图的处理逻辑

**record_customer**：
- 使用结构化提取 prompt，从自然语言中提取：客户名、感兴趣的车、预算、联系方式、来源、是否要分期、预约时间等
- 将提取的信息与在售车源列表做模糊匹配（例如"卡罗拉"匹配到具体的车源记录）
- 返回确认信息给用户
- 自动设置 next_followup_at（如客户说"周末来看"则设为周六上午）

**check_followup**：
- 查询 customers 表中 next_followup_at <= 今天 且 status 为 new/following/appointed 的记录
- 为每个客户调用 AI 生成跟进话术（基于客户信息、上次跟进内容、感兴趣的车）
- 格式化为简洁的消息返回
- 同时推送小程序卡片链接到跟进清单页面

**generate_copy**：
- 识别用户提到的车源（模糊匹配）
- 如果未指定平台，默认生成4个版本：抖音、小红书、朋友圈、短视频口播脚本
- 如果指定了平台（"来条朋友圈的"），只生成对应平台的

**generate_script**：
- 识别用户提到的多台车
- 生成完整的直播脚本，包含：开场白、每台车的讲解要点和话术、互动引导话术、结尾话术
- 同时生成弹幕 FAQ（每台车的高频问题及建议回复）

**new_listing**：
- 从消息中提取车辆信息（品牌、车型、价格、年份、里程等）
- 存入 listings 表
- 自动触发客户匹配：在 customers 表中查找 preferred_brand / preferred_type / budget 匹配的客户
- 如有匹配，回复匹配结果并推送小程序卡片

**update_status**：
- 根据上下文找到对应客户，更新状态
- 如果是成交，记录 deal_listing_id、deal_price、deal_at
- 自动创建一条 followup 记录

### 企微消息发送

回复不使用被动回复（5秒超时限制），采用异步主动发送：
1. 收到回调后立即返回空字符串（告诉企微已收到）
2. 异步处理消息（调 AI 等）
3. 处理完成后调用企微"发送应用消息"API 主动发送回复

发送消息类型包括：
- **文本消息**：话术、文案、确认信息等
- **小程序卡片**：点击跳转到小程序的具体页面（客户详情、跟进清单、车源详情等）

小程序卡片格式：
```json
{
  "touser": "wecom_user_id",
  "msgtype": "miniprogram_notice",
  "agentid": AGENT_ID,
  "miniprogram_notice": {
    "appid": "小程序APPID",
    "page": "/pages/customer/detail?id=xxx",
    "title": "客户详情 - 张先生",
    "description": "感兴趣：卡罗拉 | 意向度：高"
  }
}
```

---

## AI 引擎设计

### 模型路由

```typescript
const MODEL_CONFIG = {
  intent_classify:   { model: 'deepseek-chat', temperature: 0,   maxTokens: 50 },
  voice_extract:     { model: 'deepseek-chat', temperature: 0.1, maxTokens: 500 },
  followup_script:   { model: 'deepseek-chat', temperature: 0.7, maxTokens: 800 },
  copywriting:       { model: 'deepseek-chat', temperature: 0.8, maxTokens: 1500 },
  live_script:       { model: 'deepseek-chat', temperature: 0.7, maxTokens: 3000 },
  faq_generate:      { model: 'deepseek-chat', temperature: 0.5, maxTokens: 1500 },
  screenshot_ocr:    { model: 'deepseek-vl',   temperature: 0.1, maxTokens: 1000 },
  general_chat:      { model: 'deepseek-chat', temperature: 0.7, maxTokens: 500 },
  buyer_chat:        { model: 'deepseek-chat', temperature: 0.5, maxTokens: 500 },
};
```

### Token 配额管理

- 使用 Redis 实时计数：key 为 `token:{tenantId}:{YYYY-MM}`
- 每次 AI 调用前检查配额，超额则拒绝并提示
- 每次 AI 调用后记录实际用量到 Redis 和 token_usage_log 表
- 每月 1 日定时任务重置 Redis 中的计数

### 主备切换

主力模型调用失败时（超时、限流、服务器错误），自动切换到备用模型（智谱 GLM），业务代码无感知。

---

## 小程序页面结构

### 登录/角色选择

```
启动页（判断身份）
├── 未登录 → 角色选择页
│   ├── "我是车商" → 微信登录 → 检查 employees 表
│   │   ├── 已注册 → 进入商户端首页
│   │   └── 未注册 → 提示"请联系管理员开通账号"
│   │
│   └── "我要看车" → 进入买家端（无需登录可浏览，咨询需登录）
│
└── 已登录（有有效 JWT）→ 根据角色直接进入对应界面
```

### 商户端页面

```
底部 Tab 导航：首页 | 客户 | 车源 | AI工具 | 我的

首页（今日工作台）
├── 今日跟进清单（核心区域，最显眼位置）
│   ├── 按优先级排序（高意向→近期未联系→一般）
│   ├── 每条显示：客户名 + 感兴趣的车 + AI建议话术（折叠/展开）
│   ├── 操作按钮：[复制话术] [标记已跟进] [查看详情]
│   └── 空状态："今天没有需要跟进的客户 👍"
├── 新线索通知（今日新增的客户数）
├── 快捷入口：[语音记一笔] [新增车源]
└── 本月概览卡片（新增客户/成交数/跟进次数）

客户页
├── 搜索栏
├── 筛选标签栏（全部/高意向/跟进中/已约看车/已成交/已流失）
├── 客户列表（卡片式，显示：姓名/意向度/感兴趣的车/最近跟进时间/状态）
├── 点击进入客户详情页
│   ├── 基本信息（姓名/电话/微信/来源/预算/偏好）
│   ├── 感兴趣的车源（可点击跳转）
│   ├── 跟进时间线（每次沟通记录，时间倒序）
│   ├── AI 建议话术区域
│   ├── [记录跟进] [生成话术] [修改状态] 操作按钮
│   └── 如果已成交：显示成交车源和价格
└── 右下角浮动按钮：[+ 新增客户]（表单录入）/ [🎙 语音录入]

车源页
├── 筛选标签栏（在售/已售/已下架）
├── 车源列表（卡片式，显示：品牌车型/价格/年份里程/状态/浏览量）
├── 点击进入车源详情页
│   ├── 车辆照片轮播
│   ├── 基本信息
│   ├── 卖点描述
│   ├── AI 生成的文案区域（按平台折叠展示，点击复制）
│   ├── 匹配的意向客户列表
│   ├── [生成文案] [编辑] [下架] 操作按钮
│   └── 浏览和咨询数据统计
├── 右下角浮动按钮：[+ 新增车源]
└── 批量导入入口（截图导入/语音批量录入）

AI 工具箱页
├── 直播脚本生成
│   ├── 多选今晚要播的车（从在售车源中勾选）
│   ├── [生成脚本]
│   └── 展示完整脚本（开场/每台车/互动/结尾）+ 弹幕FAQ
├── 文案生成
│   ├── 选车源 → 选平台（全部/抖音/小红书/朋友圈/口播脚本）
│   └── 展示生成结果 → [复制]
└── 朋友圈日历（可选，后期功能）
    ├── 每天推荐发的内容
    └── 一键复制

我的页
├── 店铺信息（名称/地址/电话/营业时间）
├── 员工管理（查看/邀请）
├── 数据统计（本月客户数/成交数/AI使用量）
├── 企微绑定状态
├── 套餐信息和到期时间
└── 关于/帮助
```

### 买家端页面

```
买家端不使用底部 Tab，使用简洁的单页面流

商户主页（通过分享链接/小程序码进入）
├── 商户 Logo + 店名 + 简介
├── 联系方式（电话/微信/地址，一键拨打/复制/导航）
├── 在售车辆列表（卡片式，显示：主图/品牌车型/价格/年份里程）
├── 品牌筛选（横向滚动，带车标 Logo）
├── 价格区间筛选
└── 下拉加载更多

车辆详情页
├── 图片轮播
├── 品牌/车型/价格（大字号突出）
├── 基本参数（年份/里程/颜色/排量）
├── 车辆卖点描述
├── 底部固定操作栏：[在线咨询] [预约看车] [拨打电话]
└── 分享按钮（生成海报/转发小程序卡片）

在线咨询页（需微信登录）
├── 聊天界面
├── AI 自动回复常见问题（"这车还在吗""多少钱""能分期吗"）
├── 高意向消息自动通知商户
└── 如果 AI 无法回答，提示"已通知销售顾问，稍后联系您"

预约看车页（需微信登录）
├── 选择日期和时间段
├── 留下姓名和电话
├── 提交后自动进入商户的客户管理系统
└── 并通过企微通知商户"有客户预约了看车"
```

---

## 定时任务

### 每日跟进提醒（每天 08:00）
1. 查询所有活跃租户
2. 对每个租户，查找 `next_followup_at <= today` 且 `status in ('new', 'following', 'appointed')` 的客户
3. 为每个客户生成 AI 跟进话术
4. 通过企微发送文本消息（简要清单）+ 小程序卡片（查看详情）

### 新客户欢迎（事件触发）
买家通过小程序发起咨询或预约时：
1. 自动创建 customer 记录
2. 通过企微通知商户："新客户 [姓名] 对 [车型] 感兴趣，意向度 [X]，[点击查看]"

### 月度 Token 重置（每月 1 日 00:00）
重置所有租户的 token_used 为 0。

---

## 环境变量

```env
# 数据库
DATABASE_URL=postgresql://postgres:password@localhost:5432/youke

# Redis
REDIS_URL=redis://localhost:6379

# 企业微信
WECOM_CORP_ID=你的企业ID
WECOM_APP_SECRET=自建应用的Secret
WECOM_TOKEN=回调配置的Token
WECOM_ENCODING_AES_KEY=回调配置的EncodingAESKey
WECOM_AGENT_ID=自建应用的AgentID

# 微信小程序
MP_APPID=小程序AppID
MP_SECRET=小程序Secret

# AI
DEEPSEEK_API_KEY=DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
ZHIPU_API_KEY=智谱 API Key（备用）

# 对象存储（腾讯云 COS 或阿里云 OSS）
OSS_ENDPOINT=
OSS_BUCKET=
OSS_ACCESS_KEY=
OSS_SECRET_KEY=

# JWT
JWT_SECRET=你的JWT密钥

# 服务
PORT=3000
NODE_ENV=production
```

---

## 开发要求

1. **代码质量**：TypeScript 严格模式，避免 any，所有接口有完整的类型定义
2. **错误处理**：统一的错误处理中间件，返回结构化的错误响应 `{ code, message, data }`
3. **日志**：使用 Fastify 内置的 pino logger，关键操作有日志记录
4. **安全**：
   - 所有 API 接口做输入验证（使用 Fastify 的 schema validation 或 zod）
   - 企微回调验证签名
   - JWT 过期时间 7 天
   - 多租户隔离在中间件层强制执行
5. **可维护性**：
   - 每个模块独立，通过 Fastify 的 plugin 机制注册
   - AI prompt 模板集中管理在 `src/modules/ai/prompts/` 目录
   - 配置集中管理，通过环境变量注入
6. **部署**：提供完整的 Dockerfile 和 docker-compose.yml，一键启动

---

## 开发顺序

请按以下顺序开发：

1. 项目初始化（Fastify + TypeScript + Drizzle + Docker Compose）
2. 数据库 schema 和迁移
3. 认证模块（JWT 签发/验证 + 多租户中间件）
4. 企微网关（回调验证 + 消息接收解密 + 消息发送 + access_token 管理）
5. AI 引擎（DeepSeek 调用封装 + 意图识别 + 结构化提取）
6. 客户管理接口（CRUD + 语音录入 + 跟进记录 + 今日跟进清单）
7. 车源管理接口（CRUD + 截图导入 + 客户匹配）
8. 文案/脚本生成接口
9. 企微对话完整流程（意图识别→对应处理→回复+推送小程序卡片）
10. C 端买家接口（车源浏览 + 咨询 + 预约 + AI 客服）
11. 定时任务（每日跟进推送 + Token 重置）
12. 小程序前端开发

先完成 1-9，实现"车商在微信里和 AI 助手对话"的完整链路，这是 MVP 的核心。
