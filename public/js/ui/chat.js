// UI chat module: rendering and send wiring
// Using Tailwind classes as per new design

export function createChat({ logEl, inputEl, sendBtn, getSelfId, onSend }) {
  function append({ from, message, ts }) {
    const selfId = getSelfId?.();
    const isSelf = from === selfId;
    const time = new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Main wrapper
    const wrap = document.createElement('div');
    wrap.className = isSelf ? 'flex gap-3 flex-row-reverse' : 'flex gap-3';

    // Avatar
    const avatar = document.createElement('div');
    const avatarClasses = isSelf 
        ? 'bg-blue-500' 
        : 'bg-gradient-to-br from-purple-500 to-blue-500';
    avatar.className = `h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white border border-white/10 shrink-0 ${avatarClasses}`;
    avatar.textContent = isSelf ? 'You' : (from.substring(0, 2).toUpperCase());
    
    // Content Wrapper
    const contentWrap = document.createElement('div');
    contentWrap.className = isSelf 
        ? 'flex flex-col gap-1 items-end max-w-[80%]' 
        : 'flex flex-col gap-1 max-w-[80%]';

    // Meta (Name + Time) - Only for remote or if we want time for self too
    if (!isSelf) {
        const meta = document.createElement('span');
        meta.className = 'text-xs text-gray-400 ml-1';
        meta.textContent = `${from}, ${time}`;
        contentWrap.appendChild(meta);
    }

    // Bubble
    const bubble = document.createElement('div');
    if (isSelf) {
        bubble.className = 'bg-blue-500/80 p-3 rounded-2xl rounded-tr-none text-sm leading-relaxed text-white shadow-lg backdrop-blur-sm';
    } else {
        bubble.className = 'bg-white/10 p-3 rounded-2xl rounded-tl-none text-sm leading-relaxed backdrop-blur-sm border border-white/5';
    }
    bubble.textContent = message;

    contentWrap.appendChild(bubble);
    
    // Assemble
    wrap.appendChild(avatar);
    wrap.appendChild(contentWrap);

    logEl.appendChild(wrap);
    logEl.scrollTop = logEl.scrollHeight;
  }

  if (sendBtn && inputEl) {
    const send = () => {
      const text = inputEl.value.trim();
      if (!text) return;
      onSend?.(text);
      inputEl.value = '';
    };

    sendBtn.onclick = send;
    
    // Add Enter key support
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') send();
    };
  }

  return { append };
}
