import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

const ModalBehaviorContext = createContext({ scrollReady: true });
const HEIGHT_ANIMATION_MS = 360;
const MEASUREMENT_BUFFER_PX = 6;
const easeHeight = (t) => 1 - Math.pow(1 - t, 3);

export default function Modal({ children, onClose, className = "", style = {}, overlayClick = true, measureKey = null }) {
  const contentRef = useRef(null);
  const currentHeightRef = useRef(0);
  const [scrollReady, setScrollReady] = useState(true);
  const growthTimerRef = useRef(null);
  const frameRef = useRef(0);
  const heightAnimationFrameRef = useRef(0);
  const settleFrameRef = useRef(0);

  const animateHeight = useCallback((modal, fromHeight, toHeight) => {
    cancelAnimationFrame(heightAnimationFrameRef.current);

    if (Math.abs(toHeight - fromHeight) < 0.5) {
      modal.style.height = `${toHeight}px`;
      delete modal.dataset.resizing;
      return;
    }

    modal.dataset.resizing = 'true';
    const startedAt = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / HEIGHT_ANIMATION_MS);
      const easedProgress = easeHeight(progress);
      const currentHeight = fromHeight + ((toHeight - fromHeight) * easedProgress);
      modal.style.height = `${currentHeight}px`;

      if (progress < 1) {
        heightAnimationFrameRef.current = requestAnimationFrame(step);
        return;
      }

      modal.style.height = `${toHeight}px`;
      delete modal.dataset.resizing;
      heightAnimationFrameRef.current = 0;
    };

    heightAnimationFrameRef.current = requestAnimationFrame(step);
  }, []);

  const measure = useCallback(() => {
    const wrapper = contentRef.current;
    if (!wrapper) return;
    const modal = wrapper.parentElement;
    if (!modal) return;

    const computedStyles = window.getComputedStyle(modal);
    const computedMaxHeight = Number.parseFloat(computedStyles.maxHeight);
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const maxHeight = Number.isFinite(computedMaxHeight)
      ? computedMaxHeight
      : Math.max(260, viewportHeight - 32);

    // Measure natural height with the live height cap removed. While measuring,
    // CSS temporarily disables scrolling in the body so scrollHeight reflects
    // the real content size rather than the clipped viewport.
    const prevHeightStyle = modal.style.height;
    const prevMaxHeight = modal.style.maxHeight;

    modal.dataset.measuring = 'true';
    modal.style.maxHeight = 'none';
    modal.style.height = 'auto';

    const naturalHeight = Math.ceil(modal.scrollHeight);

    delete modal.dataset.measuring;
    modal.style.height = prevHeightStyle;
    modal.style.maxHeight = prevMaxHeight;

    const nextHeight = Math.min(naturalHeight + MEASUREMENT_BUFFER_PX, maxHeight);
    const renderedHeight = Math.round(modal.getBoundingClientRect().height * 100) / 100;
    const prevHeight = currentHeightRef.current || renderedHeight;

    if (prevHeight === 0) {
      currentHeightRef.current = nextHeight;
      modal.style.height = `${nextHeight}px`;
      setScrollReady(true);
      return;
    }

    if (nextHeight === prevHeight) return;

    const touchesCap = prevHeight >= maxHeight || nextHeight >= maxHeight;
    clearTimeout(growthTimerRef.current);
    if (touchesCap) {
      setScrollReady(false);
      growthTimerRef.current = setTimeout(() => {
        setScrollReady(nextHeight >= maxHeight);
      }, HEIGHT_ANIMATION_MS + 40);
    } else {
      setScrollReady(true);
    }

    currentHeightRef.current = nextHeight;
    animateHeight(modal, renderedHeight || prevHeight, nextHeight);
  }, [animateHeight]);

  const scheduleMeasure = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      measure();
    });
  }, [measure]);

  // Re-measure on children change: the observed wrapper is flex-constrained, so
  // ResizeObserver alone won't catch content growth inside it.
  useLayoutEffect(() => {
    scheduleMeasure();
    settleFrameRef.current = requestAnimationFrame(() => {
      settleFrameRef.current = 0;
      scheduleMeasure();
    });
  }, [children, measureKey, scheduleMeasure]);

  useEffect(() => {
    if (!contentRef.current) return;
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(contentRef.current);
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(contentRef.current, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.visualViewport?.addEventListener('resize', scheduleMeasure);
    window.addEventListener('resize', scheduleMeasure);
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      clearTimeout(growthTimerRef.current);
      cancelAnimationFrame(frameRef.current);
      cancelAnimationFrame(heightAnimationFrameRef.current);
      cancelAnimationFrame(settleFrameRef.current);
      window.visualViewport?.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [scheduleMeasure]);

  return createPortal(
    <div className="popup-overlay" onClick={overlayClick ? onClose : undefined}>
      <div
        className="modal-shell"
        onClick={e => e.stopPropagation()}
      >
        <div
          className={`rules-modal ${className}`}
          data-scroll-ready={scrollReady ? 'true' : 'false'}
          style={{
            ...style,
            maxWidth: 'none',
            margin: 0
          }}
        >
          <ModalBehaviorContext.Provider value={{ scrollReady }}>
            <div ref={contentRef} className="modal-content-wrapper">
              {children}
            </div>
          </ModalBehaviorContext.Provider>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ModalTitle({ icon, children, className = "", style = {} }) {
  return (
    <h2 className={`window-title ${className}`.trim()} style={style}>
      {icon && <span className="window-title-icon">{icon}</span>}
      {children}
    </h2>
  );
}

export function ModalBody({ children, className = "", style = {} }) {
  const { scrollReady } = useContext(ModalBehaviorContext);
  return (
    <div
      className={`modal-body ${!scrollReady ? 'modal-body-locked' : ''} ${className}`.trim()}
      style={style}
    >
      {children}
    </div>
  );
}

export function ModalFooter({ children, className = "", balanced = false, style = {} }) {
  return (
    <div
      className={`window-footer ${balanced ? 'window-footer-balanced' : ''} ${className}`.trim()}
      style={style}
    >
      {children}
    </div>
  );
}

export function ModalActions({ children, className = "", style = {} }) {
  return (
    <div className={`window-actions ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}
