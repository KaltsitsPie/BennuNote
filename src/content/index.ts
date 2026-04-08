import { extractVideoInfo, fetchSubtitles, loadTrack, setLogFn } from './bilibili-api';
import { extractYouTubeSubtitles, setYtLogFn } from './youtube-api';
import { SubtitlePanel } from './subtitle-panel';
import type { Message } from '../shared/messages';
import type { SubtitleItem, VideoInfo } from '../shared/types';
import { getConfig, parseFeishuToken } from '../shared/utils';

let panel: SubtitlePanel | null = null;
let currentVideoInfo: VideoInfo | null = null;
let currentItems: SubtitleItem[] = [];
let backendOnline = false;
let currentReqId = '';

// --- Video doc map (cross-session persistence for Feishu doc tokens) ---

type VideoDocEntry = { docToken: string; summaryAppended: boolean };

function getVideoId(info: VideoInfo): string {
  return info.bvid || info.youtubeVideoId || '';
}

async function readVideoDocMap(): Promise<Record<string, VideoDocEntry>> {
  const data = await chrome.storage.local.get('bennunote_video_docs');
  return (data.bennunote_video_docs as Record<string, VideoDocEntry>) || {};
}

async function writeVideoDocEntry(videoId: string, entry: VideoDocEntry): Promise<void> {
  const map = await readVideoDocMap();
  map[videoId] = entry;
  await chrome.storage.local.set({ bennunote_video_docs: map });
}

function getPanel(): SubtitlePanel {
  if (!panel) {
    panel = new SubtitlePanel();
    // Wire up log so bilibili-api.ts can emit to the panel too
    setLogFn((msg, level) => panel!.log(msg, (level as 'info') || 'info'));
    setYtLogFn((msg, level) => panel!.log(msg, (level as 'info') || 'info'));

    panel.setSyncHandler(async () => {
      if (!currentVideoInfo || !panel) return;
      const p = panel!;
      const videoId = getVideoId(currentVideoInfo);
      const summaryText = p.getSummaryText();
      p.setFeishuSyncing(true);

      // Read cross-session map
      const map = await readVideoDocMap();
      const entry = videoId ? map[videoId] : undefined;

      // Determine target doc token: footer input overrides map
      const footerToken = p.getWikiDocLink() || undefined;
      const mapToken = entry?.docToken;
      const targetDocToken = footerToken || mapToken;

      // Branch: append summary only?
      const appendSummaryOnly = !footerToken && !!mapToken && !!summaryText && !entry?.summaryAppended;

      // Guard: nothing new to sync
      if (targetDocToken && !appendSummaryOnly && !footerToken) {
        if (!summaryText) {
          p.showToast('已同步字幕，生成摘要后可再次同步', 'warn');
          p.setFeishuSyncing(false);
          return;
        }
        if (entry?.summaryAppended) {
          p.showToast('字幕和摘要均已同步', 'warn');
          p.setFeishuSyncing(false);
          return;
        }
      }
      p.log(appendSummaryOnly ? 'Appending summary to Feishu doc...' : 'Syncing to Feishu Wiki...', 'step');

      const merged = p.getMergedItems();
      const text = merged.map(i => i.content).join('\n');
      const items = merged.map(i => ({ from: i.from, to: i.to, content: i.content }));
      const title = `${currentVideoInfo!.title} - ${new Date().toLocaleDateString('zh-CN')}`;
      const youtubeUrl =
        currentVideoInfo!.platform === 'youtube' && currentVideoInfo!.youtubeVideoId
          ? `https://www.youtube.com/watch?v=${currentVideoInfo!.youtubeVideoId}`
          : undefined;
      const videoInfo = {
        bvid: currentVideoInfo!.bvid,
        title: currentVideoInfo!.title,
        ownerName: currentVideoInfo!.ownerName,
        ownerMid: currentVideoInfo!.ownerMid,
        coverUrl: currentVideoInfo!.coverUrl,
        pubdate: currentVideoInfo!.pubdate,
        desc: currentVideoInfo!.desc,
        videoUrl: youtubeUrl,
      };

      chrome.runtime.sendMessage(
        {
          type: 'WRITE_FEISHU',
          text,
          title,
          items,
          videoInfo,
          targetDocToken,
          summary: summaryText || undefined,
          appendSummaryOnly,
        },
        async (response) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message || 'Unknown error';
            p.log(`Feishu sync failed: ${errMsg}`, 'error');
            p.showToast(`Sync failed: ${errMsg}`, 'error');
            p.setFeishuSyncing(false);
            return;
          }
          if (response?.success && response.docUrl) {
            p.log(appendSummaryOnly ? 'Summary appended to Feishu!' : 'Feishu sync successful!', 'success');
            if (response.warning) p.log(`Warning: ${response.warning}`, 'warn');
            p.showToast(appendSummaryOnly ? 'Summary synced to Feishu' : 'Synced to Feishu', 'success', 3000);
            p.showFeishuLink(response.docUrl);

            // Update cross-session map
            try {
              if (videoId) {
                const parsedToken = parseFeishuToken(response.docUrl);
                if (!parsedToken) console.warn('BennuNote: Could not parse doc token from URL, storing full URL:', response.docUrl);
                const docToken = parsedToken || response.docUrl;
                const summaryAppended = appendSummaryOnly || !!summaryText;
                await writeVideoDocEntry(videoId, { docToken, summaryAppended });
              }
            } catch (err) {
              console.warn('BennuNote: Failed to persist video doc map:', err);
            }
            p.setFeishuSyncing(false);

            if (!targetDocToken && !appendSummaryOnly) {
              window.open(response.docUrl, '_blank');
            }
          } else {
            const errMsg = response?.error || 'Unknown error';
            p.log(`Feishu sync failed: ${errMsg}`, 'error');
            p.showToast(`Sync failed: ${errMsg}`, 'error');
            p.setFeishuSyncing(false);
          }
        },
      );
    });

    panel.setSummarizeHandler(() => {
      if (!currentVideoInfo || currentItems.length === 0 || !panel) return;
      const p = panel!;
      p.setSummarizing(true);
      p.log('Generating AI summary...', 'step');
      const text = currentItems.map(i => i.content).join('\n');
      const title = currentVideoInfo!.title;
      chrome.storage.local.get('bennunote_config', (data) => {
        const maxTokens = (data.bennunote_config as Record<string, unknown>)?.maxTokens as number || 4096;
        chrome.runtime.sendMessage({ type: 'SUMMARIZE', text, title, maxTokens }, (response) => {
          if (chrome.runtime.lastError) {
            p.setSummarizing(false);
            p.log(`Summary failed: ${chrome.runtime.lastError.message}`, 'error');
            return;
          }
          p.setSummarizing(false);
          if (response?.success && response.summary) {
            p.log('Summary generated!', 'success');
            p.setSummary(response.summary);
          } else {
            p.log(`Summary failed: ${response?.error || 'Unknown error'}`, 'error');
          }
        });
      });
    });
  }
  return panel;
}

