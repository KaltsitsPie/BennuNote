import { pipeline, env } from '@huggingface/transformers';
import type { SubtitleItem } from '../shared/types';
import type { TranscribeResult, TranscribeProgress, PreloadModelResult } from '../shared/messages';

// Configure transformers.js for extension environment
env.allowLocalModels = false;
if (env?.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;

/**
 * Check if the Whisper model files are already in the browser Cache Storage.
 * transformers.js uses a cache named "transformers-cache" by default.
 */
async function isModelCached(): Promise<boolean> {
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    return keys.some((r) => r.url.includes('whisper-small'));
  } catch {
    return false;
  }
}

async function getTranscriber() {
  if (transcriber) return transcriber;

  const cached = await isModelCached();
  if (cached) {
    sendProgress({ status: 'loading-model', progress: 0, message: 'Loading model from cache...' });
  } else {
    sendProgress({ status: 'loading-model', progress: 0, message: 'Downloading model (~150MB)...' });
  }

  transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
    progress_callback: (p: Record<string, unknown>) => {
      if (typeof p.progress === 'number') {
        const msg = cached
          ? 'Loading model from cache...'
          : `Downloading model (~150MB)...`;
        sendProgress({ status: 'loading-model', progress: p.progress, message: msg });
      }
    },
  });

  sendProgress({ status: 'loading-model', progress: 100, message: 'Model ready' });
  return transcriber;
}

function sendProgress(progress: TranscribeProgress['progress']) {
  chrome.runtime.sendMessage({
    type: 'TRANSCRIBE_PROGRESS',
    progress,
  } satisfies TranscribeProgress);
}

async function transcribeAudio(audioUrl: string): Promise<SubtitleItem[]> {
  const pipe = await getTranscriber();

  sendProgress({ status: 'transcribing', progress: 0 });

  // Fetch audio data
  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();

  // Decode to PCM
  const audioContext = new OfflineAudioContext(1, 1, 16000);
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Resample to 16kHz mono
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * 16000), 16000);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  const resampled = await offlineCtx.startRendering();
  const pcmData = resampled.getChannelData(0);

  // Run Whisper
  const result = await pipe(pcmData, {
    language: 'chinese',
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  sendProgress({ status: 'done' });

  // Parse chunks into subtitle items
  const output = Array.isArray(result) ? result[0] : result;
  const chunks = (output as { chunks?: Array<{ timestamp: [number, number]; text: string }> }).chunks || [];

  if (chunks.length > 0) {
    return chunks.map((chunk) => ({
      from: chunk.timestamp[0] ?? 0,
      to: chunk.timestamp[1] ?? chunk.timestamp[0] + 5,
      content: chunk.text.trim(),
    }));
  }

  // Fallback: single chunk with full text
  const text = (output as { text: string }).text || '';
  if (text) {
    return [{ from: 0, to: audioBuffer.duration, content: text.trim() }];
  }

  return [];
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TRANSCRIBE_AUDIO') {
    transcribeAudio(msg.audioUrl)
      .then((items) => {
        chrome.runtime.sendMessage({
          type: 'TRANSCRIBE_RESULT',
          result: items.length > 0 ? { source: 'whisper', items } : null,
        } satisfies TranscribeResult);
      })
      .catch((err) => {
        sendProgress({ status: 'error', message: String(err) });
        chrome.runtime.sendMessage({
          type: 'TRANSCRIBE_RESULT',
          result: null,
          error: String(err),
        } satisfies TranscribeResult);
      });
    sendResponse({ ok: true });
  }

  // Preload model on install/startup
  if (msg.type === 'PRELOAD_MODEL') {
    const start = Date.now();
    isModelCached().then((cached) => {
      getTranscriber()
        .then(() => {
          console.log(`[BennuNote] Model preloaded in ${Date.now() - start}ms (cached: ${cached})`);
          chrome.runtime.sendMessage({
            type: 'PRELOAD_RESULT',
            success: true,
            cached,
          } satisfies PreloadModelResult);
        })
        .catch((err) => {
          console.error('[BennuNote] Model preload failed:', err);
          chrome.runtime.sendMessage({
            type: 'PRELOAD_RESULT',
            success: false,
            cached,
          } satisfies PreloadModelResult);
        });
    });
    sendResponse({ ok: true });
  }

  return false;
});
