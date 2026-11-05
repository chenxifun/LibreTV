import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

/**
 * 随机片单接口单测：随机选源取列表（无 wd）、成人过滤、失败源进 failures、
 * 登录与参数校验。上游一律 mock fetch，无真实网络。
 */

// 测试用的假域名在真实 DNS 下不可解析；ssrf 的 isBlockedByDNS 是 fail-closed，
// 故必须 mock DNS 让假域名「解析成功」，测的才是 route 逻辑本身
vi.mock('node:dns/promises', () => ({
  default: {
    // 支持 { all: true }（返回数组）与无选项（返回单对象）两种调用形态
    lookup: async (hostname: string, opts?: { all?: boolean }) => {
      const address = hostname.includes('private') ? '10.0.0.1' : '93.184.216.34';
      return opts?.all ? [{ address, family: 4 }] : { address, family: 4 };
    },
  },
}));

function cmsList(items: Array<Record<string, unknown>>, pagecount = 200): string {
  return JSON.stringify({ code: 1, pagecount, list: items });
}

const fetchSpy = vi.fn();

function mockUpstream(pages: Record<number, Array<Record<string, unknown>>>, fallbackEmpty = false): void {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const pg = parseInt(url.searchParams.get('pg') || '1', 10);
    const list = pages[pg];
    if (list) {
      return new Response(cmsList(list), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // 未 mock 的页码：模拟「随机页码过深返回空」或正常空页
    return new Response(
      fallbackEmpty ? cmsList([]) : cmsList([{ vod_id: 900, vod_name: '回退页内容', type_name: '电影' }]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
  vi.stubGlobal('fetch', fetchSpy);
}

function makeGet(params: Record<string, string>, withAuth = true): Request {
  const qs = new URLSearchParams(params).toString();
  const headers: Record<string, string> = {};
  if (withAuth) {
    const { token } = signSession();
    headers.cookie = `${SESSION_COOKIE}=${token}`;
  }
  return new Request(`https://local.test/api/random?${qs}`, { headers });
}

const SOURCES = [
  { key: 'a', name: '源A', url: 'https://cms-a.example.com/api.php' },
  { key: 'b', name: '源B', url: 'https://cms-b.example.com/api.php' },
];

beforeAll(() => {
  process.env.PASSWORD = 'test-password-123';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/random', () => {
  it('成功：随机页取列表，URL 无 wd 参数（列表模式核心）', async () => {
    // 随机页码落在 1..200，mock 必须对任意页都给内容（否则触发空页回退路径）
    const pages: Record<number, Array<Record<string, unknown>>> = {};
    for (let p = 1; p <= 200; p++) {
      pages[p] = [
        { vod_id: 1, vod_name: '随机电影甲', type_name: '动作片' },
        { vod_id: 2, vod_name: '随机电影乙', type_name: '喜剧片' },
      ];
    }
    mockUpstream(pages);
    const res = await GET(makeGet({ sources: JSON.stringify(SOURCES), filterAdult: '0' }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { list: Array<{ name: string }>; failures: unknown[] };
    expect(data.list.length).toBeGreaterThan(0);
    expect(data.list.map((i) => i.name)).toContain('随机电影甲');

    // 所有上游请求都是列表模式：有 ac=videolist 和 pg=，绝无 wd=
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const u = new URL(call);
      expect(u.searchParams.has('wd')).toBe(false);
      expect(u.searchParams.has('pg')).toBe(true);
    }
  });

  it('filterAdult=1 时成人内容被过滤', async () => {
    const pages: Record<number, Array<Record<string, unknown>>> = {};
    for (let p = 1; p <= 200; p++) {
      pages[p] = [
        { vod_id: 1, vod_name: '正常片', type_name: '科幻片' },
        { vod_id: 2, vod_name: '福利片', type_name: '福利视频' },
      ];
    }
    mockUpstream(pages);
    const res = await GET(makeGet({ sources: JSON.stringify([SOURCES[0]]), filterAdult: '1' }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { list: Array<{ name: string }> };
    expect(data.list.map((i) => i.name)).toEqual(['正常片']);
  });

  it('失败源进 failures，其余源正常返回', async () => {
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cms-b.example')) return new Response('boom', { status: 500 });
      return new Response(cmsList([{ vod_id: 1, vod_name: '好片', type_name: '剧情片' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET(makeGet({ sources: JSON.stringify(SOURCES), filterAdult: '0' }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { list: Array<{ name: string }>; failures: Array<{ sourceKey: string }> };
    expect(data.list.map((i) => i.name)).toContain('好片');
    expect(data.failures.map((f) => f.sourceKey)).toContain('b');
  });

  it('随机页为空时回退 pg=1（空页重试逻辑）', async () => {
    // 所有非 1 页都返回空列表；pg=1 有内容 → 最终必须拿到内容
    let sawFallback = false;
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      const pg = u.searchParams.get('pg');
      if (pg === '1') {
        sawFallback = true;
        return new Response(cmsList([{ vod_id: 5, vod_name: '最新入库', type_name: '爱情片' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(cmsList([]), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET(makeGet({ sources: JSON.stringify([SOURCES[0]]), filterAdult: '0' }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { list: Array<{ name: string }> };
    expect(sawFallback).toBe(true);
    expect(data.list.map((i) => i.name)).toContain('最新入库');
  });

  it('未登录返回 401', async () => {
    const res = await GET(makeGet({ sources: JSON.stringify(SOURCES) }, false));
    expect(res.status).toBe(401);
  });

  it('sources 缺失或非法 JSON 返回 400', async () => {
    expect((await GET(makeGet({}))).status).toBe(400);
    expect((await GET(makeGet({ sources: 'not-json' }))).status).toBe(400);
    expect((await GET(makeGet({ sources: '{"a":1}' }))).status).toBe(400);
  });
});
