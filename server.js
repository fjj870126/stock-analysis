/**
 * @brief 股票分析助手 — Node.js 后端服务器
 *
 * API 接口：
 *   GET /api/search?q=关键词     → 东方财富搜索
 *   GET /api/quote?code=600519   → 新浪实时行情
 *   GET /api/kline?code=600519   → 同花顺日K线
 *   GET /api/sectors            → 板块分类 + 股票列表
 *   GET /api/news               → 财经新闻
 *   GET /                       → 静态 HTML 页面
 *
 * 启动：node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const PORT = parseInt(process.env.PORT || '3000', 10);

// ===================================================================
// 工具函数
// ===================================================================

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn/' },
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } finally { clearTimeout(timer); }
}

async function fetchGBK(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn/' },
    });
    const text = iconv.decode(Buffer.from(await res.arrayBuffer()), 'gbk');
    return { ok: res.ok, status: res.status, text };
  } finally { clearTimeout(timer); }
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function sendError(res, status, msg) { sendJSON(res, status, { error: msg }); }

// 简单内存缓存
const cache = {};
function getCache(key, ttlMs) {
  const entry = cache[key];
  if (entry && Date.now() - entry.time < ttlMs) return entry.data;
  return null;
}
function setCache(key, data) { cache[key] = { data, time: Date.now() }; }

function getPrefix(code) {
  const c = String(code).trim();
  if (c.startsWith('6') || c.startsWith('9')) return 'sh';
  if (c.startsWith('0') || c.startsWith('3')) return 'sz';
  if (c.startsWith('4') || c.startsWith('8')) return 'bj';
  return 'sh';
}

/** 解析新浪行情文本 */
function parseSinaQuote(code, text) {
  const m = text.match(/"([^"]+)"/);
  if (!m) return null;
  const f = m[1].split(',');
  const prevClose = parseFloat(f[2]) || 0;
  const price = parseFloat(f[3]) || 0;
  const changeAmt = price - prevClose;
  const changePct = prevClose > 0 ? (changeAmt / prevClose) * 100 : 0;
  return {
    code,
    name: f[0] || code,
    price: Math.round(price * 100) / 100,
    changeAmt: Math.round(changeAmt * 100) / 100,
    changePct: Math.round(changePct * 100) / 100,
    volume: parseFloat(f[8]) || 0,
    amount: parseFloat(f[9]) || 0,
  };
}

