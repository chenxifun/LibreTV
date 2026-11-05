import { describe, expect, it } from 'vitest';
import { extractClientIp } from './client-ip';

describe('extractClientIp', () => {
  it('反代追加模式取最后一跳（真实 IP），不取可伪造的第一段', () => {
    // nginx proxy_add_x_forwarded_for：客户端自带 XFF 会被追加在真实 IP 前
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' });
    expect(extractClientIp(h)).toBe('10.0.0.1');
  });

  it('单段 XFF 直接取该段', () => {
    expect(extractClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4' }))).toBe('1.2.3.4');
  });

  it('多段含空格与端口也能解析出末段 IP', () => {
    expect(extractClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4:5678, 5.6.7.8' }))).toBe('5.6.7.8');
  });

  it('无 XFF 时回落 x-real-ip', () => {
    expect(extractClientIp(new Headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('两个头都缺失时返回 unknown', () => {
    expect(extractClientIp(new Headers())).toBe('unknown');
  });

  it('XFF 全是垃圾值时返回 unknown 而非空串', () => {
    expect(extractClientIp(new Headers({ 'x-forwarded-for': ', ,' }))).toBe('unknown');
  });
});
