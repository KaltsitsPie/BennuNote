/**
 * Direct AI API calls for offline fallback.
 * Replicates server/services/summarize_service.py logic.
 */

import type { BennuNoteConfig } from '../shared/types';

const SYSTEM_PROMPT =
  '你是一个视频内容分析助手。请对以下视频字幕进行结构化总结，包含要点提炼和关键信息。';

const DEFAULT_MODELS: Record<string, string> = {
  claude_setup_token: 'claude-haiku-4-5-20251001',
  claude_api: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
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
  config: BennuNoteConfig, title: string, text: string
): Promise<string> {
  const { provider, key, model } = getProviderConfig(config);
  const userContent = `视频标题：${title}\n\n字幕内容：\n${text}`;

  switch (provider) {
    case 'claude_setup_token':
      return callClaude(key, model, userContent, true);
    case 'claude_api':
      return callClaude(key, model, userContent, false);
    case 'openai':
      return callOpenAI(key, model, userContent, 'https://api.openai.com/v1/chat/completions');
    case 'gemini':
      return callGemini(key, model, userContent);
    case 'deepseek':
      return callOpenAI(key, model, userContent, 'https://api.deepseek.com/chat/completions');
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function callClaude(
  key: string, model: string, userContent: string, isSetupToken: boolean
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
      max_tokens: 2048,
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
  key: string, model: string, userContent: string, endpoint: string
): Promise<string> {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
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

async function callGemini(
  key: string, model: string, userContent: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { parts: [{ text: `${SYSTEM_PROMPT}\n\n${userContent}` }] },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error: ${resp.status}`);
  }
  const data = await resp.json();
  return data.candidates[0].content.parts[0].text;
}
