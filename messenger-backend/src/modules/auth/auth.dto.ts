import { z } from 'zod';

// ─── Отправить OTP на email ───────────────────────────────────────────────────
export const SendOtpDto = z.object({
  email: z.string().email('Invalid email'),
});

// ─── Подтвердить OTP ─────────────────────────────────────────────────────────
export const VerifyOtpDto = z.object({
  email: z.string().email('Invalid email'),
  code: z
    .string()
    .length(6, 'Code must be 6 digits')
    .regex(/^\d{6}$/, 'Code must be digits only'),
  // Только для новых пользователей
  nickname: z
    .string()
    .min(5, 'Nickname min 5 chars')
    .max(32)
    .regex(/^[a-zA-Z][a-zA-Z0-9.]{4,31}$/, 'Must start with a letter; only letters, digits and dots')
    .optional(),
});

// ─── Вход по никнейму + пароль ───────────────────────────────────────────────
export const LoginDto = z.object({
  nickname: z.string().min(1, 'Nickname required'),
  password: z.string().min(1, 'Password required'),
});

export type SendOtpInput  = z.infer<typeof SendOtpDto>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpDto>;
export type LoginInput    = z.infer<typeof LoginDto>;
