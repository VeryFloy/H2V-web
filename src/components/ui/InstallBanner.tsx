import { createSignal, onMount, onCleanup, Show, type Component } from 'solid-js';
import { i18n } from '../../stores/i18n.store';
import styles from './InstallBanner.module.css';

const DISMISS_KEY = 'h2v_pwa_dismissed';

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode(): boolean {
  return (
    ('standalone' in window.navigator && (window.navigator as any).standalone) ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

const InstallBanner: Component = () => {
  const t = i18n.t;
  const [show, setShow] = createSignal(false);
  const [deferredPrompt, setDeferredPrompt] = createSignal<any>(null);
  const [iosMode, setIosMode] = createSignal(false);

  onMount(() => {
    if (isInStandaloneMode()) return;
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - Number(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

    if (isIos()) {
      setIosMode(true);
      setShow(true);
      return;
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    onCleanup(() => window.removeEventListener('beforeinstallprompt', onBeforeInstall));
  });

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  }

  async function install() {
    const prompt = deferredPrompt();
    if (!prompt) return;
    prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === 'accepted') {
      setShow(false);
    }
    setDeferredPrompt(null);
  }

  return (
    <Show when={show()}>
      <div class={styles.banner}>
        <Show when={iosMode()} fallback={
          <>
            <div class={styles.info}>
              <img src="/icon-512.png" alt="H2V" class={styles.icon} />
              <div>
                <div class={styles.appName}>H2V Messenger</div>
              </div>
            </div>
            <div class={styles.actions}>
              <button class={styles.dismissBtn} onClick={dismiss}>{t('pwa.dismiss')}</button>
              <button class={styles.installBtn} onClick={install}>{t('pwa.install')}</button>
            </div>
          </>
        }>
          <div class={styles.iosContent}>
            <img src="/icon-512.png" alt="H2V" class={styles.icon} />
            <div class={styles.iosText}>
              <div class={styles.appName}>{t('pwa.ios_title')}</div>
              <p class={styles.iosStep}>
                {t('pwa.ios_step1')}{' '}
                <svg class={styles.shareIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
                  <polyline points="16 6 12 2 8 6"/>
                  <line x1="12" y1="2" x2="12" y2="15"/>
                </svg>
                {' '}{t('pwa.ios_step2')}
              </p>
              <p class={styles.iosStep}>{t('pwa.ios_step3')}</p>
            </div>
          </div>
          <button class={styles.dismissBtnIos} onClick={dismiss}>&times;</button>
        </Show>
      </div>
    </Show>
  );
};

export default InstallBanner;
