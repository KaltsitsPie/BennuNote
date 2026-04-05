import type { Message } from './shared/messages';
import type { BennuNoteConfig } from './shared/types';
import { DEFAULT_CONFIG } from './shared/types';

// Track which tab initiated so we can route results back
let activeTabId: number | null = null;

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  // Popup → trigger extraction in the active bilibili tab's content script
  if (msg.type === 'EXTRACT_SUBTITLES') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        activeTabId = tabId;
        chrome.tabs.sendMessage(tabId, msg, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[BennuNote BG] sendMessage to tab failed:', chrome.runtime.lastError.message);
          }
        });
      }
    });
    sendResponse({ ok: true });
    return false;
  }

  // Content script → Backend: request transcription (Bcut ASR → Whisper fallback)
  if (msg.type === 'TRANSCRIPT_REQUEST') {
    const tabId = sender.tab?.id || activeTabId;
    console.log(`[BennuNote BG] TRANSCRIPT_REQUEST received: bvid=${msg.bvid}, language=${msg.language}, tabId=${tabId}`);

    (async () => {
      try {
        const configData = await chrome.storage.local.get('bennunote_config');
        const config: BennuNoteConfig = { ...DEFAULT_CONFIG, ...(configData.bennunote_config as Partial<BennuNoteConfig> | undefined) };

        const requestBody = {
          bvid: msg.bvid,
          model_size: config.whisperModelSize || 'small',
          cookie: config.bilibiliCookie || '',
          language: msg.language,
        };
        console.log(`[BennuNote BG] POST /transcript body:`, JSON.stringify(requestBody));

        const startTime = Date.now();
        const resp = await fetch('http://localhost:2185/transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log(`[BennuNote BG] /transcript response: HTTP ${resp.status} (${elapsed}s)`);
        const data = await resp.json();
        console.log(`[BennuNote BG] /transcript data: source=${data.source}, items=${data.items?.length}, duration=${data.duration}`);

        if (resp.ok && data.items) {
          console.log(`[BennuNote BG] /transcript success: ${data.items.length} segments, source=${data.source}`);
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              type: 'TRANSCRIPT_RESULT',
              result: {
                source: data.source,
                items: data.items,
                language: msg.language,
              },
            }, () => { void chrome.runtime.lastError; });
            console.log(`[BennuNote BG] TRANSCRIPT_RESULT sent to tab ${tabId}`);
          } else {
            console.error('[BennuNote BG] No tabId to send TRANSCRIPT_RESULT to!');
          }
        } else {
          const detail = data.detail || 'Unknown error';
          console.error(`[BennuNote BG] /transcript failed:`, detail);
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              type: 'TRANSCRIPT_RESULT',
              result: null,
              error: typeof detail === 'string' ? detail : JSON.stringify(detail),
            }, () => { void chrome.runtime.lastError; });
          }
        }
      } catch (err) {
        console.error('[BennuNote BG] /transcript request error:', err);
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: 'TRANSCRIPT_RESULT',
            result: null,
            error: `Backend request failed: ${err}`,
          }, () => { void chrome.runtime.lastError; });
        }
      }
    })();

    sendResponse({ ok: true });
    return false;
  }

  // Content script → Backend: write to Feishu
  if (msg.type === 'WRITE_FEISHU') {
    const tabId = sender.tab?.id || activeTabId;

    (async () => {
      try {
        const configData = await chrome.storage.local.get('bennunote_config');
        const config: BennuNoteConfig = { ...DEFAULT_CONFIG, ...(configData.bennunote_config as Partial<BennuNoteConfig> | undefined) };

        const resp = await fetch('http://localhost:2185/write_feishu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: msg.text,
            title: msg.title,
            mode: config.feishuMode || 'new',
            doc_token: config.feishuDocToken || '',
            folder_token: config.feishuFolderToken || '',
          }),
        });

        const data = await resp.json();
        if (resp.ok && data.doc_url) {
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              type: 'WRITE_FEISHU_RESULT',
              success: true,
              docUrl: data.doc_url,
            });
          }
        } else {
          const detail = data.detail || 'Unknown error';
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              type: 'WRITE_FEISHU_RESULT',
              success: false,
              error: detail,
            });
          }
        }
      } catch (err) {
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: 'WRITE_FEISHU_RESULT',
            success: false,
            error: `${err}`,
          });
        }
      }
    })();

    sendResponse({ ok: true });
    return false;
  }

  // Content script → Backend: summarize subtitles with Claude AI
  if (msg.type === 'SUMMARIZE') {
    const tabId = sender.tab?.id || activeTabId;

    (async () => {
      try {
        const configData = await chrome.storage.local.get('bennunote_config');
        const config: BennuNoteConfig = { ...DEFAULT_CONFIG, ...(configData.bennunote_config as Partial<BennuNoteConfig> | undefined) };

        const resp = await fetch('http://localhost:2185/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: msg.text,
            title: msg.title,
          }),
        });

        const data = await resp.json();
        if (resp.ok && data.summary) {
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              type: 'SUMMARIZE_RESULT',
              success: true,
              summary: data.summary,
            });
          }
        } else {
          const detail = data.detail || 'Unknown error';
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              type: 'SUMMARIZE_RESULT',
              success: false,
              error: typeof detail === 'string' ? detail : JSON.stringify(detail),
            });
          }
        }
      } catch (err) {
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: 'SUMMARIZE_RESULT',
            success: false,
            error: `${err}`,
          });
        }
      }
    })();

    sendResponse({ ok: true });
    return false;
  }

  // Content script → auto-save log to Downloads/BennuNote-logs/
  if (msg.type === 'SAVE_LOG') {
    // Use data URL because Blob/createObjectURL is not available in Service Workers
    const dataUrl = 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(msg.content)));
    chrome.downloads.download(
      {
        url: dataUrl,
        filename: `BennuNote-logs/${msg.filename}`,
        conflictAction: 'uniquify',
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('[BennuNote] Log save failed:', chrome.runtime.lastError.message);
        } else {
          console.log(`[BennuNote] Log saved, downloadId=${downloadId}`);
        }
      }
    );
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
