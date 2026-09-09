(function() {
  'use strict';

  // Read the API key from the script tag
  var scriptTag = document.currentScript;
  if (!scriptTag) {
    console.error('[Axon] Could not find script tag.');
    return;
  }

  var apiKey = scriptTag.getAttribute('data-agent-key');
  if (!apiKey) {
    console.error('[Axon] Missing data-agent-key attribute.');
    return;
  }

  var baseUrl = scriptTag.src.replace(/\/embed\.js(\?.*)?$/, '');
  var iframeUrl = baseUrl + '/embed/' + apiKey;
  var isOpen = false;
  var isLoaded = false;

  // Create style element with all widget styles
  var style = document.createElement('style');
  style.textContent = [
    '.axon-widget-btn {',
    '  position: fixed;',
    '  bottom: 24px;',
    '  right: 24px;',
    '  width: 56px;',
    '  height: 56px;',
    '  border-radius: 50%;',
    '  background: #171717;',
    '  border: none;',
    '  cursor: pointer;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);',
    '  transition: transform 0.2s ease, box-shadow 0.2s ease;',
    '  z-index: 2147483646;',
    '  padding: 0;',
    '}',
    '.axon-widget-btn:hover {',
    '  transform: scale(1.05);',
    '  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);',
    '}',
    '.axon-widget-btn svg {',
    '  width: 24px;',
    '  height: 24px;',
    '  fill: none;',
    '  stroke: #ffffff;',
    '  stroke-width: 2;',
    '  stroke-linecap: round;',
    '  stroke-linejoin: round;',
    '  transition: opacity 0.15s ease, transform 0.15s ease;',
    '}',
    '.axon-widget-btn .axon-icon-close {',
    '  position: absolute;',
    '  opacity: 0;',
    '  transform: rotate(-90deg) scale(0.8);',
    '}',
    '.axon-widget-btn.axon-open .axon-icon-chat {',
    '  opacity: 0;',
    '  transform: rotate(90deg) scale(0.8);',
    '}',
    '.axon-widget-btn.axon-open .axon-icon-close {',
    '  opacity: 1;',
    '  transform: rotate(0) scale(1);',
    '}',
    '.axon-widget-frame {',
    '  position: fixed;',
    '  bottom: 96px;',
    '  right: 24px;',
    '  width: 400px;',
    '  height: 600px;',
    '  max-height: calc(100vh - 120px);',
    '  border: none;',
    '  border-radius: 16px;',
    '  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);',
    '  z-index: 2147483645;',
    '  opacity: 0;',
    '  transform: translateY(16px) scale(0.95);',
    '  transition: opacity 0.25s ease, transform 0.25s ease;',
    '  pointer-events: none;',
    '  background: #ffffff;',
    '}',
    '.axon-widget-frame.axon-visible {',
    '  opacity: 1;',
    '  transform: translateY(0) scale(1);',
    '  pointer-events: auto;',
    '}',
    '@media (max-width: 480px) {',
    '  .axon-widget-frame {',
    '    width: calc(100vw - 16px);',
    '    height: calc(100vh - 80px);',
    '    max-height: calc(100vh - 80px);',
    '    bottom: 72px;',
    '    right: 8px;',
    '    border-radius: 12px;',
    '  }',
    '  .axon-widget-btn {',
    '    bottom: 12px;',
    '    right: 12px;',
    '    width: 48px;',
    '    height: 48px;',
    '  }',
    '  .axon-widget-btn svg {',
    '    width: 20px;',
    '    height: 20px;',
    '  }',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  // Create toggle button
  var btn = document.createElement('button');
  btn.className = 'axon-widget-btn';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = [
    '<svg class="axon-icon-chat" viewBox="0 0 24 24">',
    '  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    '</svg>',
    '<svg class="axon-icon-close" viewBox="0 0 24 24">',
    '  <path d="M18 6L6 18M6 6l12 12"/>',
    '</svg>',
  ].join('');
  document.body.appendChild(btn);

  // Create iframe (lazy-loaded on first open)
  var iframe = document.createElement('iframe');
  iframe.className = 'axon-widget-frame';
  iframe.setAttribute('title', 'Chat widget');
  iframe.setAttribute('allow', 'clipboard-write');
  document.body.appendChild(iframe);

  btn.addEventListener('click', function() {
    isOpen = !isOpen;

    if (isOpen) {
      btn.classList.add('axon-open');
      btn.setAttribute('aria-label', 'Close chat');

      // Lazy load iframe src on first open
      if (!isLoaded) {
        iframe.src = iframeUrl;
        isLoaded = true;
      }

      iframe.classList.add('axon-visible');
    } else {
      btn.classList.remove('axon-open');
      btn.setAttribute('aria-label', 'Open chat');
      iframe.classList.remove('axon-visible');
    }
  });
})();
