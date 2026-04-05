/**
 * Direct AI API calls for offline fallback.
 * Replicates server/services/summarize_service.py logic.
 */

import type { BennuNoteConfig } from '../shared/types';

const SYSTEM_PROMPT = `你是一位专业的内容分析师。请对以下视频文案进行深度总结，输出规范的 Markdown 文档。

【过滤规则】
- 忽略所有与主题无关的内容：广告、片尾致谢、频道引导语（如"感谢三连"）等
- 仅处理与核心主题直接相关的内容

【结构规则】
- 按视频的内容逻辑划分章节，每章有明确的主题标题
- 保留事件/论点之间的因果逻辑和叙事连贯性
- 对比性信息（数据、人物、国家等）优先使用表格呈现
- 文末附"关键数据速览"表格，汇总全文重要数字

【内容深度规则】
- 区分"事实陈述"与"分析洞察"，重要结论处用 blockquote（> ）标注
- 对视频中出现的核心概念、理论框架、专有名词给出简明解释
- 提炼跨章节的深层逻辑与结构性规律，不只罗列各段要点
- 文末写"总结"一节，用2-3段文字概括全文核心论点与意义

【格式规则】
- 使用 Markdown：# 一级标题、## 二级标题、### 三级标题、**加粗**、> blockquote
- 适度使用列表，但叙事性内容优先用段落而非 bullet points
- 输出语言与原文一致`;

const DEFAULT_MODELS: Record<string, string> = {
  claude_setup_token: 'claude-haiku-4-5-20251001',
  claude_api: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5.4',
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-chat',
};

function getProviderConfig(config: BennuNoteConfig): { provider: string; key: string; model: string } {
  let provider = config.aiProvider;

  // Auto-detect if not set
  if (!provider) {
    const checks: [string, string][] = [
      ['claude_setup_token', config.claudeSetupToken],
      ['claude_api', config.claudeApiKey],
      ['openai', config.openaiApiKey],
      ['gemini', config.geminiApiKey],
      ['deepseek', config.deepseekApiKey],
    ];
    for (const [p, k] of checks) {
      if (k) { provider = p; break; }
    }
  }

  if (!provider) throw new Error('No AI provider configured.');

  const keyMap: Record<string, string> = {
    claude_setup_token: config.claudeSetupToken,
    claude_api: config.claudeApiKey,
    openai: config.openaiApiKey,
    gemini: config.geminiApiKey,
    deepseek: config.deepseekApiKey,
  };
  const modelMap: Record<string, string> = {
    claude_setup_token: config.claudeModel,
    claude_api: config.claudeApiModel,
    openai: config.openaiModel,
    gemini: config.geminiModel,
    deepseek: config.deepseekModel,
  };

  const key = keyMap[provider] || '';
  if (!key) throw new Error(`API key for ${provider} is not configured.`);

  const model = modelMap[provider] || DEFAULT_MODELS[provider];
  return { provider, key, model };
}

export async function summarizeDirect(
  config: BennuNoteConfig, title: string, text: string, maxTokens = 4096
): Promise<string> {
  const { provider, key, model } = getProviderConfig(config);
  const userContent = `视频标题：${title}\n\n字幕内容：\n${text}`;

  switch (provider) {
    case 'claude_setup_token':
      return callClaude(key, model, userContent, true, maxTokens);
    case 'claude_api':
      return callClaude(key, model, userContent, false, maxTokens);
    case 'openai':
      if (model === 'gpt-5.4-pro') {
        return callOpenAIResponses(key, model, userContent, maxTokens);
      }
      return callOpenAI(key, model, userContent, 'https://api.openai.com/v1/chat/completions', maxTokens);
    case 'gemini':
      return callGemini(key, model, userContent, maxTokens);
    case 'deepseek':
      return callOpenAI(key, model, userContent, 'https://api.deepseek.com/chat/completions', maxTokens);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function callClaude(
  key: string, model: string, userContent: string, isSetupToken: boolean, maxTokens: number
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (isSetupToken) {
    headers['Authorization'] = `Bearer ${key}`;
    headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
  } else {
    headers['x-api-key'] = key;
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error: ${resp.status}`);
  }
  const data = await resp.json();
  return data.content[0].text;
}

async function callOpenAI(
  key: string, model: string, userContent: string, endpoint: string, maxTokens: number
): Promise<string> {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${resp.status}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

async function callOpenAIResponses(
  key: string, model: string, userContent: string, maxTokens: number
): Promise<string> {
  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_output_tokens: maxTokens,
      instructions: SYSTEM_PROMPT,
      input: userContent,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${resp.status}`);
  }
  const data = await resp.json();
  const msg = data.output?.find((item: { type: string }) => item.type === 'message');
  if (!msg) throw new Error('No message in Responses API output');
  return msg.content[0].text;
}

async function callGemini(
  key: string, model: string, userContent: string, maxTokens: number
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { parts: [{ text: `${SYSTEM_PROMPT}\n\n${userContent}` }] },
      ],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error: ${resp.status}`);
  }
  const data = await resp.json();
  return data.candidates[0].content.parts[0].text;
}
