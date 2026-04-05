# OpenClaw 如何获取和使用 Claude Setup Token

> 分析基于 openclaw 项目源码，记录其使用 Claude 订阅凭证（Setup Token）而非 API Key 的完整机制。

## 目录

1. [概述](#概述)
2. [Setup Token 的格式与验证](#setup-token-的格式与验证)
3. [Token 获取流程](#token-获取流程)
   - [交互式获取](#交互式获取)
   - [非交互式获取](#非交互式获取)
4. [Token 存储机制](#token-存储机制)
   - [凭证类型定义](#凭证类型定义)
   - [Auth Profile Store 结构](#auth-profile-store-结构)
   - [存储与读取](#存储与读取)
5. [Token 使用：发起 API 请求](#token-使用发起-api-请求)
   - [主路径：Anthropic OAuth Usage API](#主路径anthropic-oauth-usage-api)
   - [备用路径：Claude.ai Web API](#备用路径claudeai-web-api)
   - [推理请求](#推理请求)
6. [Provider 注册与认证方法声明](#provider-注册与认证方法声明)
7. [端到端测试](#端到端测试)
8. [认证优先级与备选方案](#认证优先级与备选方案)
9. [重要注意事项](#重要注意事项)

---

## 概述

OpenClaw 支持三种 Anthropic 认证方式：

| 方式 | ID | 说明 |
|------|----|------|
| API Key | `api-key` | 标准 Anthropic API 密钥 |
| Claude CLI | `cli` | 复用本地 Claude CLI 登录 |
| **Setup Token** | `setup-token` | 使用 Claude 订阅的 bearer token（`sk-ant-oat01-...`） |

Setup Token 是一种**静态 bearer token**，来源于 Claude 订阅（Pro/Max），不可自动刷新，被 OpenClaw 归类为"legacy/manual path"。

---

## Setup Token 的格式与验证

**源文件:** `src/plugins/provider-auth-token.ts`

```typescript
export const ANTHROPIC_SETUP_TOKEN_PREFIX = "sk-ant-oat01-";
export const ANTHROPIC_SETUP_TOKEN_MIN_LENGTH = 80;

export function validateAnthropicSetupToken(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "Required";
  }
  if (!trimmed.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX)) {
    return `Expected token starting with ${ANTHROPIC_SETUP_TOKEN_PREFIX}`;
  }
  if (trimmed.length < ANTHROPIC_SETUP_TOKEN_MIN_LENGTH) {
    return "Token looks too short; paste the full setup-token";
  }
  return undefined; // 验证通过返回 undefined
}
```

**关键规则:**
- 前缀必须为 `sk-ant-oat01-`
- 最少 80 个字符
- 输入时会自动去除空白字符

Profile ID 的构建方式：

```typescript
export function buildTokenProfileId(params: { provider: string; name: string }): string {
  const provider = normalizeProviderId(params.provider);
  const name = normalizeTokenProfileName(params.name);
  return `${provider}:${name}`; // 例如 "anthropic:default"
}
```

---

## Token 获取流程

### 交互式获取

**源文件:** `extensions/anthropic/register.runtime.ts`

用户通过 CLI 交互提示输入 token：

```typescript
async function runAnthropicSetupTokenAuth(ctx: ProviderAuthContext): Promise<ProviderAuthResult> {
  // 1. 尝试从命令行选项获取 token
  const providedToken =
    typeof ctx.opts?.token === "string" && ctx.opts.token.trim().length > 0
      ? normalizeAnthropicSetupTokenInput(ctx.opts.token)
      : undefined;

  // 2. 如果没有提供，弹出交互式输入提示
  const token =
    providedToken ??
    normalizeAnthropicSetupTokenInput(
      await ctx.prompter.text({
        message: "Paste Anthropic setup-token",
        validate: (value) => validateAnthropicSetupToken(normalizeAnthropicSetupTokenInput(value)),
      }),
    );

  // 3. 验证 token
  const tokenError = validateAnthropicSetupToken(token);
  if (tokenError) {
    throw new Error(tokenError);
  }

  // 4. 构建 profile ID 和过期时间
  const profileId = resolveAnthropicSetupTokenProfileId(ctx.opts?.tokenProfileId);
  const expires = resolveAnthropicSetupTokenExpiry(ctx.opts?.tokenExpiresIn);

  // 5. 返回认证结果
  return {
    profiles: [
      {
        profileId,
        credential: {
          type: "token",
          provider: PROVIDER_ID, // "anthropic"
          token,
          ...(expires ? { expires } : {}),
        },
      },
    ],
    defaultModel: DEFAULT_ANTHROPIC_MODEL, // "anthropic/claude-sonnet-4-6"
    notes: [...ANTHROPIC_SETUP_TOKEN_NOTE_LINES],
  };
}
```

**CLI 命令：**

```bash
# 交互式
openclaw models auth login --provider anthropic --method setup-token

# 或通过 onboard 流程
openclaw onboard
# 然后选择 "Anthropic setup-token"
```

### 非交互式获取

```typescript
async function runAnthropicSetupTokenNonInteractive(
  ctx: ProviderAuthMethodNonInteractiveContext,
): Promise<ProviderAuthConfig | null> {
  // 从 --token 参数获取
  const rawToken =
    typeof ctx.opts.token === "string" ? normalizeAnthropicSetupTokenInput(ctx.opts.token) : "";

  const tokenError = validateAnthropicSetupToken(rawToken);
  if (tokenError) {
    ctx.runtime.error(
      ["Anthropic setup-token auth requires --token with a valid setup-token.", tokenError].join("\n"),
    );
    ctx.runtime.exit(1);
    return null;
  }

  const profileId = resolveAnthropicSetupTokenProfileId(ctx.opts.tokenProfileId);
  const expires = resolveAnthropicSetupTokenExpiry(ctx.opts.tokenExpiresIn);

  // 直接写入 auth profile store
  upsertAuthProfile({
    profileId,
    credential: {
      type: "token",
      provider: PROVIDER_ID,
      token: rawToken,
      ...(expires ? { expires } : {}),
    },
    agentDir: ctx.agentDir,
  });

  // 更新配置，设置默认模型
  const withProfile = applyAuthProfileConfig(ctx.config, {
    profileId,
    provider: PROVIDER_ID,
    mode: "token",
  });

  return {
    ...withProfile,
    agents: {
      ...withProfile.agents,
      defaults: {
        ...withProfile.agents?.defaults,
        model: {
          ...existingModelConfig,
          primary: DEFAULT_ANTHROPIC_MODEL, // "anthropic/claude-sonnet-4-6"
        },
      },
    },
  };
}
```

**CLI 命令：**

```bash
openclaw models auth login --provider anthropic --method setup-token --token "sk-ant-oat01-..."

# 或
openclaw onboard --anthropic-setup-token
```

**环境变量方式：**

```bash
export OPENCLAW_LIVE_SETUP_TOKEN_VALUE="sk-ant-oat01-..."
```

---

## Token 存储机制

### 凭证类型定义

**源文件:** `src/agents/auth-profiles/types.ts`

Setup Token 使用 `TokenCredential` 类型：

```typescript
export type TokenCredential = {
  /**
   * Static bearer-style token (often OAuth access token / PAT).
   * Not refreshable by OpenClaw (unlike `type: "oauth"`).
   */
  type: "token";
  provider: string;       // "anthropic"
  token?: string;         // "sk-ant-oat01-..."
  tokenRef?: SecretRef;   // 可选的密钥引用（用于安全存储）
  /** Optional expiry timestamp (ms since epoch). */
  expires?: number;
  email?: string;
  displayName?: string;
};
```

这是三种凭证类型之一：

```typescript
export type AuthProfileCredential = ApiKeyCredential | TokenCredential | OAuthCredential;
```

### Auth Profile Store 结构

```typescript
export type AuthProfileStore = {
  version: number;
  profiles: Record<string, AuthProfileCredential>;
  order?: Record<string, string[]>;          // provider -> profile ID 优先级
  lastGood?: Record<string, string>;         // provider -> 最近成功的 profile ID
  usageStats?: Record<string, ProfileUsageStats>; // 使用统计与冷却追踪
};
```

**实际存储的 JSON 文件示例** (`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`):

```json
{
  "version": 1,
  "profiles": {
    "anthropic:default": {
      "type": "token",
      "provider": "anthropic",
      "token": "sk-ant-oat01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..."
    }
  }
}
```

### 存储与读取

**源文件:** `src/agents/auth-profiles/profiles.ts`

**写入 (upsert):**

```typescript
export function upsertAuthProfile(params: {
  profileId: string;
  credential: AuthProfileCredential;
  agentDir?: string;
}): void {
  const credential =
    params.credential.type === "token"
      ? { ...params.credential, token: normalizeSecretInput(params.credential.token) }
      : params.credential;

  const store = ensureAuthProfileStore(params.agentDir);
  store.profiles[params.profileId] = credential;
  saveAuthProfileStore(store, params.agentDir);
}
```

**源文件:** `src/agents/auth-profiles/store.ts`

**读取与加载:**

```typescript
export function loadAuthProfileStore(): AuthProfileStore {
  const authPath = resolveAuthStorePath();
  const asStore = loadCoercedStore(authPath);
  if (asStore) {
    syncExternalCliCredentialsTimed(asStore);
    return asStore;
  }
  // 回退：尝试加载旧版格式
  const legacyRaw = loadJsonFile(resolveLegacyAuthStorePath());
  const legacy = coerceLegacyStore(legacyRaw);
  if (legacy) {
    const store: AuthProfileStore = { version: AUTH_STORE_VERSION, profiles: {} };
    applyLegacyStore(store, legacy);
    syncExternalCliCredentialsTimed(store);
    return store;
  }
  const store: AuthProfileStore = { version: AUTH_STORE_VERSION, profiles: {} };
  syncExternalCliCredentialsTimed(store);
  return store;
}
```

**持久化时的安全处理** — 如果同时存在 `token` 和 `tokenRef`，则只保留 `tokenRef`：

```typescript
function buildPersistedAuthProfileStore(store: AuthProfileStore): AuthProfileStore {
  const profiles = Object.fromEntries(
    Object.entries(store.profiles).flatMap(([profileId, credential]) => {
      if (credential.type === "token" && credential.tokenRef && credential.token !== undefined) {
        const sanitized = { ...credential } as Record<string, unknown>;
        delete sanitized.token; // 清除明文 token，只保留安全引用
        return [[profileId, sanitized]];
      }
      return [[profileId, credential]];
    }),
  ) as AuthProfileStore["profiles"];
  // ...
}
```

---

## Token 使用：发起 API 请求

### 主路径：Anthropic OAuth Usage API

**源文件:** `src/infra/provider-usage.fetch.claude.ts`

Setup token 通过 `Authorization: Bearer` 方式发送到 Anthropic 的 OAuth usage 端点：

```typescript
export async function fetchClaudeUsage(
  token: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<ProviderUsageSnapshot> {
  const res = await fetchJson(
    "https://api.anthropic.com/api/oauth/usage",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "openclaw",
        Accept: "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
      },
    },
    timeoutMs,
    fetchFn,
  );

  if (!res.ok) {
    // 处理 403 scope 不足的情况...（见下文备用路径）
  }

  const data = (await res.json()) as ClaudeUsageResponse;
  const windows = buildClaudeUsageWindows(data);
  return { provider: "anthropic", displayName: PROVIDER_LABELS.anthropic, windows };
}
```

**Usage 响应解析 — 包含 5 小时和 7 天使用率窗口：**

```typescript
type ClaudeUsageResponse = {
  five_hour?: { utilization?: number; resets_at?: string };
  seven_day?: { utilization?: number; resets_at?: string };
  seven_day_sonnet?: { utilization?: number };
  seven_day_opus?: { utilization?: number };
};

function buildClaudeUsageWindows(data: ClaudeUsageResponse): UsageWindow[] {
  const windows: UsageWindow[] = [];
  if (data.five_hour?.utilization !== undefined) {
    windows.push({
      label: "5h",
      usedPercent: clampPercent(data.five_hour.utilization),
      resetAt: data.five_hour.resets_at ? new Date(data.five_hour.resets_at).getTime() : undefined,
    });
  }
  if (data.seven_day?.utilization !== undefined) {
    windows.push({
      label: "Week",
      usedPercent: clampPercent(data.seven_day.utilization),
      resetAt: data.seven_day.resets_at ? new Date(data.seven_day.resets_at).getTime() : undefined,
    });
  }
  // 模型专用窗口 (Sonnet / Opus)
  const modelWindow = data.seven_day_sonnet || data.seven_day_opus;
  if (modelWindow?.utilization !== undefined) {
    windows.push({
      label: data.seven_day_sonnet ? "Sonnet" : "Opus",
      usedPercent: clampPercent(modelWindow.utilization),
    });
  }
  return windows;
}
```

### 备用路径：Claude.ai Web API

当 setup token 的 OAuth scope 不包含 `user:profile`（返回 403）时，OpenClaw 会尝试用 Claude.ai 的 Web Session Key 作为备用：

```typescript
// 在 fetchClaudeUsage 中的 403 处理
if (res.status === 403 && message?.includes("scope requirement user:profile")) {
  const sessionKey = resolveClaudeWebSessionKey();
  if (sessionKey) {
    const web = await fetchClaudeWebUsage(sessionKey, timeoutMs, fetchFn);
    if (web) {
      return web;
    }
  }
}
```

**Session Key 解析 — 支持多种环境变量格式：**

```typescript
function resolveClaudeWebSessionKey(): string | undefined {
  // 方式 1: 直接环境变量
  const direct =
    process.env.CLAUDE_AI_SESSION_KEY?.trim() ?? process.env.CLAUDE_WEB_SESSION_KEY?.trim();
  if (direct?.startsWith("sk-ant-")) {
    return direct;
  }

  // 方式 2: 从 Cookie header 解析
  const cookieHeader = process.env.CLAUDE_WEB_COOKIE?.trim();
  if (!cookieHeader) {
    return undefined;
  }
  const stripped = cookieHeader.replace(/^cookie:\s*/i, "");
  const match = stripped.match(/(?:^|;\s*)sessionKey=([^;\s]+)/i);
  const value = match?.[1]?.trim();
  return value?.startsWith("sk-ant-") ? value : undefined;
}
```

**Web API 调用 — 使用 Cookie 认证访问 claude.ai：**

```typescript
async function fetchClaudeWebUsage(
  sessionKey: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<ProviderUsageSnapshot | null> {
  const headers: Record<string, string> = {
    Cookie: `sessionKey=${sessionKey}`,
    Accept: "application/json",
  };

  // 步骤 1: 获取组织 ID
  const orgRes = await fetchJson(
    "https://claude.ai/api/organizations",
    { headers },
    timeoutMs,
    fetchFn,
  );
  const orgs = (await orgRes.json()) as ClaudeWebOrganizationsResponse;
  const orgId = orgs?.[0]?.uuid?.trim();

  // 步骤 2: 获取该组织的使用量
  const usageRes = await fetchJson(
    `https://claude.ai/api/organizations/${orgId}/usage`,
    { headers },
    timeoutMs,
    fetchFn,
  );
  const data = (await usageRes.json()) as ClaudeWebUsageResponse;
  const windows = buildClaudeUsageWindows(data);
  return { provider: "anthropic", displayName: PROVIDER_LABELS.anthropic, windows };
}
```

### 推理请求

**源文件:** `src/agents/anthropic.setup-token.live.test.ts`

实际的模型推理调用通过 `@mariozechner/pi-ai` 库完成，setup token 作为 `apiKey` 传入：

```typescript
const apiKeyInfo = await getApiKeyForModel({
  model,
  cfg,
  profileId: tokenSource.profileId,
  agentDir: tokenSource.agentDir,
});
const apiKey = requireApiKey(apiKeyInfo, model.provider);

// 使用 setup token 作为 apiKey 进行推理
const res = await completeSimple(
  model,
  {
    messages: [
      {
        role: "user",
        content: "Reply with the word ok.",
        timestamp: Date.now(),
      },
    ],
  },
  {
    apiKey,       // <-- 这里就是 setup token
    maxTokens: 64,
    temperature: 0,
  },
);
```

底层 `pi-ai` 库会将 `apiKey` 通过 `Authorization: Bearer` 或 `x-api-key` header 发送到 Anthropic API（`api.anthropic.com`）。

---

## Provider 注册与认证方法声明

**源文件:** `extensions/anthropic/register.runtime.ts`

OpenClaw 的插件系统中，Anthropic provider 注册了三种认证方法：

```typescript
export function registerAnthropicPlugin(api: OpenClawPluginApi): void {
  api.registerProvider({
    id: "anthropic",
    label: "Anthropic",
    envVars: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
    auth: [
      // 方法 1: Claude CLI (复用本地登录)
      {
        id: "cli",
        label: "Claude CLI",
        hint: "Reuse a local Claude CLI login and switch model selection to claude-cli/*",
        kind: "custom",
        // ...
      },

      // 方法 2: Setup Token (本文档的重点)
      {
        id: "setup-token",
        label: "Anthropic setup-token",
        hint: "Legacy/manual bearer token path; requires Extra Usage when used through OpenClaw",
        kind: "token",
        wizard: {
          choiceId: "setup-token",
          choiceLabel: "Anthropic setup-token",
          choiceHint: "Legacy/manual path; requires Extra Usage in OpenClaw",
          assistantPriority: 40,  // 较低优先级
          groupId: "anthropic",
        },
        run: async (ctx) => await runAnthropicSetupTokenAuth(ctx),
        runNonInteractive: async (ctx) => await runAnthropicSetupTokenNonInteractive(ctx),
      },

      // 方法 3: API Key
      createProviderApiKeyAuthMethod({
        providerId: "anthropic",
        methodId: "api-key",
        label: "Anthropic API key",
        envVar: "ANTHROPIC_API_KEY",
        defaultModel: "anthropic/claude-sonnet-4-6",
        // ...
      }),
    ],

    // Usage 查询：先解析 OAuth token，再用它查询使用量
    resolveUsageAuth: async (ctx) => await ctx.resolveOAuthToken(),
    fetchUsageSnapshot: async (ctx) =>
      await fetchClaudeUsage(ctx.token, ctx.timeoutMs, ctx.fetchFn),
  });
}
```

**Setup Token 的提示信息：**

```typescript
const ANTHROPIC_SETUP_TOKEN_NOTE_LINES = [
  "Anthropic setup-token auth is a legacy/manual path in OpenClaw.",
  "Anthropic told OpenClaw users that OpenClaw counts as a third-party harness, "
    + "so this path requires Extra Usage on the Claude account.",
  `If you want a direct API billing path instead, use "openclaw models auth login "
    + "--provider anthropic --method api-key --set-default" or "openclaw models auth login "
    + "--provider anthropic --method cli --set-default".`,
];
```

---

## 端到端测试

**源文件:** `src/agents/anthropic.setup-token.live.test.ts`

OpenClaw 提供了完整的 live 测试来验证 setup token 的端到端功能：

```typescript
// 环境变量控制
const SETUP_TOKEN_RAW = process.env.OPENCLAW_LIVE_SETUP_TOKEN?.trim() ?? "";
const SETUP_TOKEN_VALUE = process.env.OPENCLAW_LIVE_SETUP_TOKEN_VALUE?.trim() ?? "";
const SETUP_TOKEN_PROFILE = process.env.OPENCLAW_LIVE_SETUP_TOKEN_PROFILE?.trim() ?? "";
const SETUP_TOKEN_MODEL = process.env.OPENCLAW_LIVE_SETUP_TOKEN_MODEL?.trim() ?? "";

const ENABLED = LIVE && Boolean(SETUP_TOKEN_RAW || SETUP_TOKEN_VALUE || SETUP_TOKEN_PROFILE);
```

**Token 来源解析 — 支持临时目录和已有 profile：**

```typescript
async function resolveTokenSource(): Promise<TokenSource> {
  const explicitToken = /* 从环境变量获取 */;

  if (explicitToken) {
    // 创建临时目录，写入 token
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-setup-token-"));
    const profileId = `anthropic:setup-token-live-${randomUUID()}`;
    const store = ensureAuthProfileStore(tempDir);
    store.profiles[profileId] = {
      type: "token",
      provider: "anthropic",
      token: explicitToken,
    };
    saveAuthProfileStore(store, tempDir);
    return { agentDir: tempDir, profileId, cleanup: /* 删除临时目录 */ };
  }

  // 回退：从已有 auth store 中查找 setup token profile
  const agentDir = resolveOpenClawAgentDir();
  const store = ensureAuthProfileStore(agentDir);
  const candidates = listSetupTokenProfiles(store);
  return { agentDir, profileId: pickSetupTokenProfile(candidates) };
}
```

**运行测试：**

```bash
OPENCLAW_LIVE_TEST=1 \
  OPENCLAW_LIVE_SETUP_TOKEN_VALUE="sk-ant-oat01-..." \
  pnpm test:live src/agents/anthropic.setup-token.live.test.ts
```

---

## 认证优先级与备选方案

OpenClaw 中 Anthropic 认证的优先级（从高到低）：

| 优先级 | 方式 | 来源 |
|--------|------|------|
| 1 | API Key | `ANTHROPIC_API_KEY` 环境变量 |
| 2 | Claude CLI | 本地 `claude auth login` 状态 |
| 3 | **Setup Token** | `sk-ant-oat01-...` 手动配置 |
| 4 | OAuth Token | 自动刷新的 OAuth 凭证 |

在 provider wizard 中，setup-token 的 `assistantPriority` 为 40（较低），表示 onboard 时不会被优先推荐。

---

## 重要注意事项

1. **计费方式变更**: Anthropic 已明确通知，通过 OpenClaw 使用 setup token 属于"第三方 harness"流量，不再从 Claude 订阅额度中扣除，而是需要开启 **Extra Usage**（按量付费）。

2. **Token 不可刷新**: Setup token 是静态的 bearer token（`type: "token"`），不像 OAuth token（`type: "oauth"`）那样可以自动刷新。

3. **可选过期时间**: 可通过 `--token-expires-in` 参数设置过期时间（如 `7d`、`30d`），到期后需要重新配置。

4. **Web Session Key 备用**: 当 setup token scope 不足时，可通过以下环境变量提供 claude.ai 的 session key 作为 usage 查询的备用：
   - `CLAUDE_AI_SESSION_KEY`
   - `CLAUDE_WEB_SESSION_KEY`
   - `CLAUDE_WEB_COOKIE`（从 Cookie header 中解析 `sessionKey=...`）

5. **安全存储**: 当配置了 `SecretRef` 时，持久化到磁盘的 JSON 文件中不会包含明文 token，只保留安全引用。

---

## 流程图

```
用户执行 CLI 命令
       │
       ▼
┌─────────────────────┐
│ openclaw onboard    │
│ 选择 "setup-token"  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────┐
│ 交互式/非交互式输入 token │
│ (sk-ant-oat01-...)      │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────────┐
│ validateAnthropicSetupToken │
│ - 检查前缀 sk-ant-oat01-   │
│ - 检查长度 >= 80            │
└──────────┬──────────────────┘
           │
           ▼
┌────────────────────────────────────────┐
│ upsertAuthProfile                      │
│ 写入 auth-profiles.json               │
│ profileId: "anthropic:default"         │
│ credential: { type:"token", token:... }│
└──────────┬─────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ 运行时: getApiKeyForModel            │
│ 从 auth store 读取对应 profile 的    │
│ token 值                             │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ pi-ai completeSimple(model, {       │
│   apiKey: "sk-ant-oat01-...",       │
│   ...                                │
│ })                                   │
│                                      │
│ → Authorization: Bearer sk-ant-oat01-│
│ → https://api.anthropic.com/...      │
└──────────────────────────────────────┘
```
