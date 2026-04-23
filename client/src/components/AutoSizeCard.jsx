import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const HEIGHT_ANIMATION_MS = 360;
const easeHeight = (t) => 1 - Math.pow(1 - t, 3);

export default function AutoSizeCard({ children, className = 'glass-card', style = {}, measureKey = null }) {
  const cardRef = useRef(null);
  const contentRef = useRef(null);
  const currentHeightRef = useRef(0);
  const frameRef = useRef(0);
  const heightAnimationFrameRef = useRef(0);
  const settleFrameRef = useRef(0);

  const animateHeight = useCallback((card, fromHeight, toHeight) => {
    cancelAnimationFrame(heightAnimationFrameRef.current);

    if (Math.abs(toHeight - fromHeight) < 0.5) {
      card.style.height = `${toHeight}px`;
      delete card.dataset.resizing;
      return;
    }

    card.dataset.resizing = 'true';
    const startedAt = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / HEIGHT_ANIMATION_MS);
      const easedProgress = easeHeight(progress);
      const currentHeight = fromHeight + ((toHeight - fromHeight) * easedProgress);
      card.style.height = `${currentHeight}px`;

      if (progress < 1) {
        heightAnimationFrameRef.current = requestAnimationFrame(step);
        return;
      }

      card.style.height = `${toHeight}px`;
      delete card.dataset.resizing;
      heightAnimationFrameRef.current = 0;
    };

    heightAnimationFrameRef.current = requestAnimationFrame(step);
  }, []);

  const measure = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;

    const prevHeightStyle = card.style.height;
    card.style.height = 'auto';
    const nextHeight = Math.ceil(card.scrollHeight);
    card.style.height = prevHeightStyle;

    const renderedHeight = Math.round(card.getBoundingClientRect().height * 100) / 100;
    const prevHeight = currentHeightRef.current || renderedHeight;

    if (prevHeight === 0) {
      currentHeightRef.current = nextHeight;
      card.style.height = `${nextHeight}px`;
      return;
    }

    if (Math.abs(nextHeight - prevHeight) < 0.5) return;

    currentHeightRef.current = nextHeight;
    animateHeight(card, renderedHeight || prevHeight, nextHeight);
  }, [animateHeight]);

  const scheduleMeasure = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      measure();
    });
  }, [measure]);

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
    window.addEventListener('resize', scheduleMeasure);
    window.visualViewport?.addEventListener('resize', scheduleMeasure);
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      cancelAnimationFrame(frameRef.current);
      cancelAnimationFrame(heightAnimationFrameRef.current);
      cancelAnimationFrame(settleFrameRef.current);
      window.removeEventListener('resize', scheduleMeasure);
      window.visualViewport?.removeEventListener('resize', scheduleMeasure);
    };
  }, [scheduleMeasure]);

  return (
    <div ref={cardRef} className={className} style={style}>
      <div ref={contentRef} style={{ width: '100%' }}>
        {children}
      </div>
    </div>
  );
}
