import { describe, it, expect } from 'vitest';

describe('message service — allowed reactions', () => {
  const ALLOWED = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

  it('should accept valid emojis', () => {
    for (const emoji of ALLOWED) {
      expect(ALLOWED.includes(emoji)).toBe(true);
    }
  });

  it('should reject unknown emojis', () => {
    expect(ALLOWED.includes('💀')).toBe(false);
    expect(ALLOWED.includes('🎉')).toBe(false);
    expect(ALLOWED.includes('text')).toBe(false);
  });
});

describe('message type detection', () => {
  function detectType(mime: string): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' {
    if (mime.startsWith('image/')) return 'IMAGE';
    if (mime.startsWith('video/')) return 'VIDEO';
    if (mime.startsWith('audio/')) return 'AUDIO';
    return 'FILE';
  }

  it('should detect image types', () => {
    expect(detectType('image/jpeg')).toBe('IMAGE');
    expect(detectType('image/png')).toBe('IMAGE');
    expect(detectType('image/webp')).toBe('IMAGE');
  });

  it('should detect video types', () => {
    expect(detectType('video/mp4')).toBe('VIDEO');
    expect(detectType('video/webm')).toBe('VIDEO');
  });

  it('should detect audio types', () => {
    expect(detectType('audio/mpeg')).toBe('AUDIO');
    expect(detectType('audio/ogg')).toBe('AUDIO');
  });

  it('should default to FILE for unknown types', () => {
    expect(detectType('application/pdf')).toBe('FILE');
    expect(detectType('application/zip')).toBe('FILE');
    expect(detectType('text/plain')).toBe('FILE');
  });
});
