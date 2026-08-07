// 站点地址（sites.base_url）的权威归一化：平台无关，只用 Web 标准 URL，不碰 node:*。
// 契约（唯一真相源）：库里的 base_url 必须是**绝对 URL**（含 http:// 或 https://）、无末尾斜杠。
// 前端展示的裸域名是从它派生的有损值，禁止反向拼回请求 —— 本次故障就源于反向拼。
//
// 为什么不能只判断「new URL() 没抛异常」（实测见 task research 文档）：
//   new URL('astu.online:8080')    成功，protocol = 'astu.online:'（被当成自定义协议）
//   new URL('javascript:alert(1)') 成功，protocol = 'javascript:'
//   new URL('file:///etc/passwd')  成功，protocol = 'file:'
// 只看「没抛」等于把这三类全放行。本函数靠两件事挡住它们：缺协议头时**先补 https:// 再解析**
// （补了之后 'astu.online:8080' 才会被解析成主机+端口而不是一个奇怪的协议），
// 以及形如「其它协议://」的输入在解析前就拒掉。
// 下面那道 protocol 白名单在当前顺序下**走不到**（前置逻辑已保证协议只会是 http/https）,
// 保留它是防止将来有人「简化」前置逻辑时静默放行怪协议 —— 这正是本次故障的成因类型。
//
// 为什么本函数对「缺协议头」是宽容的（补 https:// 而不是直接报错）：它同时服务两类调用方，
// 而只有调用方知道信息还在不在。见下面 addedScheme 的说明。
//
// 为什么形如「其它协议://」一律拒而不猜：ftp:// / file:// / x:// 这类既不该出现在中转站地址里，
// 又无法安全地「转成」http —— 且若贸然前置 https://，'x://a.b' 会被解析成
// 主机 x + 路径 //a.b，静默存成 'https://x//a.b' 这种垃圾值（实测）。宁可让用户看见 400。

// addedScheme：原值缺协议头、由本函数补了 https://。调用方据此决定「宽还是严」：
//   - 存量库里的值（迁移 0007、PUT 未传 base_url）：协议头早已丢失且不可恢复，只能接受补值；
//   - 用户新填的值（POST / PUT 显式传）：用户还能把协议头补全，就该退回去让他填，
//     否则我们等于替他猜一个协议，猜错了（http-only 站点）就变成难查的连接失败。
// 一个函数两种严格度，靠这个字段在调用点区分 —— 严格度属于「策略」，放调用点；
// 归一化属于「机制」，放这里。判断依据不能反推（`https://a.b` 与补出来的 `https://a.b` 无法区分），
// 所以必须由本函数如实报告。
export type NormalizeResult =
  | { ok: true; value: string; addedScheme: boolean }
  | { ok: false; message: string };

// 允许的协议白名单。base_url 只用来拼 /api/... 请求，别的协议一律无意义。
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const HTTP_SCHEME_RE = /^https?:\/\//i;

// 归一化站点地址。失败时 message 是可直接回给用户的中文文案（路由层原样放进 400 的 error）。
export function normalizeBaseUrl(raw: unknown): NormalizeResult {
  if (typeof raw !== 'string') return { ok: false, message: '站点地址必填' };
  const s = raw.trim();
  if (!s) return { ok: false, message: '站点地址必填' };

  const hasHttpScheme = HTTP_SCHEME_RE.test(s);
  // 不以 http(s):// 开头却含 '://' → 就是别的协议（含 '1foo://' 这种非法 scheme 形状）。
  // 直接拒，不猜也不前置（前置会静默产出垃圾值，见文件头）。
  if (!hasHttpScheme && s.includes('://')) {
    return { ok: false, message: '站点地址只支持 http:// 或 https://' };
  }

  // 缺协议头 → 补 https:// 后再交给 URL 解析。
  const candidate = hasHttpScheme ? s : `https://${s}`;

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, message: '站点地址不是合法的 URL' };
  }

  // 显式白名单：这一步是契约的最后一道锁，即便上面的前置逻辑将来被改动也不会放行怪协议。
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    return { ok: false, message: '站点地址只支持 http:// 或 https://' };
  }
  // 空主机名在 http(s) 下解析必然抛错，此处属防御：workerd 与 Node 的 URL 实现若有差异，
  // 也不能让一个没有主机名的值入库（拼出来的请求必然打不出去）。
  if (!u.hostname) return { ok: false, message: '站点地址缺少主机名' };

  // 下面三类信息会被 origin + pathname 的输出「静默丢掉」，故一律拒而不是默默截断：
  // base_url 是拼接基址，带上它们必然拼错，静默丢弃只会把错误推到运行时。
  if (u.search) return { ok: false, message: '站点地址不应带查询参数（?...）' };
  if (u.hash) return { ok: false, message: '站点地址不应带 # 片段' };
  if (u.username || u.password) {
    return { ok: false, message: '站点地址不应带用户名/密码，access token 请填在下方 token 字段' };
  }

  // origin 已把协议与主机名小写化、省掉默认端口；pathname 保留子路径（有些站点挂在 /v1 下）。
  // 末尾斜杠必须去掉：调用方按 `${base}/api/pricing` 拼，留着会拼出双斜杠。
  return {
    ok: true,
    value: (u.origin + u.pathname).replace(/\/+$/, ''),
    addedScheme: !hasHttpScheme,
  };
}
