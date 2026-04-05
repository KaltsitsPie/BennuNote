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

  // Content script → fetch audio in background (has host_permissions) → forward to offscreen
  if (msg.type === 'TRANSCRIBE_AUDIO') {
    if (sender.tab?.id) {
      activeTabId = sender.tab.id;
    }
    const notifyProgress = (status: string, message: string) => {
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, {
          type: 'TRANSCRIBE_PROGRESS',
          progress: { status, message },
        }, () => { void chrome.runtime.lastError; });
      }
    };

    (async () => {
      try {
        // Fetch audio from CDN (background has host_permissions, no CORS)
        notifyProgress('transcribing', 'Downloading audio from CDN...');
        const resp = await fetch(msg.audioUrl, {
          headers: { 'Referer': 'https://www.bilibili.com/' },
        });
        if (!resp.ok) {
          notifyProgress('error', `Audio download failed: HTTP ${resp.status}`);
          return;
        }
        const buffer = await resp.arrayBuffer();
        const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(1);
        notifyProgress('transcribing', `Audio downloaded: ${sizeMB} MB. Encoding...`);

        // Convert to base64
        const uint8 = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 32768;
        for (let i = 0; i < uint8.length; i += chunkSize) {
          const slice = uint8.subarray(i, i + chunkSize);
          for (let j = 0; j < slice.length; j++) {
            binary += String.fromCharCode(slice[j]);
          }
        }
        const audioBase64 = btoa(binary);
        notifyProgress('transcribing', `Sending ${(audioBase64.length / 1024 / 1024).toFixed(1)} MB to Whisper...`);

        // Ensure offscreen document exists and forward
        await ensureOffscreenDocument();
        chrome.runtime.sendMessage({ type: 'TRANSCRIBE_AUDIO_DATA', audioBase64 });
      } catch (err) {
        console.error('[BennuNote BG] audio fetch/forward failed:', err);
        notifyProgress('error', `Audio fetch error: ${err}`);
      }
    })();

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
