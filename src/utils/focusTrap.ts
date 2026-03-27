import { onCleanup } from 'solid-js';

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      focusTrap: true;
    }
  }
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function trapFocus(el: HTMLElement): () => void {
  const prev = document.activeElement as HTMLElement | null;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  el.addEventListener('keydown', handleKeyDown);

  requestAnimationFrame(() => {
    const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable.length > 0) focusable[0].focus();
  });

  return () => {
    el.removeEventListener('keydown', handleKeyDown);
    prev?.focus();
  };
}

/**
 * SolidJS directive: use:focusTrap on a modal/dialog container.
 * Traps Tab navigation and restores focus on cleanup.
 */
export function focusTrap(el: HTMLElement) {
  const cleanup = trapFocus(el);
  onCleanup(cleanup);
}
