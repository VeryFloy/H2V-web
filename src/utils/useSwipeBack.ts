const THRESHOLD = 60;
const EDGE_ZONE = 40;

export function useSwipeBack(onBack: () => void) {
  let startX = 0;
  let startY = 0;
  let swiping = false;
  let edgeSwipe = false;
  let indicator: HTMLElement | null = null;

  function showIndicator(progress: number) {
    if (!indicator) {
      indicator = document.createElement('div');
      Object.assign(indicator.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '4px',
        height: '100%',
        background: 'var(--accent, #8B5CF6)',
        borderRadius: '0 4px 4px 0',
        opacity: '0',
        transform: 'scaleX(0)',
        transformOrigin: 'left',
        transition: 'none',
        zIndex: '99999',
        pointerEvents: 'none',
      });
      document.body.appendChild(indicator);
    }
    const clamped = Math.min(1, Math.max(0, progress));
    indicator.style.opacity = String(clamped * 0.8);
    indicator.style.transform = `scaleX(${0.5 + clamped * 2})`;
  }

  function hideIndicator() {
    if (indicator) {
      indicator.style.transition = 'opacity 0.2s ease';
      indicator.style.opacity = '0';
      setTimeout(() => {
        indicator?.parentNode?.removeChild(indicator);
        indicator = null;
      }, 200);
    }
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = false;
    edgeSwipe = startX <= EDGE_ZONE;
  }

  function onTouchMove(e: TouchEvent) {
    if (e.touches.length !== 1 || !edgeSwipe) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      swiping = true;
    }
    if (swiping && dx > 0) {
      showIndicator(dx / THRESHOLD);
    }
  }

  function onTouchEnd(e: TouchEvent) {
    hideIndicator();
    if (!swiping || !edgeSwipe) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - startX;
    if (dx > THRESHOLD) {
      try { navigator.vibrate?.(10); } catch {}
      onBack();
    }
    swiping = false;
    edgeSwipe = false;
  }

  function cleanup() {
    if (indicator) {
      indicator.parentNode?.removeChild(indicator);
      indicator = null;
    }
  }

  return { onTouchStart, onTouchMove, onTouchEnd, cleanup };
}
