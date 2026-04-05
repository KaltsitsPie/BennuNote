import type { SubtitleResult, WhisperProgress } from './types';

// Popup → Background → Content Script
export interface ExtractRequest {
  type: 'EXTRACT_SUBTITLES';
}

// Content Script → Background
export interface SubtitleApiResult {
  type: 'SUBTITLE_API_RESULT';
  result: SubtitleResult | null;
  videoInfo: { bvid: string; cid: number; title: string };
}

// Content Script → Background: fetch audio and forward to offscreen
export interface TranscribeRequest {
  type: 'TRANSCRIBE_AUDIO';
  audioUrl: string;
  bvid: string;
  cid: number;
}

// Background → Offscreen: audio data ready for transcription
export interface TranscribeAudioData {
  type: 'TRANSCRIBE_AUDIO_DATA';
  audioBase64: string;
}

// Offscreen → Background → Content Script
export interface TranscribeProgress {
  type: 'TRANSCRIBE_PROGRESS';
  progress: WhisperProgress;
}

export interface TranscribeResult {
  type: 'TRANSCRIBE_RESULT';
  result: SubtitleResult | null;
  error?: string;
}

// Content Script → Background (request audio URL)
export interface AudioUrlRequest {
  type: 'GET_AUDIO_URL';
  bvid: string;
  cid: number;
}

export interface AudioUrlResponse {
  type: 'AUDIO_URL_RESPONSE';
  url: string | null;
}

// Background → Offscreen: preload Whisper model
export interface PreloadModelRequest {
  type: 'PRELOAD_MODEL';
}

// Offscreen → Background: preload result
export interface PreloadModelResult {
  type: 'PRELOAD_RESULT';
  success: boolean;
  cached: boolean;
}

// Content Script → Background: auto-save log file
export interface SaveLogRequest {
  type: 'SAVE_LOG';
  content: string;
  filename: string;
}

export type Message =
  | ExtractRequest
  | SubtitleApiResult
  | TranscribeRequest
  | TranscribeProgress
  | TranscribeResult
  | AudioUrlRequest
  | AudioUrlResponse
  | PreloadModelRequest
  | PreloadModelResult
  | SaveLogRequest
  | TranscribeAudioData;
