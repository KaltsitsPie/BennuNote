export interface SubtitleItem {
  from: number;
  to: number;
  content: string;
}

export interface VideoInfo {
  bvid: string;
  cid: number;
  title: string;
  partTitle?: string;
}

export type SubtitleSource = 'ai' | 'cc' | 'whisper';

export interface SubtitleResult {
  source: SubtitleSource;
  items: SubtitleItem[];
  language?: string;
}

export interface SubtitleTrack {
  lan: string;
  lan_doc: string;
  subtitle_url: string;
}

export interface WhisperProgress {
  status: 'loading-model' | 'transcribing' | 'done' | 'error';
  progress?: number;
  message?: string;
}
