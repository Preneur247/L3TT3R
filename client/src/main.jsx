import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// iOS Safari keyboard handling:
//  - --app-height: actual visible height (used by .popup-overlay to center
//    within the visual viewport, not the full layout viewport behind keyboard)
//  - .keyboard-open: enables compact CSS since media queries don't update on iOS
//  - scroll lock: prevents iOS from nudging the page when inputs get focus
const setAppHeight = () => {
  const visualViewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const layoutViewportHeight = window.innerHeight;
  const activeElement = document.activeElement;
  const isTextInputFocused = Boolean(
    activeElement &&
    (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    )
  );
  const keyboardDelta = layoutViewportHeight - visualViewportHeight;
  const isKeyboardOpen = isTextInputFocused && keyboardDelta > 120;

  document.documentElement.style.setProperty('--app-height', `${visualViewportHeight}px`);
  document.documentElement.classList.toggle('keyboard-open', isKeyboardOpen);
  if (isKeyboardOpen) {
    clearTimeout(window._kbScrollTimer);
    window._kbScrollTimer = setTimeout(() => window.scrollTo({ top: 0, behavior: 'instant' }), 150);
  }
};
window.visualViewport?.addEventListener('resize', setAppHeight);
window.addEventListener('resize', setAppHeight);
setAppHeight();

// Lock scroll position to 0 while keyboard is open so iOS focus-scroll nudges
// (e.g. when transitioning from letter→word input) don't shift the card up.
window.addEventListener('scroll', () => {
  if (document.documentElement.classList.contains('keyboard-open') && window.scrollY > 0) {
    window.scrollTo(0, 0);
  }
}, { passive: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
