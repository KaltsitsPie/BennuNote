import type { Message } from './shared/messages';
import type { BennuNoteConfig } from './shared/types';
import { DEFAULT_CONFIG } from './shared/types';
import { summarizeDirect } from './background/summarize-direct';

let activeTabId: number | null = null;

async function getConfig(): Promise<BennuNoteConfig> {
  const data = await chrome.storage.local.get('bennunote_config');
  return { ...DEFAULT_CONFIG, ...(data.bennunote_config as Partial<BennuNoteConfig> | undefined) };
}

/** Get the active AI provider's key and model from config. */
function getAIParams(config: BennuNoteConfig): { provider: string; apiKey: string; model: string } {
  const provider = config.aiProvider || '';
  const map: Record<string, { key: string; model: string }> = {
    claude_setup_token: { key: config.claudeSetupToken, model: config.claudeModel },
    claude_api: { key: config.claudeApiKey, model: config.claudeApiModel },
    openai: { key: config.openaiApiKey, model: config.openaiModel },
    gemini: { key: config.geminiApiKey, model: config.geminiModel },
    deepseek: { key: config.deepseekApiKey, model: config.deepseekModel },
  };
  const entry = map[provider];
  return { provider, apiKey: entry?.key || '', model: entry?.model || '' };
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (msg.type === 'EXTRACT_SUBTITLES') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        activeTabId = tabId;
        chrome.tabs.sendMessage(tabId, msg, () => { void chrome.runtime.lastError; });
      }
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'TRANSCRIPT_REQUEST') {
    const tabId = sender.tab?.id || activeTabId;
    (async () => {
      try {
        const config = await getConfig();
        const resp = await fetch('http://localhost:2185/transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bvid: msg.bvid,
            model_size: config.whisperModelSize || 'small',
            cookie: config.bilibiliCookie || '',
            language: msg.language,
          }),
        });
        const data = await resp.json();
        if (resp.ok && data.items) {
          if (tabId) chrome.tabs.sendMessage(tabId, {
            type: 'TRANSCRIPT_RESULT',
            result: { source: data.source, items: data.items, language: msg.language },
          }, () => { void chrome.runtime.lastError; });
        } else {
          if (tabId) chrome.tabs.sendMessage(tabId, {
            type: 'TRANSCRIPT_RESULT', result: null,
            error: typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || 'Unknown error'),
          }, () => { void chrome.runtime.lastError; });
        }
      } catch (err) {
        if (tabId) chrome.tabs.sendMessage(tabId, {
          type: 'TRANSCRIPT_RESULT', result: null, error: `Backend offline: ${err}`,
        }, () => { void chrome.runtime.lastError; });
      }
    })();
    sendResponse({ ok: true });
    return false;
  }

  // Write to Feishu Wiki (server only — no fallback)
  if (msg.type === 'WRITE_FEISHU') {
    (async () => {
      const config = await getConfig();
      try {
        const resp = await fetch('http://localhost:2185/write_feishu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: msg.text,
            title: msg.title,
            items: msg.items || [],
            target_doc_token: msg.targetDocToken || '',
            video_info: msg.videoInfo || { bvid: '', title: msg.title },
            wiki_node: config.feishuWikiRootNodeToken || '',
          }),
        });
        const data = await resp.json();
        if (resp.ok && data.doc_url) {
          sendResponse({ type: 'WRITE_FEISHU_RESULT', success: true, docUrl: data.doc_url });
        } else {
          sendResponse({ type: 'WRITE_FEISHU_RESULT', success: false, error: data.detail || 'Server error' });
        }
      } catch (err) {
        sendResponse({
          type: 'WRITE_FEISHU_RESULT', success: false,
          error: `Server offline. Start the backend: ./start-server.sh — ${err}`,
        });
      }
    })();
    return true;
  }

  // Summarize (server → direct fallback)
  // Use `return true` to keep the message channel open so the MV3 service worker
  // stays alive until sendResponse is called. Without this, Chrome may terminate
  // the SW before the async AI call completes, causing results to be silently lost.
  if (msg.type === 'SUMMARIZE') {
    (async () => {
      const config = await getConfig();
      const { provider, apiKey, model } = getAIParams(config);
      let summary: string | undefined;
      let error: string | undefined;

      const maxTokens = msg.maxTokens || config.maxTokens || 4096;
      try {
        const resp = await fetch('http://localhost:2185/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: msg.text, title: msg.title,
            provider, api_key: apiKey, model: model || undefined,
            max_tokens: maxTokens,
          }),
        });
        const data = await resp.json();
        if (resp.ok && data.summary) summary = data.summary;
        else error = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || 'Server error');
      } catch {
        // Server offline → direct fallback
        try {
          summary = await summarizeDirect(config, msg.title, msg.text, maxTokens);
        } catch (e) { error = `${e}`; }
      }

      sendResponse(summary
        ? { type: 'SUMMARIZE_RESULT', success: true, summary }
        : { type: 'SUMMARIZE_RESULT', success: false, error });
    })();
    return true;
  }

  return false;
});
