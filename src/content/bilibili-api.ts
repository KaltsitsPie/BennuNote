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
 * Read __INITIAL_STATE__ from the page context via the MAIN world page-bridge script.
 * Uses window.postMessage to communicate across worlds (CSP-safe).
 */
function readInitialStateViaBridge(): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 1000);

    function handler(event: MessageEvent) {
      if (event.source !== window || event.data?.type !== 'BENNUNOTE_STATE_RESULT') return;
      window.removeEventListener('message', handler);
      clearTimeout(timeout);
      resolve(event.data.state);
    }

    window.addEventListener('message', handler);
    window.postMessage({ type: 'BENNUNOTE_GET_STATE' }, '*');
  });
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
    ownerName: d.owner?.name,
    ownerMid: d.owner?.mid,
    coverUrl: d.pic,
    pubdate: d.pubdate,
    desc: d.desc,
  };
}

/**
 * Main entry: extract VideoInfo using multiple strategies.
 */
export async function extractVideoInfo(): Promise<VideoInfo | null> {
  // Strategy 1: Read __INITIAL_STATE__ via MAIN world bridge script
  _log('Trying __INITIAL_STATE__ via page bridge...', 'info');
  const state = await readInitialStateViaBridge();
  if (state && state.bvid && state.cid) {
    const params = new URLSearchParams(window.location.search);
    const p = parseInt(params.get('p') || '1', 10);
    const pages = state.pages as Array<{ cid: number; part: string }> | undefined;
    const page = pages?.[p - 1];
    _log('Got video info from __INITIAL_STATE__ (page bridge)', 'success');
    return {
      bvid: state.bvid as string,
      cid: (page?.cid || state.cid) as number,
      title: state.title as string,
      partTitle: page?.part,
      ownerName: state.ownerName as string | undefined,
      ownerMid: state.ownerMid as number | undefined,
      coverUrl: state.coverUrl as string | undefined,
      pubdate: state.pubdate as number | undefined,
      desc: state.desc as string | undefined,
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
  needLoginSubtitle?: boolean;
  isLoggedIn: boolean;
  uname?: string;
  rawResponse?: unknown;
  subtitleRaw?: unknown;
}

/**
 * Check login status via Bilibili's nav API (reliable, unlike checking HttpOnly cookies).
 */
async function checkLoginStatus(): Promise<{ isLoggedIn: boolean; uname?: string }> {
  try {
    const resp = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
    const data = await resp.json();
    if (data?.code === 0 && data?.data?.isLogin) {
      return { isLoggedIn: true, uname: data.data.uname };
    }
    return { isLoggedIn: false };
  } catch {
    return { isLoggedIn: false };
  }
}

/**
 * Fetch subtitle tracks from the Bilibili player API.
 * If the preferred language is not found on the first try, retries once after 1s
 * (the API has known inconsistency where repeated requests may return different tracks).
 */
export async function fetchSubtitles(
  bvid: string,
  cid: number,
  preferredLang: string = 'zh',
): Promise<{ result: SubtitleResult | null; tracks: SubtitleTrack[]; debug: FetchSubtitlesDebug }> {
  const firstAttempt = await _fetchSubtitlesOnce(bvid, cid, preferredLang);

  // If we didn't match the preferred language but got some tracks, retry once
  if (!firstAttempt.debug.langMatched && firstAttempt.tracks.length > 0) {
    _log('Preferred language not found, retrying in 1s (API inconsistency workaround)...', 'warn');
    await new Promise((r) => setTimeout(r, 1000));
    const retry = await _fetchSubtitlesOnce(bvid, cid, preferredLang);
    if (retry.debug.langMatched) {
      _log('Retry succeeded — got target language', 'success');
      return retry;
    }
    _log('Retry returned same result', 'info');
  }

  return firstAttempt;
}

async function _fetchSubtitlesOnce(
  bvid: string,
  cid: number,
  preferredLang: string,
): Promise<{ result: SubtitleResult | null; tracks: SubtitleTrack[]; debug: FetchSubtitlesDebug }> {
  const apiUrl = `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`;

  // Check login status via nav API
  const loginStatus = await checkLoginStatus();

  const debug: FetchSubtitlesDebug = {
    apiUrl,
    subtitleCount: 0,
    langMatched: false,
    isLoggedIn: loginStatus.isLoggedIn,
    uname: loginStatus.uname,
  };

  _log(`Login: ${loginStatus.isLoggedIn ? `YES (${loginStatus.uname})` : 'NO'}`, loginStatus.isLoggedIn ? 'success' : 'warn');

  const resp = await fetch(apiUrl, {
    credentials: 'include',
    headers: { 'Referer': window.location.href },
  });
  debug.responseCode = resp.status;
  const data = await resp.json();
  debug.rawResponse = { code: data?.code, message: data?.message };

  if (data?.code !== 0) {
    return { result: null, tracks: [], debug };
  }

  // Check authentication-related flags
  const subtitleData = data?.data?.subtitle;
  debug.needLoginSubtitle = !!data?.data?.need_login_subtitle;
  // Log the raw subtitle object for debugging
  debug.subtitleRaw = subtitleData;

  _log(`need_login_subtitle=${debug.needLoginSubtitle}`, 'info');
  if (subtitleData?.allow_submit !== undefined) {
    _log(`allow_submit=${subtitleData.allow_submit}`, 'info');
  }
  _log(`Subtitle API raw: ${JSON.stringify(subtitleData)}`, 'info');

  const rawTracks: Array<{ subtitle_url: string; lan: string; lan_doc: string }> =
    subtitleData?.subtitles || [];
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

