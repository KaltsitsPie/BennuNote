/**
 * MAIN world content script — runs in the page's JS context,
 * so it can directly access window.__INITIAL_STATE__.
 *
 * Communicates back to the ISOLATED world content script via window.postMessage.
 */

(() => {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== 'BENNUNOTE_GET_STATE') return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__INITIAL_STATE__;
      if (s?.videoData) {
        window.postMessage({
          type: 'BENNUNOTE_STATE_RESULT',
          state: {
            bvid: s.videoData.bvid,
            cid: s.videoData.cid,
            title: s.videoData.title,
            ownerName: s.videoData.owner?.name,
            ownerMid: s.videoData.owner?.mid,
            coverUrl: s.videoData.pic,
            pages: (s.videoData.pages || []).map((p: { cid: number; part: string }) => ({
              cid: p.cid,
              part: p.part,
            })),
          },
        }, '*');
      } else {
        window.postMessage({ type: 'BENNUNOTE_STATE_RESULT', state: null }, '*');
      }
    } catch {
      window.postMessage({ type: 'BENNUNOTE_STATE_RESULT', state: null }, '*');
    }
  });
})();
