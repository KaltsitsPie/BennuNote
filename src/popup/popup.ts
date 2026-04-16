const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const btn = document.getElementById('extract-btn') as HTMLButtonElement;
const langSelect = document.getElementById('lang-select') as HTMLSelectElement;
const langRow = document.getElementById('lang-row') as HTMLElement;

let isVideo = false;
btn.disabled = true;

async function checkHealth(): Promise<boolean> {
  try {
    const resp = await fetch('http://localhost:2185/health', { signal: AbortSignal.timeout(2000) });
    const data = await resp.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

async function init() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url || '';
  const isBilibili = url.includes('bilibili.com/video/');
  const isYouTube = url.includes('youtube.com/watch');
  const isRestricted =
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url === '';

  isVideo = isBilibili || isYouTube;

  if (isRestricted) {
    statusText.textContent = 'This page cannot be summarized';
    btn.disabled = true;
    langRow.style.display = 'none';
    return;
  }

  if (isVideo) {
    langRow.style.display = '';
    btn.textContent = 'Extract Subtitles';
  } else {
    langRow.style.display = 'none';
    btn.textContent = 'Summarize Page';
  }

  const healthy = await checkHealth();
  statusDot.style.background = healthy ? '#4caf50' : '#f44336';
  statusText.textContent = healthy
    ? 'Service online'
    : 'Backend offline — transcription fallback unavailable';
  btn.disabled = false;
}

init();

btn.addEventListener('click', () => {
  btn.disabled = true;
  statusText.textContent = isVideo ? 'Extracting...' : 'Summarizing...';
  if (isVideo) {
    chrome.runtime.sendMessage({ type: 'EXTRACT_SUBTITLES', language: langSelect.value });
  } else {
    chrome.runtime.sendMessage({ type: 'SUMMARIZE_PAGE' });
  }
  setTimeout(() => window.close(), 300);
});
