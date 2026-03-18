import { describe, it, expect } from 'vitest';
import { SendOtpDto, VerifyOtpDto, LoginDto } from './auth.dto';

describe('SendOtpDto', () => {
  it('should accept valid email', () => {
    const result = SendOtpDto.safeParse({ email: 'user@example.com' });
    expect(result.success).toBe(true);
  });

  it('should reject invalid email', () => {
    const result = SendOtpDto.safeParse({ email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('should reject empty email', () => {
    const result = SendOtpDto.safeParse({ email: '' });
    expect(result.success).toBe(false);
  });
});

describe('VerifyOtpDto', () => {
  it('should accept valid code', () => {
    const result = VerifyOtpDto.safeParse({ email: 'user@example.com', code: '123456' });
    expect(result.success).toBe(true);
  });

  it('should reject short code', () => {
    const result = VerifyOtpDto.safeParse({ email: 'user@example.com', code: '123' });
    expect(result.success).toBe(false);
  });

  it('should reject non-digit code', () => {
    const result = VerifyOtpDto.safeParse({ email: 'user@example.com', code: 'abcdef' });
    expect(result.success).toBe(false);
  });

  it('should accept code with optional nickname', () => {
    const result = VerifyOtpDto.safeParse({
      email: 'user@example.com',
      code: '123456',
      nickname: 'testuser',
    });
    expect(result.success).toBe(true);
  });

  it('should reject nickname shorter than 5 chars', () => {
    const result = VerifyOtpDto.safeParse({
      email: 'user@example.com',
      code: '123456',
      nickname: 'ab',
    });
    expect(result.success).toBe(false);
  });

  it('should reject nickname starting with digit', () => {
    const result = VerifyOtpDto.safeParse({
      email: 'user@example.com',
      code: '123456',
      nickname: '1testuser',
    });
    expect(result.success).toBe(false);
  });

  it('should accept nickname with dots', () => {
    const result = VerifyOtpDto.safeParse({
      email: 'user@example.com',
      code: '123456',
      nickname: 'test.user',
    });
    expect(result.success).toBe(true);
  });
});

describe('LoginDto', () => {
  it('should accept valid credentials', () => {
    const result = LoginDto.safeParse({ nickname: 'testuser', password: 'pass123' });
    expect(result.success).toBe(true);
  });

  it('should reject empty nickname', () => {
    const result = LoginDto.safeParse({ nickname: '', password: 'pass123' });
    expect(result.success).toBe(false);
  });

  it('should reject empty password', () => {
    const result = LoginDto.safeParse({ nickname: 'testuser', password: '' });
    expect(result.success).toBe(false);
  });
});
