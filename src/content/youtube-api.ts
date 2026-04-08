import type { SubtitleItem, SubtitleResult, VideoInfo } from '../shared/types';

// ─── Internal types ──────────────────────────────────────────────────────────

interface YtCaptionTrack {
  baseUrl: string;
  name: { simpleText: string };
  vssId: string;          // ".en" = manual CC, "a.en" = auto-generated
  languageCode: string;   // e.g. "zh-Hans", "en", "ja"
  isTranslatable: boolean;
}

interface YtState {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string | null;
  captionTracks: YtCaptionTrack[];
  translationLanguages: Array<{ languageCode: string; languageName: { simpleText: string } }>;
}

export interface YtDebugInfo {
  videoId?: string;
  trackCount: number;
  allTracks: string;      // human-readable comma-separated list
  chosenTrack?: string;
  langMatched: boolean;
  usedTranslation: boolean;
  fetchUrl?: string;
  staleWarning?: string;
}

type LogFn = (msg: string, level?: string) => void;
let _log: LogFn = () => {};

export function setYtLogFn(fn: LogFn): void {
  _log = fn;
}

// ─── Bridge communication ─────────────────────────────────────────────────────

function readYtStateViaBridge(): Promise<YtState | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 1500);

    function handler(event: MessageEvent) {
      if (event.source !== window || event.data?.type !== 'BENNUNOTE_YT_STATE_RESULT') return;
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      resolve(event.data.state ?? null);
    }

    window.addEventListener('message', handler);
    window.postMessage({ type: 'BENNUNOTE_GET_YT_STATE' }, '*');
  });
}

// ─── Language helpers ─────────────────────────────────────────────────────────

/**
 * Map user-selected language code (zh/en/ja/ko) to YouTube languageCode candidates,
 * ordered from most to least specific.
 */
function ytLangCandidates(lang: string): string[] {
  if (lang === 'zh') return ['zh-Hans', 'zh-Hant', 'zh'];
  return [lang];
}

/**
 * Pick the best caption track for the preferred language.
 *
 * Priority:
 * 1. Manual CC track (vssId starts with '.') — exact language match
 * 2. Auto-generated track (vssId starts with 'a.') — exact language match
 * 3. Same, but prefix match (e.g. "zh-TW" matches candidate "zh")
 * 4. Translation fallback: any isTranslatable track + &tlang=<langCode>
 *
 * Returns { track, translatedUrl }. translatedUrl is non-null only for (4).
 */
export function pickYtTrack(
  tracks: YtCaptionTrack[],
  preferredLang: string,
): { track: YtCaptionTrack | null; translatedUrl: string | null } {
  const candidates = ytLangCandidates(preferredLang);
  const isManual = (t: YtCaptionTrack) => t.vssId.startsWith('.');
  const isAuto = (t: YtCaptionTrack) => t.vssId.startsWith('a.');

  // Exact language match — manual first, then auto
  for (const cand of candidates) {
    const manual = tracks.find((t) => isManual(t) && t.languageCode === cand);
    if (manual) return { track: manual, translatedUrl: null };
    const auto = tracks.find((t) => isAuto(t) && t.languageCode === cand);
    if (auto) return { track: auto, translatedUrl: null };
  }

  // Prefix match — manual first, then auto
  for (const cand of candidates) {
    const manual = tracks.find((t) => isManual(t) && t.languageCode.startsWith(cand));
    if (manual) return { track: manual, translatedUrl: null };
    const auto = tracks.find((t) => isAuto(t) && t.languageCode.startsWith(cand));
    if (auto) return { track: auto, translatedUrl: null };
  }

  // Translation fallback
  const translatableTrack = tracks.find((t) => t.isTranslatable);
  if (translatableTrack) {
    // YouTube uses BCP-47; map "zh" → "zh-Hans"
    const tlang = preferredLang === 'zh' ? 'zh-Hans' : preferredLang;
    const translatedUrl = `${translatableTrack.baseUrl}&tlang=${tlang}&fmt=json3`;
    return { track: translatableTrack, translatedUrl };
  }

  return { track: null, translatedUrl: null };
}

// ─── Subtitle fetching ────────────────────────────────────────────────────────