// ===================================================================
// 板块数据
// ===================================================================
const SECTORS = [
  {
    name: '🏦 大金融', stocks: [
      { code: '600036', name: '招商银行' }, { code: '601318', name: '中国平安' },
      { code: '601166', name: '兴业银行' }, { code: '600030', name: '中信证券' },
      { code: '601398', name: '工商银行' }, { code: '601939', name: '建设银行' },
      { code: '601288', name: '农业银行' }, { code: '601988', name: '中国银行' },
      { code: '601328', name: '交通银行' }, { code: '601628', name: '中国人寿' },
      { code: '601601', name: '中国太保' }, { code: '601336', name: '新华保险' },
      { code: '601319', name: '中国人保' }, { code: '600016', name: '民生银行' },
      { code: '600000', name: '浦发银行' }, { code: '601818', name: '光大银行' },
      { code: '600015', name: '华夏银行' }, { code: '601169', name: '北京银行' },
      { code: '601009', name: '南京银行' }, { code: '002142', name: '宁波银行' },
      { code: '600919', name: '杭州银行' }, { code: '601688', name: '华泰证券' },
      { code: '601211', name: '国泰君安' }, { code: '600837', name: '海通证券' },
      { code: '000166', name: '申万宏源' }, { code: '000776', name: '广发证券' },
      { code: '600958', name: '东方证券' }, { code: '601066', name: '中信建投' },
      { code: '601995', name: '中金公司' }, { code: '601658', name: '邮储银行' },
    ]
  },
  {
    name: '🔋 新能源', stocks: [
      { code: '300750', name: '宁德时代' }, { code: '002594', name: '比亚迪' },
      { code: '601012', name: '隆基绿能' }, { code: '300274', name: '阳光电源' },
      { code: '002466', name: '天齐锂业' }, { code: '600438', name: '通威股份' },
      { code: '600089', name: '特变电工' }, { code: '002460', name: '赣锋锂业' },
      { code: '300014', name: '亿纬锂能' }, { code: '688223', name: '晶科能源' },
      { code: '601615', name: '明阳智能' }, { code: '002709', name: '天赐材料' },
      { code: '300450', name: '先导智能' }, { code: '603799', name: '华友钴业' },
      { code: '002129', name: 'TCL中环' }, { code: '300124', name: '汇川技术' },
      { code: '600732', name: '爱旭股份' }, { code: '600905', name: '三峡能源' },
      { code: '601877', name: '正泰电器' }, { code: '300751', name: '迈为股份' },
      { code: '603659', name: '璞泰来' }, { code: '688390', name: '固德威' },
      { code: '600884', name: '杉杉股份' }, { code: '300568', name: '星源材质' },
      { code: '002074', name: '国轩高科' }, { code: '688005', name: '容百科技' },
    ]
  },
  {
    name: '💻 科技', stocks: [
      { code: '002415', name: '海康威视' }, { code: '688981', name: '中芯国际' },
      { code: '603501', name: '韦尔股份' }, { code: '002371', name: '北方华创' },
      { code: '603019', name: '中科曙光' }, { code: '000938', name: '紫光股份' },
      { code: '688041', name: '海光信息' }, { code: '601138', name: '工业富联' },
      { code: '688111', name: '金山办公' }, { code: '688012', name: '中微公司' },
      { code: '002230', name: '科大讯飞' }, { code: '300782', name: '卓胜微' },
      { code: '688008', name: '澜起科技' }, { code: '603986', name: '兆易创新' },
      { code: '600745', name: '闻泰科技' }, { code: '002049', name: '紫光国微' },
      { code: '300661', name: '圣邦股份' }, { code: '688256', name: '寒武纪' },
      { code: '688036', name: '传音控股' }, { code: '688396', name: '华润微' },
      { code: '300474', name: '景嘉微' }, { code: '603160', name: '汇顶科技' },
      { code: '688568', name: '中科星图' }, { code: '688095', name: '福昕软件' },
      { code: '002916', name: '深南电路' }, { code: '603005', name: '晶丰明源' },
    ]
  },
  {
    name: '🍶 消费', stocks: [
      { code: '600519', name: '贵州茅台' }, { code: '000333', name: '美的集团' },
      { code: '000858', name: '五粮液' }, { code: '600690', name: '海尔智家' },
      { code: '600887', name: '伊利股份' }, { code: '603288', name: '海天味业' },
      { code: '000651', name: '格力电器' }, { code: '002714', name: '牧原股份' },
      { code: '000568', name: '泸州老窖' }, { code: '002304', name: '洋河股份' },
      { code: '600809', name: '山西汾酒' }, { code: '000596', name: '古井贡酒' },
      { code: '600600', name: '青岛啤酒' }, { code: '000895', name: '双汇发展' },
      { code: '300498', name: '温氏股份' }, { code: '002311', name: '海大集团' },
      { code: '600559', name: '老白干酒' }, { code: '603369', name: '今世缘' },
      { code: '002557', name: '洽洽食品' }, { code: '603345', name: '安井食品' },
      { code: '300999', name: '金龙鱼' }, { code: '603899', name: '晨光股份' },
      { code: '603027', name: '千禾味业' }, { code: '002847', name: '盐津铺子' },
      { code: '000729', name: '燕京啤酒' }, { code: '600882', name: '妙可蓝多' },
    ]
  },
  {
    name: '💊 医药', stocks: [
      { code: '603259', name: '药明康德' }, { code: '600276', name: '恒瑞医药' },
      { code: '300760', name: '迈瑞医疗' }, { code: '300015', name: '爱尔眼科' },
      { code: '600436', name: '片仔癀' }, { code: '300122', name: '智飞生物' },
      { code: '000538', name: '云南白药' }, { code: '002007', name: '华兰生物' },
      { code: '300347', name: '泰格医药' }, { code: '300003', name: '乐普医疗' },
      { code: '600196', name: '复星医药' }, { code: '000661', name: '长春高新' },
      { code: '601607', name: '上海医药' }, { code: '600763', name: '通策医疗' },
      { code: '002821', name: '凯莱英' }, { code: '300759', name: '康龙化成' },
      { code: '688180', name: '君实生物' }, { code: '300601', name: '康泰生物' },
      { code: '000423', name: '东阿阿胶' }, { code: '600085', name: '同仁堂' },
      { code: '300529', name: '健帆生物' }, { code: '300725', name: '药石科技' },
      { code: '688185', name: '康希诺' }, { code: '300363', name: '博腾股份' },
      { code: '603392', name: '万泰生物' }, { code: '000999', name: '华润三九' },
    ]
  },
  {
    name: '⛏️ 周期', stocks: [
      { code: '601899', name: '紫金矿业' }, { code: '601088', name: '中国神华' },
      { code: '600309', name: '万华化学' }, { code: '600585', name: '海螺水泥' },
      { code: '601919', name: '中远海控' }, { code: '600019', name: '宝钢股份' },
      { code: '601857', name: '中国石油' }, { code: '600028', name: '中国石化' },
      { code: '601225', name: '陕西煤业' }, { code: '600547', name: '山东黄金' },
      { code: '600489', name: '中金黄金' }, { code: '600362', name: '江西铜业' },
      { code: '000630', name: '铜陵有色' }, { code: '000831', name: '中国稀土' },
      { code: '601600', name: '中国铝业' }, { code: '600188', name: '兖矿能源' },
      { code: '601898', name: '中煤能源' }, { code: '600516', name: '方大炭素' },
      { code: '601168', name: '西部矿业' }, { code: '000898', name: '鞍钢股份' },
      { code: '600010', name: '包钢股份' }, { code: '600295', name: '鄂尔多斯' },
      { code: '002353', name: '杰瑞股份' }, { code: '000983', name: '山西焦煤' },
      { code: '601699', name: '潞安环能' }, { code: '600348', name: '华阳股份' },
    ]
  },
  {
    name: '⚔️ 军工', stocks: [
      { code: '600893', name: '航发动力' }, { code: '600760', name: '中航沈飞' },
      { code: '600150', name: '中国船舶' }, { code: '002179', name: '中航光电' },
      { code: '600862', name: '中航高科' }, { code: '000768', name: '中航西飞' },
      { code: '600038', name: '中直股份' }, { code: '600879', name: '航天电子' },
      { code: '600118', name: '中国卫星' }, { code: '600967', name: '内蒙一机' },
      { code: '002013', name: '中航机电' }, { code: '002465', name: '海格通信' },
      { code: '300699', name: '光威复材' }, { code: '600685', name: '中船防务' },
      { code: '600764', name: '中国海防' }, { code: '600391', name: '航发科技' },
      { code: '600990', name: '四创电子' }, { code: '002151', name: '北斗星通' },
      { code: '600705', name: '中航产融' }, { code: '300777', name: '中简科技' },
      { code: '002023', name: '海特高新' }, { code: '300447', name: '全信股份' },
      { code: '688281', name: '华秦科技' }, { code: '600184', name: '光电股份' },
      { code: '300722', name: '新余国科' },
    ]
  },
];

