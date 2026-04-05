import { extractVideoInfo, fetchSubtitles, loadTrack, setLogFn } from './bilibili-api';
import { SubtitlePanel } from './subtitle-panel';
import type { Message } from '../shared/messages';
import type { SubtitleItem } from '../shared/types';

let panel: SubtitlePanel | null = null;
let currentVideoInfo: { bvid: string; cid: number; title: string } | null = null;
let currentItems: SubtitleItem[] = [];
let backendOnline = false;

function getPanel(): SubtitlePanel {
  if (!panel) {
    panel = new SubtitlePanel();
    // Wire up log so bilibili-api.ts can emit to the panel too
    setLogFn((msg, level) => panel!.log(msg, (level as 'info') || 'info'));

    panel.setSyncHandler(() => {
      if (currentVideoInfo && panel) {
        panel.setFeishuSyncing(true);
        panel.log('Syncing subtitles to Feishu...', 'step');
        const text = currentItems.map(i => i.content).join('\n');
        const title = `${currentVideoInfo.title} - ${new Date().toLocaleDateString('zh-CN')}`;
        chrome.runtime.sendMessage({ type: 'WRITE_FEISHU', text, title });
      }
    });

    panel.setSummarizeHandler(() => {
      if (currentVideoInfo && currentItems.length > 0 && panel) {
        panel.setSummarizing(true);
        panel.log('Generating AI summary...', 'step');
        const text = currentItems.map(i => i.content).join('\n');
        const title = currentVideoInfo.title;
        chrome.runtime.sendMessage({ type: 'SUMMARIZE', text, title });
      }
    });
  }
  return panel;
}

// Listen for messages from background/popup
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  try {
    if (msg.type === 'EXTRACT_SUBTITLES') {
      handleExtract(msg.language || 'zh');
      sendResponse({ ok: true });
    }
    if (msg.type === 'TRANSCRIPT_RESULT') {
      // Clear waiting timer
      const timer = (window as unknown as Record<string, unknown>).__bennuWaitTimer;
      if (timer) {
        clearInterval(timer as ReturnType<typeof setInterval>);
        (window as unknown as Record<string, unknown>).__bennuWaitTimer = null;
      }

      const p = getPanel();
      if (msg.result && msg.result.items.length > 0) {
        p.log(`Backend transcription complete: ${msg.result.items.length} segments (source: ${msg.result.source})`, 'success');
        currentItems = msg.result.items;
        p.setSubtitles(msg.result.items, msg.result.source);
      } else {
        p.log(`Backend transcription failed: ${msg.error || 'no result'}`, 'error');
        p.log('Check the Python backend terminal for detailed error logs.', 'warn');
      }
    }
    if (msg.type === 'WRITE_FEISHU_RESULT') {
      const p = getPanel();
      p.setFeishuSyncing(false);
      if (msg.success && msg.docUrl) {
        p.log('Feishu sync successful!', 'success');
        p.showFeishuLink(msg.docUrl);
      } else {
        p.log(`Feishu sync failed: ${msg.error}`, 'error');
      }
    }
    if (msg.type === 'SUMMARIZE_RESULT') {
      const p = getPanel();
      p.setSummarizing(false);
      if (msg.success && msg.summary) {
        p.log('Summary generated!', 'success');
        p.setSummary(msg.summary);
      } else {
        p.log(`Summary failed: ${msg.error}`, 'error');
      }
    }
  } catch (err) {
    getPanel().log(`Message handler error: ${err}`, 'error');
  }
  return false;
});

