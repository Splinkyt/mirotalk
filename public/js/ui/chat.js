// UI chat module: rendering and send wiring
// No framework, pure DOM.

export function createChat({ logEl, inputEl, sendBtn, getSelfId, onSend }) {
  function append({ from, message, ts }) {
    const div = document.createElement('div');
    const time = new Date(ts || Date.now()).toLocaleTimeString();
    const selfId = getSelfId?.();
    const label = from === selfId ? 'You' : from;
    div.textContent = `[${time}] ${label}: ${message}`;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  if (sendBtn && inputEl) {
    sendBtn.onclick = () => {
      const text = inputEl.value.trim();
      if (!text) return;
      onSend?.(text);
      inputEl.value = '';
    };
  }

  return { append };
}