// ===================================================================
// API: 资金流向
// ===================================================================
async function handleMoneyFlow(req, res) {
  const code = (new URL(req.url, `http://${req.headers.host}`).searchParams.get('code') || '').trim();
  if (!/^\d{6}$/.test(code)) return sendError(res, 400, '代码格式错误');
  try {
    const mkt = code.startsWith('6') ? '1' : '0';
    const r = await fetch(`https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=${mkt}.${code}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55&lmt=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' }
    });
    const text = await r.text();
    const j = JSON.parse(text);
    if (!j.data?.klines?.length) return sendJSON(res, 200, { data: null });
    const parts = j.data.klines[0].split(',');
    // 格式: 日期,主力净流入,小单净流入,中单净流入,大单净流入(?)
    // 单位: 元
    sendJSON(res, 200, {
      data: {
        date: parts[0],
        main: parseFloat(parts[1]) || 0,     // 主力净流入
        small: parseFloat(parts[2]) || 0,     // 小单
        mid: parseFloat(parts[3]) || 0,       // 中单
        big: parseFloat(parts[4]) || 0,       // 大单
      }
    });
  } catch (e) { sendError(res, 500, '获取资金流向失败: ' + e.message); }
}

// ===================================================================
// API: 搜索
// ===================================================================
async function handleSearch(req, res) {
  const keyword = new URL(req.url, `http://${req.headers.host}`).searchParams.get('q') || '';
  if (!keyword) return sendError(res, 400, '缺少关键词');
  try {
    const r = await fetchWithTimeout(`https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33C9F32511B2C0D8D6B5B&count=8`);
    const raw = JSON.parse(r.text);
    sendJSON(res, 200, { Data: raw.QuotationCodeTable?.Data || [] });
  } catch (e) { sendError(res, 500, '搜索失败: ' + e.message); }
}

// ===================================================================
// API: 实时行情
// ===================================================================
async function handleQuote(req, res) {
  const code = (new URL(req.url, `http://${req.headers.host}`).searchParams.get('code') || '').trim();
  if (!/^\d{6}$/.test(code)) return sendError(res, 400, '代码格式错误');
  try {
    const prefix = getPrefix(code);
    const [sinaR, txR] = await Promise.allSettled([
      fetchGBK(`https://hq.sinajs.cn/list=${prefix}${code}`),
      fetchGBK(`https://qt.gtimg.cn/q=${prefix}${code}`)
    ]);
    if (sinaR.status !== 'fulfilled' || !sinaR.value.ok) return sendError(res, 502, '行情服务不可用');
    const m = sinaR.value.text.match(/"([^"]+)"/);
    if (!m) return sendError(res, 502, '数据解析失败');
    const f = m[1].split(',');
    const prevClose = parseFloat(f[2]) || 0;
    const price = parseFloat(f[3]) || 0;

    // 从腾讯接口补充数据
    let pe = 0, turnover = 0, amplitude = 0, totalMv = 0, circMv = 0;
    if (txR.status === 'fulfilled' && txR.value.ok) {
      const tm = txR.value.text.match(/"([^"]+)"/);
      if (tm) {
        const t = tm[1].split('~');
        turnover = parseFloat(t[38]) || 0;
        pe = parseFloat(t[39]) || 0;
        amplitude = parseFloat(t[43]) || 0;
        totalMv = parseFloat(t[45]) || 0;
        circMv = parseFloat(t[46]) || 0;
      }
    }

    sendJSON(res, 200, {
      data: {
        code, name: f[0] || code,
        price: Math.round(price * 100) / 100,
        open: Math.round(parseFloat(f[1]) * 100) / 100 || 0,
        high: Math.round(parseFloat(f[4]) * 100) / 100 || 0,
        low: Math.round(parseFloat(f[5]) * 100) / 100 || 0,
        prevClose: Math.round(prevClose * 100) / 100,
        changeAmt: Math.round((price - prevClose) * 100) / 100,
        changePct: Math.round(((price - prevClose) / prevClose) * 10000) / 100,
        volume: parseFloat(f[8]) || 0,
        amount: parseFloat(f[9]) || 0,
        turnover, pe, amplitude, totalMv, circMv,
      }
    });
  } catch (e) { sendError(res, 500, '获取行情失败: ' + e.message); }
}