async function handleExtract(language: string) {
  const p = getPanel();
  p.show();
  p.log('--- New extraction started ---', 'step');
  p.log(`Target language: ${language}`, 'info');

  // Check backend health
  backendOnline = false;
  try {
    p.log('Checking backend service...', 'info');
    const resp = await fetch('http://localhost:2185/health', { signal: AbortSignal.timeout(2000) });
    const data = await resp.json();
    backendOnline = data.status === 'ok';
    p.setServiceStatus(backendOnline);
    p.log(`Backend service: ${backendOnline ? 'online' : 'offline'}`, backendOnline ? 'success' : 'warn');
  } catch {
    p.setServiceStatus(false);
    p.log('Backend service: offline (cannot reach localhost:2185)', 'warn');
  }

  // Step 1: Extract video info
  p.log('Step 1: Extracting video info...', 'step');
  let videoInfo;
  try {
    videoInfo = await extractVideoInfo();
  } catch (err) {
    p.log(`extractVideoInfo() threw: ${err}`, 'error');
    return;
  }

  if (!videoInfo) {
    p.log('Could not find bvid/cid on this page.', 'error');
    p.log(`URL: ${window.location.href}`, 'info');
    p.log('Hint: make sure you are on a bilibili.com/video/ page', 'warn');
    return;
  }

  p.log(`bvid=${videoInfo.bvid}  cid=${videoInfo.cid}`, 'success');
  p.log(`Title: ${videoInfo.title}`, 'info');
  currentVideoInfo = videoInfo;
  if (videoInfo.partTitle) {
    p.log(`Part: ${videoInfo.partTitle}`, 'info');
  }

  // Step 2: Try fetching existing subtitles via Bilibili Player API (strict language match)
  p.log('Step 2: Fetching subtitles from Bilibili API...', 'step');
  let stage1Failed = false;
  try {
    const { result, tracks, debug } = await fetchSubtitles(videoInfo.bvid, videoInfo.cid, language);
    p.log(`API: ${debug.apiUrl}`, 'info');
    p.log(`Response: HTTP ${debug.responseCode}, code=${JSON.stringify(debug.rawResponse)}`, 'info');
    p.log(`Found ${debug.subtitleCount} subtitle track(s)`, 'info');
    if (debug.allTracks) {
      p.log(`Available: ${debug.allTracks}`, 'info');
    }

    if (result && result.items.length > 0 && debug.langMatched) {
      // Got subtitles in the requested language
      p.log(`Using: ${debug.chosenLang}, ${result.items.length} entries`, 'success');
      currentItems = result.items;
      p.setSubtitles(result.items, result.source);

      // Set up language switcher if multiple tracks available
      if (tracks.length > 1) {
        const activeLan = tracks.find(
          (t) => `${t.lan} (${t.lan_doc})` === debug.chosenLang
        )?.lan || tracks[0].lan;

        p.setTracks(tracks, activeLan, async (track) => {
          p.log(`Switching to: ${track.lan} (${track.lan_doc})...`, 'step');
          try {
            const newResult = await loadTrack(track);
            p.log(`Loaded ${newResult.items.length} entries`, 'success');
            currentItems = newResult.items;
            p.setSubtitles(newResult.items, newResult.source);
          } catch (err) {
            p.log(`Failed to load track: ${err}`, 'error');
          }
        });
      }
      return; // Success — done
    }

    // Failed to get subtitles in the requested language
    stage1Failed = true;
    if (tracks.length === 0) {
      p.log('No subtitle tracks available for this video', 'warn');
    } else {
      p.log(`No "${language}" subtitles found. Available: ${debug.allTracks}`, 'warn');
      if (!debug.isLoggedIn) {
        p.log('Not logged in to Bilibili. Login may be required for AI subtitles.', 'warn');
      }
    }
  } catch (err) {
    stage1Failed = true;
    p.log(`Subtitle API error: ${err}`, 'error');
  }

  // Step 3: Fallback to backend service (Bcut ASR → Whisper)
  if (stage1Failed) {
    p.log('Stage 1 failed. Falling back to backend service...', 'step');

    if (!backendOnline) {
      p.log('Backend service is offline — cannot fallback to transcription.', 'error');
      p.log('Please start the backend (cd server && python main.py) and try again.', 'warn');
      return;
    }

    p.log(`Step 3: Requesting backend transcription for ${videoInfo.bvid}...`, 'step');
    p.log('Backend will try: Bcut ASR → Whisper (this may take a while)', 'info');

    // Start a waiting indicator so the user knows we're still working
    let waitSeconds = 0;
    const waitTimer = setInterval(() => {
      waitSeconds += 10;
      p.log(`Still waiting for backend... (${waitSeconds}s elapsed)`, 'info');
    }, 10000);

    // Store timer so TRANSCRIPT_RESULT handler can clear it
    (window as unknown as Record<string, unknown>).__bennuWaitTimer = waitTimer;

    chrome.runtime.sendMessage(
      {
        type: 'TRANSCRIPT_REQUEST',
        bvid: videoInfo.bvid,
        language,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          clearInterval(waitTimer);
          p.log(`Failed to send transcript request: ${chrome.runtime.lastError.message}`, 'error');
        } else {
          p.log('Transcript request sent to background. Waiting for backend response...', 'info');
          p.log('(Backend: downloading audio → Bcut ASR → Whisper fallback)', 'info');
        }
      }
    );
  }
}
