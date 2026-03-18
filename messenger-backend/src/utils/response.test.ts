import { describe, it, expect, vi } from 'vitest';
import { ok, fail } from './response';

function mockResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { res.statusCode = code; return res; },
    json(data: any) { res.body = data; return res; },
  };
  return res;
}

describe('response utilities', () => {
  it('ok() returns success with data and default 200', () => {
    const res = mockResponse();
    ok(res, { id: '123' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: '123' } });
  });

  it('ok() respects custom status code', () => {
    const res = mockResponse();
    ok(res, { created: true }, 201);
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('fail() returns error with default 400', () => {
    const res = mockResponse();
    fail(res, 'INVALID_INPUT');
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, code: 'INVALID_INPUT', message: 'INVALID_INPUT' });
  });

  it('fail() respects custom status code', () => {
    const res = mockResponse();
    fail(res, 'NOT_FOUND', 404);
    expect(res.statusCode).toBe(404);
  });
});
