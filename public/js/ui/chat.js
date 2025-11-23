// UI chat module: rendering and send wiring
// No framework, pure DOM.

export function createChat({ logEl, inputEl, sendBtn, getSelfId, onSend }) {
  function append({ from, message, ts }) {
    const selfId = getSelfId?.();
    const isSelf = from === selfId;

    const wrap = document.createElement('div');
    wrap.className = `chat-msg-wrap ${isSelf ? 'self' : 'remote'}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = message;

    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const time = new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.textContent = isSelf ? time : `${from} • ${time}`;

    wrap.appendChild(bubble);
    wrap.appendChild(meta);

    logEl.appendChild(wrap);
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
