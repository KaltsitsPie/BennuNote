import type { SubtitleItem, SubtitleResult, SubtitleTrack, VideoInfo } from '../shared/types';

// Log callback set by content/index.ts so we can emit debug info
type LogFn = (msg: string, level?: string) => void;
let _log: LogFn = () => {};
export function setLogFn(fn: LogFn) { _log = fn; }

/**
 * Extract bvid from the current page URL.
 */
function extractBvid(): string | null {
  const m = window.location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

/**
 * Try reading __INITIAL_STATE__ by injecting a page-level script.
 * Content scripts live in an isolated world, so we bridge via a DOM element.
 */
function readInitialStateViaInjection(): Record<string, unknown> | null {
  try {
    const id = '__bennunote_state_' + Date.now();
    const el = document.createElement('div');
    el.id = id;
    el.style.display = 'none';
    document.documentElement.appendChild(el);

    const script = document.createElement('script');
    script.textContent = `
      try {
        var s = window.__INITIAL_STATE__;
        if (s && s.videoData) {
          document.getElementById('${id}').setAttribute('data-state', JSON.stringify({
            bvid: s.videoData.bvid,
            cid: s.videoData.cid,
            title: s.videoData.title,
            pages: (s.videoData.pages || []).map(function(p){ return {cid:p.cid, part:p.part}; })
          }));
        }
      } catch(e) {}
    `;
    document.documentElement.appendChild(script);
    script.remove();

    const raw = el.getAttribute('data-state');
    el.remove();

    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // injection failed (CSP or other), fall through
  }
  return null;
}

/**
 * Fetch video info from B站 API given a bvid.
 */
async function fetchVideoInfoFromApi(bvid: string): Promise<VideoInfo | null> {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
  _log(`Fetching video info: ${url}`, 'info');
  const resp = await fetch(url, { credentials: 'include' });
  const json = await resp.json();
  _log(`view API response: code=${json?.code}, message=${json?.message}`, 'info');

  if (json?.code !== 0 || !json?.data) return null;

  const d = json.data;
  const params = new URLSearchParams(window.location.search);
  const p = parseInt(params.get('p') || '1', 10);
  const page = d.pages?.[p - 1];

  return {
    bvid: d.bvid,
    cid: page?.cid || d.cid,
    title: d.title,
    partTitle: page?.part,
  };
}

/**
 * Main entry: extract VideoInfo using multiple strategies.
 */
export async function extractVideoInfo(): Promise<VideoInfo | null> {
  // Strategy 1: Inject script to read __INITIAL_STATE__ from the page context
  _log('Trying __INITIAL_STATE__ injection...', 'info');
  const state = readInitialStateViaInjection();
  if (state && state.bvid && state.cid) {
    const params = new URLSearchParams(window.location.search);
    const p = parseInt(params.get('p') || '1', 10);
    const pages = state.pages as Array<{ cid: number; part: string }> | undefined;
    const page = pages?.[p - 1];
    _log('Got video info from __INITIAL_STATE__', 'success');
    return {
      bvid: state.bvid as string,
      cid: (page?.cid || state.cid) as number,
      title: state.title as string,
      partTitle: page?.part,
    };
  }
  _log('__INITIAL_STATE__ not available', 'warn');

  // Strategy 2: Extract bvid from URL, then call B站 API for cid
  const bvid = extractBvid();
  if (!bvid) {
    _log('No BV id found in URL', 'error');
    return null;
  }
  _log(`Found bvid from URL: ${bvid}`, 'info');
  _log('Fetching cid from Bilibili API...', 'info');
  return fetchVideoInfoFromApi(bvid);
}

export interface FetchSubtitlesDebug {
  apiUrl: string;
  responseCode?: number;
  subtitleCount: number;
  chosenLang?: string;
  allTracks?: string;
  langMatched: boolean;
  rawResponse?: unknown;
}

/**
 * Fetch available subtitle tracks from the Bilibili player API.
 * Returns all tracks + auto-selects the best one based on preferredLang.
 */
export async function fetchSubtitles(
  bvid: string,
  cid: number,
  preferredLang: string = 'zh',
): Promise<{ result: SubtitleResult | null; tracks: SubtitleTrack[]; debug: FetchSubtitlesDebug }> {
  const apiUrl = `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`;
  const debug: FetchSubtitlesDebug = { apiUrl, subtitleCount: 0, langMatched: false };

  const resp = await fetch(apiUrl, { credentials: 'include' });
  debug.responseCode = resp.status;
  const data = await resp.json();
  debug.rawResponse = { code: data?.code, message: data?.message };

  if (data?.code !== 0) {
    return { result: null, tracks: [], debug };
  }

  const rawTracks: Array<{ subtitle_url: string; lan: string; lan_doc: string }> =
    data?.data?.subtitle?.subtitles || [];
  debug.subtitleCount = rawTracks.length;

  const tracks: SubtitleTrack[] = rawTracks.map((t) => ({
    lan: t.lan,
    lan_doc: t.lan_doc,
    subtitle_url: t.subtitle_url.startsWith('//') ? `https:${t.subtitle_url}` : t.subtitle_url,
  }));

  debug.allTracks = tracks.map((t) => `${t.lan} (${t.lan_doc})`).join(', ');

  if (tracks.length === 0) return { result: null, tracks, debug };

  // Pick the best track matching preferredLang
  const { track: preferred, matched } = pickTrack(tracks, preferredLang);
  debug.chosenLang = `${preferred.lan} (${preferred.lan_doc})`;
  debug.langMatched = matched;

  const result = await loadTrack(preferred);
  return { result, tracks, debug };
}

/**
 * Pick the best subtitle track for a given language preference.
 * Returns { track, matched } where matched=true means the track's language
 * actually matches the requested language (not a fallback to a different language).
 */
function pickTrack(tracks: SubtitleTrack[], lang: string): { track: SubtitleTrack; matched: boolean } {
  const langBase = lang.replace(/^ai-/, '');

  // Direct matches for the requested language
  const directMatch =
    tracks.find((t) => t.lan === `ai-${langBase}`) ||
    tracks.find((t) => t.lan === langBase) ||
    tracks.find((t) => t.lan.startsWith(`ai-${langBase}`)) ||
    tracks.find((t) => t.lan.startsWith(langBase));

  if (directMatch) {
    return { track: directMatch, matched: true };
  }

  // Fallback: no match for requested language
  const fallback =
    tracks.find((t) => t.lan === 'ai-zh') ||
    tracks.find((t) => t.lan.startsWith('zh')) ||
    tracks[0];

  return { track: fallback, matched: false };
}

/**
 * Load subtitle content from a specific track URL.
 */
export async function loadTrack(track: SubtitleTrack): Promise<SubtitleResult> {
  const subResp = await fetch(track.subtitle_url);
  const subData = await subResp.json();

  const items: SubtitleItem[] = (subData.body || []).map(
    (item: { from: number; to: number; content: string }) => ({
      from: item.from,
      to: item.to,
      content: item.content,
    })
  );

  const source = track.lan.startsWith('ai-') ? 'ai' : 'cc';
  return { source, items, language: track.lan_doc };
}

export interface FetchAudioDebug {
  apiUrl: string;
  responseCode?: number;
  streamCount: number;
  chosenBandwidth?: number;
  rawResponse?: unknown;
}

export async function fetchAudioUrl(
  bvid: string,
  cid: number
): Promise<{ url: string | null; debug: FetchAudioDebug }> {
  const apiUrl = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=4048&fnver=0&fourk=1`;
  const debug: FetchAudioDebug = { apiUrl, streamCount: 0 };

  const resp = await fetch(apiUrl, { credentials: 'include' });
  debug.responseCode = resp.status;
  const data = await resp.json();
  debug.rawResponse = { code: data?.code, message: data?.message };

  const audioStreams = data?.data?.dash?.audio;
  if (!audioStreams || audioStreams.length === 0) {
    return { url: null, debug };
  }

  debug.streamCount = audioStreams.length;

  // Pick lowest quality (smallest file, faster download)
  const sorted = [...audioStreams].sort(
    (a: { bandwidth: number }, b: { bandwidth: number }) => a.bandwidth - b.bandwidth
  );
  debug.chosenBandwidth = sorted[0].bandwidth;
  const url = sorted[0].baseUrl || sorted[0].base_url || null;
  return { url, debug };
}
