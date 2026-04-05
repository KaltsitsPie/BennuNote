const statusEl = document.getElementById('status')!;
const btn = document.getElementById('extract-btn') as HTMLButtonElement;

// Check if we're on a bilibili video page
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs[0]?.url || '';
  if (!url.includes('bilibili.com/video/')) {
    statusEl.textContent = 'Please navigate to a Bilibili video page';
    btn.disabled = true;
  }
});

btn.addEventListener('click', () => {
  btn.disabled = true;
  statusEl.textContent = 'Extracting...';
  chrome.runtime.sendMessage({ type: 'EXTRACT_SUBTITLES' });
  // Close popup after triggering - the panel in the page will show results
  setTimeout(() => window.close(), 300);
});
