const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const btn = document.getElementById('extract-btn') as HTMLButtonElement;

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
  // Check if on bilibili video page
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url || '';
  const isBilibili = url.includes('bilibili.com/video/');
  const isYouTube = url.includes('youtube.com/watch');
  if (!isBilibili && !isYouTube) {
    statusText.textContent = 'Please navigate to a Bilibili or YouTube video page';
    btn.disabled = true;
    return;
  }

  // Check backend health (informational only — Stage 1 doesn't need it)
  const healthy = await checkHealth();
  statusDot.style.background = healthy ? '#4caf50' : '#f44336';
  statusText.textContent = healthy
    ? 'Service online'
    : 'Backend offline — transcription fallback unavailable';
}

init();

const langSelect = document.getElementById('lang-select') as HTMLSelectElement;

btn.addEventListener('click', () => {
  btn.disabled = true;
  statusText.textContent = 'Extracting...';
  chrome.runtime.sendMessage({ type: 'EXTRACT_SUBTITLES', language: langSelect.value });
  setTimeout(() => window.close(), 300);
});