async function fetchTranscript(
  p: ReturnType<typeof getPanel>,
  reqId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const startTime = Date.now();
  const waitTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    p.log(`[${reqId}] Still waiting for backend... (${elapsed}s elapsed)`, 'info');
  }, 10000);
  (window as unknown as Record<string, unknown>).__bennuWaitTimer = waitTimer;

  try {
    const resp = await fetch('http://localhost:2185/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    clearInterval(waitTimer);
    (window as unknown as Record<string, unknown>).__bennuWaitTimer = null;
    const data = await resp.json();
    if (resp.ok && data.items && data.items.length > 0) {
      p.log(`[${reqId}] Backend transcription complete: ${data.items.length} segments (source: ${data.source})`, 'success');
      currentItems = data.items;
      p.setSubtitles(data.items, data.source);
    } else {
      const err = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || 'Unknown error');
      p.log(`[${reqId}] Backend transcription failed: ${err}`, 'error');
      p.log('Check the Python backend terminal for detailed error logs.', 'warn');
    }
  } catch (err) {
    clearInterval(waitTimer);
    (window as unknown as Record<string, unknown>).__bennuWaitTimer = null;
    p.log(`[${reqId}] Backend request failed: ${err}`, 'error');
  }
}

// Listen for messages from background/popup
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  try {
    if (msg.type === 'EXTRACT_SUBTITLES') {
      handleExtract(msg.language || 'zh');
      sendResponse({ ok: true });
    }
  } catch (err) {
    getPanel().log(`Message handler error: ${err}`, 'error');
    sendResponse({ ok: false, error: String(err) });
  }
  return false;
});