// ===================================================================
// API: K线
// ===================================================================
async function handleKline(req, res) {
  const code = (new URL(req.url, `http://${req.headers.host}`).searchParams.get('code') || '').trim();
  const days = parseInt(new URL(req.url, `http://${req.headers.host}`).searchParams.get('days') || '120', 10);
  if (!/^\d{6}$/.test(code)) return sendError(res, 400, '代码格式错误');
  try {
    const r = await fetchWithTimeout(`https://d.10jqka.com.cn/v2/line/hs_${code}/01/last.js`, 10000);
    const j = JSON.parse(r.text.match(/\((.+)\)/)[1]);
    if (!j.data || typeof j.data !== 'string') return sendError(res, 502, 'K线数据为空');
    const klines = j.data.split(';').filter(Boolean).reverse().slice(0, days).map(line => {
      const p = line.split(',');
      return { date: p[0], open: +p[1] || 0, high: +p[2] || 0, low: +p[3] || 0, close: +p[4] || 0, volume: +p[5] || 0, amount: +p[6] || 0 };
    });
    sendJSON(res, 200, { data: { klines } });
  } catch (e) { sendError(res, 500, '获取K线失败: ' + e.message); }
}

// ===================================================================
// API: 分时数据
// ===================================================================
async function handleTimeline(req, res) {
  const code = (new URL(req.url, `http://${req.headers.host}`).searchParams.get('code') || '').trim();
  if (!/^\d{6}$/.test(code)) return sendError(res, 400, '代码格式错误');
  try {
    const prefix = getPrefix(code);
    const r = await fetchGBK(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${prefix}${code}`, 8000);
    if (!r.ok) return sendError(res, 502, '分时服务不可用');
    const j = JSON.parse(r.text);
    const data = j.data?.[`${prefix}${code}`]?.data?.data;
    const tdata = j.data?.[`${prefix}${code}`]?.data?.tdata;
    if (!data || !Array.isArray(data)) return sendError(res, 502, '分时数据为空');
    const prevClose = tdata && tdata[0] ? parseFloat(tdata[0].split(' ')[1]) || 0 : 0;
    const lines = data.map(item => {
      const p = item.split(' ');
      const t = p[0], price = parseFloat(p[1]) || 0, vol = parseFloat(p[2]) || 0;
      const hh = Math.floor(t / 100), mm = t % 100;
      return { time: `${hh}:${String(mm).padStart(2,'0')}`, price, volume: vol, amount: parseFloat(p[3]) || 0 };
    });
    sendJSON(res, 200, { data: { lines, prevClose } });
  } catch (e) { sendError(res, 500, '获取分时失败: ' + e.message); }
}

// ===================================================================
// API: 板块列表（含股票）
// ===================================================================
async function handleSectors(req, res) {
  // 返回板块结构（不含实时行情，前端按需加载）
  sendJSON(res, 200, { data: SECTORS });
}

// ===================================================================
// API: 板块股票实时行情
// ===================================================================
async function handleSectorQuotes(req, res) {
  const codes = (new URL(req.url, `http://${req.headers.host}`).searchParams.get('codes') || '').split(',');
  if (!codes.length) return sendError(res, 400, '缺少 codes 参数');
  const cacheKey = 'sq_' + codes.join(',');
  const cached = getCache(cacheKey, 15000);
  if (cached) return sendJSON(res, 200, { data: cached });
  try {
    const quotes = [];
    const batchSize = 5;
    for (let i = 0; i < codes.length; i += batchSize) {
      const batch = codes.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map(c => fetchGBK(`https://hq.sinajs.cn/list=${getPrefix(c)}${c}`, 8000)));
      if (i + batchSize < codes.length) await new Promise(r => setTimeout(r, 50));
      for (let j = 0; j < results.length; j++) {
        if (results[j].status !== 'fulfilled' || !results[j].value.ok) continue;
        const q = parseSinaQuote(batch[j], results[j].value.text);
        if (q) quotes.push(q);
      }
    }
    setCache(cacheKey, quotes);
    sendJSON(res, 200, { data: quotes });
  } catch (e) { sendError(res, 500, '获取板块行情失败: ' + e.message); }
}

// ===================================================================
// API: 涨跌排行榜
// ===================================================================
async function handleRanking(req, res) {
  try {
    // 从各板块取代表性股票（每板块取前4只）
    const topStocks = SECTORS.flatMap(s => s.stocks.slice(0, 4));
    const codes = topStocks.map(s => s.code);
    const results = await Promise.allSettled(codes.map(c => fetchGBK(`https://hq.sinajs.cn/list=${getPrefix(c)}${c}`, 8000)));
    const quotes = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== 'fulfilled' || !results[i].value.ok) continue;
      const q = parseSinaQuote(codes[i], results[i].value.text);
      if (q) quotes.push(q);
    }
    // 按涨幅排序
    const gainers = [...quotes].sort((a, b) => b.changePct - a.changePct).slice(0, 15);
    const losers = [...quotes].sort((a, b) => a.changePct - b.changePct).slice(0, 15);
    sendJSON(res, 200, { data: { gainers, losers } });
  } catch (e) { sendError(res, 500, '获取排行榜失败: ' + e.message); }
}

