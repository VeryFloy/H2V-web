import type { ApiError } from '../api/client';

export function getErrMsg(err: unknown, fallback = 'Ошибка'): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as ApiError).message;
    return msg && msg !== 'Error' ? msg : fallback;
  }
  return fallback;
}

export function getErrCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as ApiError).code ?? '';
  }
  return '';
}
