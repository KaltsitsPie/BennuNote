import type { Message } from './shared/messages';

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Whisper speech-to-text transcription',
  });
}

// Track which tab initiated the transcription so we can route results back
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

  // Content script → forward audio to offscreen for Whisper
  if (msg.type === 'TRANSCRIBE_AUDIO') {
    // Remember which tab sent this
    if (sender.tab?.id) {
      activeTabId = sender.tab.id;
    }
    ensureOffscreenDocument()
      .then(() => {
        chrome.runtime.sendMessage(msg);
      })
      .catch((err) => {
        console.error('[BennuNote BG] offscreen creation failed:', err);
        // Notify content script about the error
        if (activeTabId) {
          chrome.tabs.sendMessage(activeTabId, {
            type: 'TRANSCRIBE_PROGRESS',
            progress: { status: 'error', message: `Offscreen document error: ${err}` },
          });
        }
      });
    sendResponse({ ok: true });
    return false;
  }

  // Offscreen → forward progress/result back to the content script tab
  if (msg.type === 'TRANSCRIBE_PROGRESS' || msg.type === 'TRANSCRIBE_RESULT') {
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, msg, () => {
        // Ignore errors if tab is closed
        void chrome.runtime.lastError;
      });
    }
    return false;
  }

  // Preload result from offscreen — just log it
  if (msg.type === 'PRELOAD_RESULT') {
    console.log(`[BennuNote] Preload result: success=${msg.success}, cached=${msg.cached}`);
    return false;
  }

  return false;
});

// Preload Whisper model on install and browser startup
async function preloadModel() {
  try {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({ type: 'PRELOAD_MODEL' }, () => {
      // Ignore errors if offscreen not ready yet
      void chrome.runtime.lastError;
    });
    console.log('[BennuNote] Preload request sent to offscreen document');
  } catch (err) {
    console.warn('[BennuNote] Preload failed:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[BennuNote] Extension installed, preloading Whisper model...');
  preloadModel();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[BennuNote] Browser started, preloading Whisper model...');
  preloadModel();
});