async function checkBackendHealth(p: SubtitlePanel): Promise<boolean> {
  try {
    const resp = await fetch('http://localhost:2185/health', { signal: AbortSignal.timeout(2000) });
    const data = await resp.json();
    const online = data.status === 'ok';
    backendOnline = online;
    p.setServiceStatus(online);
    return online;
  } catch {
    backendOnline = false;
    p.setServiceStatus(false);
    return false;
  }
}

function detectPlatform(): 'bilibili' | 'youtube' | 'unknown' {
  const host = window.location.hostname;
  if (host.includes('bilibili.com')) return 'bilibili';
  if (host.includes('youtube.com')) return 'youtube';
  return 'unknown';
}

async function handleExtractYouTube(language: string) {
  const p = getPanel();

  const { videoInfo, result, tracks, debug } = await extractYouTubeSubtitles(language);

  p.log(`Track count: ${debug.trackCount}`, 'info');
  if (debug.allTracks) p.log(`Available: ${debug.allTracks}`, 'info');

  if (!videoInfo) {
    p.log('Could not find ytInitialPlayerResponse on this page.', 'error');
    p.log(`URL: ${window.location.href}`, 'info');
    p.log('Hint: try refreshing the page (SPA navigation may stale the player response)', 'warn');
    return;
  }

  p.log(`videoId=${videoInfo.youtubeVideoId}`, 'success');
  p.log(`Title: ${videoInfo.title}`, 'info');
  currentVideoInfo = videoInfo;
  p.setVideoInfo(videoInfo);

  if (!result || result.items.length === 0) {
    if (debug.trackCount === 0) {
      p.log('No subtitle tracks found on page.', 'warn');
    } else {
      p.log(`No "${language}" subtitles found on page (available: ${debug.allTracks}).`, 'warn');
    }
    p.log('Falling back to backend transcription (InnerTube API → Whisper)...', 'warn');

    const online = await checkBackendHealth(p);
    if (!online) {
      p.log('Backend service is offline — cannot fallback to transcription.', 'error');
      p.log('Start the backend: ./start-server.sh', 'warn');
      return;
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoInfo.youtubeVideoId}`;
    const reqId = Math.random().toString(36).slice(2, 8);
    currentReqId = reqId;
    p.log(`[${reqId}] Requesting backend transcription...`, 'step');

    const config = await getConfig();
    await fetchTranscript(p, reqId, {
      bvid: '',
      video_url: videoUrl,
      model_size: config.whisperModelSize || 'tiny',
      cookie: config.bilibiliCookie || '',
      language,
      req_id: reqId,
    });
    return;
  }

  p.log(`Using: ${debug.chosenTrack}${debug.usedTranslation ? ' (translated)' : ''}`, 'success');
  p.log(`${result.items.length} subtitle entries`, 'success');
  currentItems = result.items;
  p.setSubtitles(result.items, result.source);
}

async function handleExtract(language: string) {
  const p = getPanel();
  p.show();
  p.log('--- New extraction started ---', 'step');
  p.log(`Target language: ${language}`, 'info');

  const platform = detectPlatform();
  p.log(`Platform: ${platform}`, 'info');

  if (platform === 'youtube') {
    await handleExtractYouTube(language);
    return;
  }

  // Check backend health in background (non-blocking, just updates status dot)
  checkBackendHealth(p);

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
  p.setVideoInfo(videoInfo);
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

    // Now we actually need the backend — check if it's online
    p.log('Checking backend service...', 'info');
    const online = await checkBackendHealth(p);
    if (!online) {
      p.log('Backend service is offline — cannot fallback to transcription.', 'error');
      p.log('Start the backend: ./start-server.sh', 'warn');
      return;
    }
    p.log('Backend service: online', 'success');

    const reqId = Math.random().toString(36).slice(2, 8);
    currentReqId = reqId;
    p.log(`[${reqId}] Step 3: Requesting backend transcription for ${videoInfo.bvid}...`, 'step');
    p.log('Backend will try: Bcut ASR → Whisper (this may take a while)', 'info');

    const config = await getConfig();
    await fetchTranscript(p, reqId, {
      bvid: videoInfo.bvid,
      video_url: '',
      model_size: config.whisperModelSize || 'tiny',
      cookie: config.bilibiliCookie || '',
      language,
      req_id: reqId,
    });
  }
}
