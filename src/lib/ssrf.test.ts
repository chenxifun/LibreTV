import { describe, expect, it } from 'vitest';
import { isBlockedByDNS, isPrivateIP, isValidProxyUrl } from './ssrf';

describe('isPrivateIP', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['192.168.1.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['::1', true],
    ['fe80::1', true],
    ['fd00::1', true],
    ['8.8.8.8', false],
    ['1.2.3.4', false],
    // URL.hostname 对 IPv6 会带方括号
    ['[::1]', true],
    ['[fe80::1]', true],
    ['[fd00::1]', true],
    ['[fc00::1]', true],
    // IPv4-mapped IPv6：十六进制形式与点分形式
    ['[::ffff:c0a8:164]', true], // ::ffff:192.168.1.100
    ['::ffff:192.168.1.100', true],
    ['[::ffff:7f00:1]', true], // ::ffff:127.0.0.1
    ['::ffff:127.0.0.1', true],
    ['[::ffff:a9fe:a9fe]', true], // ::ffff:169.254.169.254
    ['[::ffff:a00:1]', true], // ::ffff:10.0.0.1
    ['[::ffff:808:808]', false], // ::ffff:8.8.8.8 公网
    ['::ffff:8.8.8.8', false],
    ['[::ffff:c0a8:164', true], // 单边括号（异常输入）仍要拦
    ['[2606:4700::1111]', false], // 公网 IPv6 不应被误杀
    // CGNAT 100.64.0.0/10 全段（旧实现只拦 100.64.* 前缀）
    ['100.65.0.1', true],       // 网段起点内侧
    ['100.100.100.200', true],  // 阿里云元数据服务
    ['100.100.2.136', true],    // 阿里云内网 DNS
    ['100.127.255.254', true],  // 网段末尾内侧
    ['100.63.0.1', false],      // 网段外侧不应误杀
    ['100.128.0.1', false],     // 网段外侧不应误杀
    // 其余审查发现的保留网段
    ['198.18.0.1', true],       // benchmark 网段
    ['192.0.2.1', true],        // TEST-NET-1
    ['224.0.0.1', true],        // 组播
    ['240.0.0.1', true],        // 保留（含 255.255.255.255 广播）
    ['[::ffff:100.100.100.200]', true], // IPv4-mapped 形式也要拦
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateIP(ip)).toBe(expected);
  });
});

describe('isBlockedByDNS', () => {
  it('DNS 解析失败时 fail-closed（视为被拦截）', async () => {
    // 非法主机名触发 lookup 抛错，必须返回 true 而非放行
    await expect(isBlockedByDNS('http://this-host-does-not-exist-xyz.invalid/')).resolves.toBe(true);
  });
});

describe('isValidProxyUrl', () => {
  it('放行公网 http(s)', () => {
    expect(isValidProxyUrl('https://cdn.example.com/a.m3u8')).toBe(true);
    expect(isValidProxyUrl('http://1.2.3.4/x.ts')).toBe(true);
  });

  it('拦截内网与保留地址', () => {
    expect(isValidProxyUrl('http://localhost/x')).toBe(false);
    expect(isValidProxyUrl('http://127.0.0.1/x')).toBe(false);
    expect(isValidProxyUrl('http://192.168.1.1/x')).toBe(false);
    expect(isValidProxyUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('拦截带方括号的 IPv6 与 IPv4-mapped 写法', () => {
    expect(isValidProxyUrl('http://[::1]:8080/x')).toBe(false);
    expect(isValidProxyUrl('http://[::ffff:192.168.1.100]:8080/list.m3u')).toBe(false);
    expect(isValidProxyUrl('http://[::ffff:127.0.0.1]/x')).toBe(false);
    expect(isValidProxyUrl('http://[fe80::1]/x')).toBe(false);
    expect(isValidProxyUrl('http://[fd00::1]/x')).toBe(false);
  });

  it('不误杀公网 IPv6', () => {
    expect(isValidProxyUrl('http://[2606:4700::1111]/x')).toBe(true);
  });

  it('拦截非 http 协议', () => {
    expect(isValidProxyUrl('file:///etc/passwd')).toBe(false);
    expect(isValidProxyUrl('ftp://x.com/a')).toBe(false);
    expect(isValidProxyUrl('not a url')).toBe(false);
  });
});
