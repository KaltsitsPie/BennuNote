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
  if (!url.includes('bilibili.com/video/')) {
    statusText.textContent = 'Please navigate to a Bilibili video page';
    btn.disabled = true;
    return;
  }

  // Check backend health
  const healthy = await checkHealth();
  if (healthy) {
    statusDot.style.background = '#4caf50';
    statusText.textContent = 'Service online';
  } else {
    statusDot.style.background = '#f44336';
    statusText.textContent = 'Service offline — please start the backend';
    btn.disabled = true;
  }
}

init();

const langSelect = document.getElementById('lang-select') as HTMLSelectElement;

btn.addEventListener('click', () => {
  btn.disabled = true;
  statusText.textContent = 'Extracting...';
  chrome.runtime.sendMessage({ type: 'EXTRACT_SUBTITLES', language: langSelect.value });
  setTimeout(() => window.close(), 300);
});
