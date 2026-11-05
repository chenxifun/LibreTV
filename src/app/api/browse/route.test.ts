import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

/**
 * 片库检索接口单测：动态分类树（无 ac 参数）+ 分页列表（t/year/v/pg）。
 * 上游一律 mock fetch，无真实网络。
 */

// 假域名真实 DNS 不可解析；ssrf fail-closed 下必须 mock DNS（对齐 search/random 测试）
vi.mock('node:dns/promises', () => ({
  default: {
    lookup: async (hostname: string, opts?: { all?: boolean }) => {
      const address = hostname.includes('private') ? '10.0.0.1' : '93.184.216.34';
      return opts?.all ? [{ address, family: 4 }] : { address, family: 4 };
    },
  },
}));

const fetchSpy = vi.fn();

function stubUpstream(handler: (url: URL) => Response | undefined): void {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const res = handler(url);
    if (res) return res;
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchSpy);
}

function authed(url: string, init?: RequestInit): Request {
  const { token } = signSession();
  return new Request(url, {
    ...init,
    headers: { ...(init?.headers || {}), cookie: `${SESSION_COOKIE}=${token}` },
  });
}

const SOURCE = { key: 'a', name: '源A', url: 'https://cms-a.example.com/api.php/provide/vod' };

beforeAll(() => {
  process.env.PASSWORD = 'test-password-123';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/browse (categories)', () => {
  it('返回源的分类树，请求不带 ac 参数', async () => {
    stubUpstream((u) => {
      if (u.hostname === 'cms-a.example.com' && !u.searchParams.has('ac')) {
        return new Response(
          JSON.stringify({
            code: 1,
            class: [
              { type_id: 20, type_pid: 0, type_name: '电影片' },
              { type_id: 21, type_pid: 20, type_name: '动作片' },
              { type_id: 30, type_pid: 0, type_name: '连续剧' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
    });
    const res = await GET(authed(`https://local.test/api/browse?categories=1&url=${encodeURIComponent(SOURCE.url)}`));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { categories: Array<{ id: number; pid: number; name: string }> };
    expect(data.categories).toHaveLength(3);
    expect(data.categories[0]).toMatchObject({ id: 20, pid: 0, name: '电影片' });
    // 上游请求：无 ac（分类树模式）
    const called = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(called.searchParams.has('ac')).toBe(false);
  });

  it('未登录 401', async () => {
    const res = await GET(new Request(`https://local.test/api/browse?categories=1&url=${encodeURIComponent(SOURCE.url)}`));
    expect(res.status).toBe(401);
  });

  it('缺 url 参数 400', async () => {
    const res = await GET(authed('https://local.test/api/browse?categories=1'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/browse (list)', () => {
  it('透传 t/year/pg/v 并返回分页信息', async () => {
    stubUpstream((u) => {
      if (u.searchParams.get('ac') === 'videolist') {
        expect(u.searchParams.get('t')).toBe('21');
        expect(u.searchParams.get('year')).toBe('2024');
        expect(u.searchParams.get('pg')).toBe('2');
        return new Response(
          JSON.stringify({
            code: 1,
            page: 2,
            pagecount: 257,
            total: 5135,
            list: [
              { vod_id: 1, vod_name: '动作片甲', type_name: '动作片', vod_year: '2024' },
              { vod_id: 2, vod_name: '动作片乙', type_name: '动作片', vod_year: '2024' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
    });
    const res = await POST(
      authed('https://local.test/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: SOURCE, t: 21, year: '2024', pg: 2 }),
      })
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      list: Array<{ name: string }>;
      page: number;
      pagecount: number;
    };
    expect(data.list).toHaveLength(2);
    expect(data.page).toBe(2);
    expect(data.pagecount).toBe(257);
  });

  it('不传 t 时请求不带 t 参数（全库分页）', async () => {
    stubUpstream((u) => {
      if (u.searchParams.get('ac') === 'videolist') {
        expect(u.searchParams.has('t')).toBe(false);
        return new Response(
          JSON.stringify({ code: 1, page: 1, pagecount: 1, total: 2, list: [{ vod_id: 9, vod_name: '任意', type_name: '电影' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
    });
    const res = await POST(
      authed('https://local.test/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: SOURCE, pg: 1 }),
      })
    );
    expect(res.status).toBe(200);
  });

  it('上游 500 时返回 502 与错误信息', async () => {
    stubUpstream(() => new Response('boom', { status: 500 }));
    const res = await POST(
      authed('https://local.test/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: SOURCE, pg: 1 }),
      })
    );
    expect(res.status).toBe(502);
  });

  it('未登录 401 / body 非法 400', async () => {
    const noAuth = await POST(
      new Request('https://local.test/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: SOURCE, pg: 1 }),
      })
    );
    expect(noAuth.status).toBe(401);
    const bad = await POST(
      authed('https://local.test/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      })
    );
    expect(bad.status).toBe(400);
  });
});