// ===================================================================
// API: 智能推荐（今日买入/卖出/持有）
// ===================================================================
async function handleRecommend(req, res) {
  const cached = getCache('recommend', 30000);
  if (cached) return sendJSON(res, 200, { data: cached });
  try {
    // 取所有板块全部股票
    const stocks = SECTORS.flatMap(s => s.stocks);
    const codes = stocks.map(s => s.code);
    const nameMap = {};
    stocks.forEach(s => nameMap[s.code] = s.name);

    // 获取所有股票的行情+换手率
    const quotes = [];
    const batchSize = 5;
    for (let i = 0; i < codes.length; i += batchSize) {
      const batch = codes.slice(i, i + batchSize);
      const [qr, txr] = await Promise.all([
        Promise.allSettled(batch.map(c => fetchGBK(`https://hq.sinajs.cn/list=${getPrefix(c)}${c}`, 6000))),
        Promise.allSettled(batch.map(c => fetchGBK(`https://qt.gtimg.cn/q=${getPrefix(c)}${c}`, 6000)))
      ]);
      for (let j = 0; j < batch.length; j++) {
        const code = batch[j];
        let price = 0, changePct = 0, turnover = 0;
        if (qr[j].status === 'fulfilled' && qr[j].value.ok) {
          const q = parseSinaQuote(code, qr[j].value.text);
          if (q) { price = q.price; changePct = q.changePct; }
        }
        if (txr[j].status === 'fulfilled' && txr[j].value.ok) {
          const tm = txr[j].value.text.match(/"([^"]+)"/);
          if (tm) turnover = parseFloat(tm[1].split('~')[38]) || 0;
        }
        quotes.push({ code, name: nameMap[code] || code, price, changePct, turnover });
      }
      // 每批间隔避免被限
      if (i + batchSize < codes.length) await new Promise(r => setTimeout(r, 50));
    }

    // 分类推荐（只用涨幅+换手率判断）
    const buy = [], sell = [], hold = [];
    for (const q of quotes) {
      if (!q.price) continue;
      let signals = 0, bearSignals = 0;

      // 买入信号：温和放量上涨 + 涨幅适中 + 换手率健康
      if (q.changePct > 0.5 && q.changePct < 4 && q.turnover > 0.3) signals += 2;
      else if (q.changePct > 0 && q.changePct < 2) signals++;

      // 卖出信号：明显下跌 或 放量暴跌
      if (q.changePct < -2) bearSignals += 2;
      else if (q.changePct < -1) bearSignals++;
      if (q.turnover > 3 && q.changePct < -0.5) bearSignals++;
      if (q.turnover > 5 && q.changePct < 0) bearSignals++;

      if (signals >= 2) buy.push({ code: q.code, name: q.name, price: q.price, pct: q.changePct });
      else if (bearSignals >= 2) sell.push({ code: q.code, name: q.name, price: q.price, pct: q.changePct });
      else hold.push({ code: q.code, name: q.name, price: q.price, pct: q.changePct });
    }

    buy.sort((a, b) => b.pct - a.pct);
    sell.sort((a, b) => a.pct - b.pct);
    hold.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

    const result = {
      buy: buy.slice(0, 10),
      sell: sell.slice(0, 10),
      hold: hold.slice(0, 10),
      updated: new Date().toLocaleTimeString('zh-CN'),
    };
    setCache('recommend', result);
    sendJSON(res, 200, { data: result });
  } catch (e) { sendError(res, 500, '获取推荐失败: ' + e.message); }
}

