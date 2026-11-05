/**
 * 从请求头提取限流用客户端 IP。
 *
 * 为何取 XFF 末段而非首段：反向代理（nginx proxy_add_x_forwarded_for）会把
 * 真实客户端 IP 追加在末尾，首段完全由客户端自带的伪造头控制 —— 取首段的
 * 限流可被每请求换一个伪造 IP 无限绕过。末段才是最近一跳可信代理写入的地址。
 */
export function extractClientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const last = parts[parts.length - 1];
    if (last) {
      // 去掉可能携带的 :port（仅当 host 是点分 IPv4 时；IPv6 字面量含冒号，保持原样）
      const m = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(last);
      return m ? m[1] : last;
    }
  }
  const real = headers.get('x-real-ip');
  if (real && real.trim().length > 0) return real.trim();
  return 'unknown';
}
