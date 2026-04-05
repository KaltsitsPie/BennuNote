import { extractVideoInfo, fetchSubtitles, fetchAudioUrl, loadTrack, setLogFn } from './bilibili-api';
import { SubtitlePanel } from './subtitle-panel';
import type { Message } from '../shared/messages';

let panel: SubtitlePanel | null = null;

function getPanel(): SubtitlePanel {
  if (!panel) {
    panel = new SubtitlePanel();
    // Wire up log so bilibili-api.ts can emit to the panel too
    setLogFn((msg, level) => panel!.log(msg, (level as 'info') || 'info'));
  }
  return panel;
}

// Listen for messages from background/popup
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  try {
    if (msg.type === 'EXTRACT_SUBTITLES') {
      handleExtract();
      sendResponse({ ok: true });
    }
    if (msg.type === 'TRANSCRIBE_PROGRESS') {
      getPanel().setProgress(msg.progress);
    }
    if (msg.type === 'TRANSCRIBE_RESULT') {
      if (msg.result) {
        getPanel().setSubtitles(msg.result.items, msg.result.source);
      } else {
        getPanel().log(msg.error || 'Transcription returned no result', 'error');
      }
    }
  } catch (err) {
    getPanel().log(`Message handler error: ${err}`, 'error');
  }
  return false;
});

async function handleExtract() {
  const p = getPanel();
  p.show();
  p.log('--- New extraction started ---', 'step');

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
  if (videoInfo.partTitle) {
    p.log(`Part: ${videoInfo.partTitle}`, 'info');
  }

  // Step 2: Try fetching existing subtitles via API
  p.log('Step 2: Fetching subtitles from Bilibili API...', 'step');
  try {
    const { result, tracks, debug } = await fetchSubtitles(videoInfo.bvid, videoInfo.cid, 'zh');
    p.log(`API: ${debug.apiUrl}`, 'info');
    p.log(`Response: HTTP ${debug.responseCode}, code=${JSON.stringify(debug.rawResponse)}`, 'info');
    p.log(`Found ${debug.subtitleCount} subtitle track(s)`, 'info');
    if (debug.allTracks) {
      p.log(`Available: ${debug.allTracks}`, 'info');
    }

    if (result && result.items.length > 0) {
      if (debug.langMatched) {
        // Got subtitles in the requested language
        p.log(`Using: ${debug.chosenLang}, ${result.items.length} entries`, 'success');
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
              p.setSubtitles(newResult.items, newResult.source);
            } catch (err) {
              p.log(`Failed to load track: ${err}`, 'error');
            }
          });
        }
        return;
      }

      // Subtitles exist but NOT in the requested language
      p.log(`No zh subtitles found. Available: ${debug.allTracks}`, 'warn');
      if (!debug.isLoggedIn) {
        p.log('Not logged in to Bilibili. Login may be required for Chinese subtitles.', 'error');
      } else if (debug.needLoginSubtitle) {
        p.log('API says login needed for subtitles (but you ARE logged in — this may be a B站 API issue).', 'warn');
      }
      p.log(`Skipping ${debug.chosenLang} — will try Whisper for Chinese`, 'warn');

      // Still set up the language switcher so user can manually pick if they want
      if (tracks.length > 0) {
        const activeLan = tracks[0].lan;
        p.setTracks(tracks, activeLan, async (track) => {
          p.log(`Manually loading: ${track.lan} (${track.lan_doc})...`, 'step');
          try {
            const newResult = await loadTrack(track);
            p.log(`Loaded ${newResult.items.length} entries`, 'success');
            p.setSubtitles(newResult.items, newResult.source);
          } catch (err) {
            p.log(`Failed to load track: ${err}`, 'error');
          }
        });
      }
      // Fall through to Whisper
    } else {
      p.log('No subtitle tracks available for this video', 'warn');
    }
  } catch (err) {
    p.log(`Subtitle API error: ${err}`, 'error');
  }

  // Step 3: Fallback - get audio URL for Whisper
  p.log('Step 3: Getting audio stream URL for Whisper fallback...', 'step');
  try {
    const { url: audioUrl, debug } = await fetchAudioUrl(videoInfo.bvid, videoInfo.cid);
    p.log(`API: ${debug.apiUrl}`, 'info');
    p.log(`Response: HTTP ${debug.responseCode}, code=${JSON.stringify(debug.rawResponse)}`, 'info');
    p.log(`Audio streams found: ${debug.streamCount}`, 'info');

    if (!audioUrl) {
      p.log('No audio stream URL available', 'error');
      return;
    }

    p.log(`Audio bandwidth: ${debug.chosenBandwidth}`, 'info');
    p.log('Sending audio URL to background for download + Whisper...', 'info');

    chrome.runtime.sendMessage(
      {
        type: 'TRANSCRIBE_AUDIO',
        audioUrl,
        bvid: videoInfo.bvid,
        cid: videoInfo.cid,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          p.log(`Failed to send to background: ${chrome.runtime.lastError.message}`, 'error');
        } else {
          p.log('Request sent. Background will download audio and run Whisper.', 'info');
        }
      }
    );
  } catch (err) {
    p.log(`Audio extraction error: ${err}`, 'error');
  }
}
