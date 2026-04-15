import { createSignal, Show, onCleanup, type Component } from 'solid-js';
import { api } from '../../api/client';
import { getErrMsg, getErrCode } from '../../utils/error';
import { authStore } from '../../stores/auth.store';
import { i18n } from '../../stores/i18n.store';
import styles from './AuthFlow.module.css';

type Step = 'email' | 'otp' | 'nickname';

const AuthFlow: Component = () => {
  const t = i18n.t;
  const [step, setStep] = createSignal<Step>('email');
  const [email, setEmail] = createSignal('');
  const [code, setCode] = createSignal('');
  const [nickname, setNickname] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [resendTimer, setResendTimer] = createSignal(0);
  const [verifyToken, setVerifyToken] = createSignal('');

  let timerRef: ReturnType<typeof setInterval>;

  onCleanup(() => clearInterval(timerRef));

  function startTimer() {
    setResendTimer(60);
    clearInterval(timerRef);
    timerRef = setInterval(() => {
      setResendTimer((t) => {
        if (t <= 1) { clearInterval(timerRef); return 0; }
        return t - 1;
      });
    }, 1000);
  }

  async function handleSendOtp(e: Event) {
    e.preventDefault();
    const em = email().trim();
    if (!em) return;
    setError('');
    setLoading(true);
    try {
      await api.sendOtp(em);
      setStep('otp');
      startTimer();
    } catch (err) {
      setError(getErrMsg(err, t('auth.error_send_code')));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: Event) {
    e.preventDefault();
    const c = code().trim();
    if (c.length < 6) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.verifyOtp(email().trim(), c);
      finishLogin(res.data.user);
    } catch (err: any) {
      if (getErrCode(err) === 'NICKNAME_REQUIRED') {
        setVerifyToken(err?.verifyToken || '');
        setStep('nickname');
        setError('');
      } else {
        setError(getErrMsg(err, t('error.INVALID_CODE')));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSetNickname(e: Event) {
    e.preventDefault();
    const nick = nickname().trim();
    if (nick.length < 5) { setError(t('auth.nick_min')); return; }
    if (!/^[a-zA-Z][a-zA-Z0-9.]{4,31}$/.test(nick)) { setError(t('auth.nick_format')); return; }
    setError('');
    setLoading(true);
    try {
      const res = await api.verifyOtp(email().trim(), code().trim(), nick, verifyToken());
      finishLogin(res.data.user);
    } catch (err) {
      const errCode = getErrCode(err);
      if (errCode === 'OTP_EXPIRED' || errCode === 'INVALID_CODE') {
        setStep('otp');
        setCode('');
        setError(getErrMsg(err, t('error.OTP_EXPIRED')));
      } else {
        setError(getErrMsg(err, t('auth.error_registration')));
      }
    } finally {
      setLoading(false);
    }
  }

  function finishLogin(user: unknown) {
    authStore.loginWithUser(user as import('../../types').User);
  }

  async function handleResend() {
    if (resendTimer() > 0) return;
    setError('');
    try {
      await api.sendOtp(email().trim());
      startTimer();
    } catch (err) {
      setError(getErrMsg(err, t('auth.error_sending')));
    }
  }

  return (
    <div class={styles.wrap}>
      <div class={styles.card}>
        <div class={styles.logo}>H2V</div>

        <Show when={step() === 'email'}>
          <form onSubmit={handleSendOtp}>
            <h2 class={styles.title}>{t('auth.title')}</h2>
            <p class={styles.sub}>{t('auth.subtitle')}</p>
            <input
              class={styles.input}
              type="email"
              placeholder="you@example.com"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              autofocus
              required
            />
            <Show when={error()}><p class={styles.error}>{error()}</p></Show>
            <button class={styles.btn} type="submit" disabled={loading()}>
              {loading() ? t('auth.sending') : t('auth.send')}
            </button>
          </form>
        </Show>

        <Show when={step() === 'otp'}>
          <form onSubmit={handleVerifyOtp}>
            <h2 class={styles.title}>{t('auth.code_title')}</h2>
            <p class={styles.sub}>
              {t('auth.code_sent')} <strong>{email()}</strong>
              {' · '}
              <span class={styles.link} onClick={() => { setStep('email'); setCode(''); setError(''); }}>
                {t('auth.change')}
              </span>
            </p>
            <input
              class={`${styles.input} ${styles.inputCode}`}
              type="text"
              inputmode="numeric"
              placeholder="000000"
              maxLength={6}
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
              autofocus
            />
            <Show when={error()}><p class={styles.error}>{error()}</p></Show>
            <button class={styles.btn} type="submit" disabled={loading() || code().length < 6}>
              {loading() ? t('auth.checking') : t('auth.login')}
            </button>
            <p class={styles.resend}>
              {resendTimer() > 0
                ? `${t('auth.resend_in')} ${resendTimer()} ${t('auth.seconds_short')}`
                : <span class={styles.link} onClick={handleResend}>{t('auth.resend')}</span>
              }
            </p>
          </form>
        </Show>

        <Show when={step() === 'nickname'}>
          <form onSubmit={handleSetNickname}>
            <h2 class={styles.title}>{t('auth.nick_title')}</h2>
            <p class={styles.sub}>{t('auth.nick_hint')}</p>
            <input
              class={styles.input}
              type="text"
              placeholder="username"
              maxLength={32}
              value={nickname()}
              onInput={(e) => setNickname(e.currentTarget.value.toLowerCase())}
              autofocus
            />
            <Show when={error()}><p class={styles.error}>{error()}</p></Show>
            <button class={styles.btn} type="submit" disabled={loading() || nickname().trim().length < 5}>
              {loading() ? t('auth.nick_saving') : t('auth.nick_save')}
            </button>
          </form>
        </Show>
      </div>
    </div>
  );
};

export default AuthFlow;