// ===================================================================
// API: 财经新闻
// ===================================================================
async function handleNews(req, res) {
  const cached = getCache('news', 30000);
  if (cached) return sendJSON(res, 200, { data: cached });
  try {
    const r = await fetchWithTimeout('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=20');
    const j = JSON.parse(r.text);
    const list = (j.result?.data || []).map(item => ({
      title: item.title || '',
      url: item.url || item.link || '',
      time: item.ctime || item.intime || '',
      summary: (item.summary || item.sum || '').slice(0, 100),
    })).filter(item => item.title);
    setCache('news', list);
    sendJSON(res, 200, { data: list });
  } catch (e) { sendError(res, 500, '获取新闻失败: ' + e.message); }
}

// ===================================================================
// 静态文件服务
// ===================================================================
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function serveStatic(res, fp) {
  try {
    const data = await fs.promises.readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch { sendError(res, 404, '未找到'); }
}

// ===================================================================
// 入口
// ===================================================================
const server = http.createServer((req, res) => {
  const p = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (p === '/api/search' && req.method === 'GET') return handleSearch(req, res);
  if (p === '/api/quote' && req.method === 'GET') return handleQuote(req, res);
  if (p === '/api/kline' && req.method === 'GET') return handleKline(req, res);
  if (p === '/api/timeline' && req.method === 'GET') return handleTimeline(req, res);
  if (p === '/api/ranking' && req.method === 'GET') return handleRanking(req, res);
  if (p === '/api/recommend' && req.method === 'GET') return handleRecommend(req, res);
  if (p === '/api/moneyflow' && req.method === 'GET') return handleMoneyFlow(req, res);
  
  if (p === '/api/sectors' && req.method === 'GET') return handleSectors(req, res);
  if (p === '/api/sector-quotes' && req.method === 'GET') return handleSectorQuotes(req, res);
  if (p === '/api/news' && req.method === 'GET') return handleNews(req, res);
  if (p === '/' || p === '') return serveStatic(res, path.join(__dirname, 'stock-analysis.html'));
  serveStatic(res, path.join(__dirname, p));
});

server.listen(PORT, () => {
  console.log(`✅ 股票分析助手已启动  http://localhost:${PORT}`);
});