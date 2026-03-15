import { i18n } from '../stores/i18n.store';

export function displayName(u: { nickname: string; firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!u) return '?';
  const parts = [u.firstName, u.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : u.nickname;
}

export function formatLastSeen(iso: string | null | undefined): string {
  const loc = i18n.locale();
  if (!iso) return loc === 'ru' ? 'был(а) недавно' : 'last seen recently';

  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return loc === 'ru' ? 'только что' : 'just now';

  const diffMin = Math.floor(diffMs / 60_000);

  if (loc === 'ru') {
    if (diffMin < 1) return 'был(а) только что';
    if (diffMin < 60) return `был(а) ${pluralMinRu(diffMin)} назад`;
  } else {
    if (diffMin < 1) return 'last seen just now';
    if (diffMin < 60) return `last seen ${diffMin} min ago`;
  }

  const nowDay = startOfDay(now);
  const thenDay = startOfDay(date);
  const dayDiff = Math.round((nowDay - thenDay) / 86_400_000);

  const time = date.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });

  if (loc === 'ru') {
    if (dayDiff === 0) return `был(а) сегодня в ${time}`;
    if (dayDiff === 1) return `был(а) вчера в ${time}`;
    if (dayDiff < 8)  return `был(а) ${pluralDayRu(dayDiff)} назад`;
  } else {
    if (dayDiff === 0) return `last seen today at ${time}`;
    if (dayDiff === 1) return `last seen yesterday at ${time}`;
    if (dayDiff < 8)  return `last seen ${dayDiff} days ago`;
  }

  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  const prefix = loc === 'ru' ? 'был(а) ' : 'last seen ';
  return `${prefix}${date.toLocaleDateString(loc, opts)}`;
}

export function formatLastSeenShort(iso: string | null | undefined): string {
  const loc = i18n.locale();
  if (!iso) return loc === 'ru' ? 'был(а) недавно' : 'last seen recently';

  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return loc === 'ru' ? 'только что' : 'just now';

  const diffMin = Math.floor(diffMs / 60_000);

  if (loc === 'ru') {
    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${pluralMinRu(diffMin)} назад`;
  } else {
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
  }

  const nowDay = startOfDay(now);
  const thenDay = startOfDay(date);
  const dayDiff = Math.round((nowDay - thenDay) / 86_400_000);

  const time = date.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });

  if (loc === 'ru') {
    if (dayDiff === 0) return `сегодня в ${time}`;
    if (dayDiff === 1) return `вчера в ${time}`;
    if (dayDiff < 8)  return `${pluralDayRu(dayDiff)} назад`;
  } else {
    if (dayDiff === 0) return `today at ${time}`;
    if (dayDiff === 1) return `yesterday at ${time}`;
    if (dayDiff < 8)  return `${dayDiff} days ago`;
  }

  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(loc, opts);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pluralMinRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} минуту`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} минуты`;
  return `${n} минут`;
}

function pluralDayRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} дня`;
  return `${n} дней`;
}