interface YtJson3Event {
  tStartMs: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}

async function fetchYtJson3(url: string): Promise<SubtitleItem[]> {
  const fetchUrl = url.includes('fmt=json3') ? url : `${url}&fmt=json3`;
  const resp = await fetch(fetchUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching YouTube subtitles`);
  const text = await resp.text();
  if (!text) throw new Error('Empty response from YouTube subtitle URL (token may be expired)');
  const data = JSON.parse(text) as { events?: YtJson3Event[] };
  const events: YtJson3Event[] = data.events ?? [];

  return events
    .filter((e) => Array.isArray(e.segs) && e.segs.length > 0 && (e.dDurationMs ?? 0) > 0)
    .map((e) => ({
      from: e.tStartMs / 1000,
      to: (e.tStartMs + (e.dDurationMs ?? 0)) / 1000,
      content: e
        .segs!.map((s) => s.utf8 ?? '')
        .join('')
        .replace(/\n/g, ' ')
        .trim(),
    }))
    .filter((item) => item.content.length > 0);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function extractYouTubeSubtitles(preferredLang: string): Promise<{
  videoInfo: VideoInfo | null;
  result: SubtitleResult | null;
  tracks: YtCaptionTrack[];
  debug: YtDebugInfo;
}> {
  const debug: YtDebugInfo = {
    trackCount: 0,
    allTracks: '',
    langMatched: false,
    usedTranslation: false,
  };

  _log('Reading ytInitialPlayerResponse via page bridge...', 'info');
  const state = await readYtStateViaBridge();

  if (!state) {
    _log('Page bridge returned null — ytInitialPlayerResponse not found.', 'error');
    return { videoInfo: null, result: null, tracks: [], debug };
  }

  debug.videoId = state.videoId;

  // SPA staleness check
  const urlVideoId = new URLSearchParams(window.location.search).get('v');
  if (urlVideoId && state.videoId !== urlVideoId) {
    debug.staleWarning = `Bridge returned stale data (${state.videoId}) vs URL (${urlVideoId})`;
    _log(`Warning: ${debug.staleWarning}. Try refreshing the page.`, 'warn');
  }

  const videoInfo: VideoInfo = {
    bvid: '',
    cid: 0,
    title: state.title,
    ownerName: state.author || undefined,
    coverUrl: state.thumbnail || undefined,
    platform: 'youtube',
    youtubeVideoId: state.videoId,
  };

  const tracks: YtCaptionTrack[] = state.captionTracks;
  debug.trackCount = tracks.length;
  debug.allTracks = tracks
    .map((t) => `${t.languageCode}(${t.vssId.startsWith('a.') ? 'auto' : 'cc'})`)
    .join(', ');

  if (tracks.length === 0) {
    return { videoInfo, result: null, tracks, debug };
  }

  const { track, translatedUrl } = pickYtTrack(tracks, preferredLang);

  if (!track) {
    return { videoInfo, result: null, tracks, debug };
  }

  const isAuto = track.vssId.startsWith('a.');
  const usedTranslation = translatedUrl !== null;
  debug.usedTranslation = usedTranslation;
  debug.langMatched = !usedTranslation;
  debug.chosenTrack = `${track.languageCode} (${isAuto ? 'auto' : 'cc'})${usedTranslation ? ' → translated' : ''}`;

  const fetchUrl = translatedUrl ?? `${track.baseUrl}&fmt=json3`;
  debug.fetchUrl = fetchUrl;

  _log(
    `Fetching: ${track.languageCode} ${isAuto ? '[auto]' : '[cc]'}${usedTranslation ? ' with translation' : ''}`,
    'info',
  );

  let items: SubtitleItem[];
  try {
    items = await fetchYtJson3(fetchUrl);
  } catch (err) {
    _log(`Failed to fetch subtitle content: ${err}`, 'error');
    return { videoInfo, result: null, tracks, debug };
  }

  const source = usedTranslation || isAuto ? 'yt_auto' : 'yt_cc';
  const result: SubtitleResult = {
    source,
    items,
    language: track.name?.simpleText ?? track.languageCode,
  };

  return { videoInfo, result, tracks, debug };
}
