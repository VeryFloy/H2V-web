const THRESHOLD = 60;

export function useSwipeBack(onBack: () => void) {
  let startX = 0;
  let startY = 0;
  let swiping = false;

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = false;
  }

  function onTouchMove(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      swiping = true;
    }
  }

  function onTouchEnd(e: TouchEvent) {
    if (!swiping) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - startX;
    if (dx > THRESHOLD) onBack();
    swiping = false;
  }

  return { onTouchStart, onTouchMove, onTouchEnd };
}
