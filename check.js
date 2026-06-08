
/* ===== API ===== */
const API = {
  async get(url) { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  search: q => API.get(`/api/search?q=${encodeURIComponent(q)}`),
  quote: c => API.get(`/api/quote?code=${c}`),
  kline: (c, d) => API.get(`/api/kline?code=${c}&days=${d || 120}`),
  timeline: c => API.get(`/api/timeline?code=${c}`),
  sectors: () => API.get('/api/sectors'),
  sectorQuotes: codes => API.get(`/api/sector-quotes?codes=${codes.join(',')}`),
  sectorHeat: () => API.get('/api/sector-heat'),
  news: () => API.get('/api/news'),
};

/* ===== 技术指标 ===== */
const TA = {
  ma(data, p) {
    const r = [];
    for (let i = 0; i < data.length; i++) {
      if (i < p - 1) { r.push(null); continue; }
      let s = 0; for (let j = i - p + 1; j <= i; j++) s += data[j];
      r.push(s / p);
    }
    return r;
  },
  ema(data, p) {
    const r = [data[0]]; const k = 2 / (p + 1);
    for (let i = 1; i < data.length; i++) r.push(data[i] * k + r[i - 1] * (1 - k));
    return r;
  },
  macd(closes) {
    const dif = TA.ema(closes, 12);
    const dea = [dif[0]];
    for (let i = 1; i < dif.length; i++) dea.push(dif[i] * 0.2 + dea[i - 1] * 0.8);
    const bar = dif.map((d, i) => (d - dea[i]) * 2);
    return { dif, dea, bar };
  },
  kdj(highs, lows, closes) {
    const n = 9, kArr = [], dArr = [], jArr = [];
    let pk = 50, pd = 50;
    for (let i = 0; i < closes.length; i++) {
      if (i < n - 1) { kArr.push(null); dArr.push(null); jArr.push(null); continue; }
      let hh = -Infinity, ll = Infinity;
      for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]); }
      const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
      const k = i === n - 1 ? rsv : (2 / 3 * pk + 1 / 3 * rsv);
      const d = i === n - 1 ? k : (2 / 3 * pd + 1 / 3 * k);
      kArr.push(Math.round(k * 100) / 100);
      dArr.push(Math.round(d * 100) / 100);
      jArr.push(Math.round((3 * k - 2 * d) * 100) / 100);
      pk = k; pd = d;
    }
    return { k: kArr, d: dArr, j: jArr };
  },
  rsi(closes, p) {
    const r = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < p) { r.push(null); continue; }
      let g = 0, l = 0;
      for (let j = i - p + 1; j <= i; j++) { const d = closes[j] - closes[j - 1]; if (d > 0) g += d; else l += Math.abs(d); }
      r.push(g + l === 0 ? 50 : Math.round(100 * g / (g + l) * 100) / 100);
    }
    return r;
  },
  volMa: (v, p) => TA.ma(v, p),
};

/* ===== 买卖信号 ===== */
function analyzeSignals(klines) {
  const c = klines.map(k => k.close), h = klines.map(k => k.high), l = klines.map(k => k.low), v = klines.map(k => k.volume), len = c.length;
  if (len < 60) return { signal: 'hold', label: '🟡 持有', reasons: { bull: [], bear: [] }, details: {} };
  const ma5 = TA.ma(c, 5), ma10 = TA.ma(c, 10), ma20 = TA.ma(c, 20), ma60 = TA.ma(c, 60);
  const macd = TA.macd(c), kdj = TA.kdj(h, l, c), rsi6 = TA.rsi(c, 6), rsi14 = TA.rsi(c, 14), vm5 = TA.volMa(v, 5);
  const i = len - 1, i1 = len - 2, i2 = len - 3;
  const bull = [], bear = [];
  let str = 0;

  if (c[i] > ma5[i] && ma5[i] !== null) { bull.push('站上MA5'); str += 1; } else { bear.push('跌破MA5'); str -= 1; }
  if (ma5[i1] !== null && ma10[i1] !== null && ma5[i] !== null && ma10[i] !== null) {
    if (ma5[i1] <= ma10[i1] && ma5[i] > ma10[i]) { bull.push('MA5金叉MA10'); str += 2; }
    else if (ma5[i1] >= ma10[i1] && ma5[i] < ma10[i]) { bear.push('MA5死叉MA10'); str -= 2; }
  }
  if (ma5[i] !== null && ma10[i] !== null && ma20[i] !== null) {
    if (ma5[i] > ma10[i] && ma10[i] > ma20[i]) { bull.push('均线多头排列'); str += 2; }
    else if (ma5[i] < ma10[i] && ma10[i] < ma20[i]) { bear.push('均线空头排列'); str -= 2; }
  }
  if (macd.dif[i] !== undefined && macd.dea[i] !== undefined) {
    if (macd.dif[i1] <= macd.dea[i1] && macd.dif[i] > macd.dea[i]) { bull.push('MACD金叉'); str += 2; }
    else if (macd.dif[i1] >= macd.dea[i1] && macd.dif[i] < macd.dea[i]) { bear.push('MACD死叉'); str -= 2; }
    if (macd.bar[i] > 0) { bull.push('MACD红柱'); str += 1; } else { bear.push('MACD绿柱'); str -= 1; }
  }
  if (kdj.k[i] !== null && kdj.d[i] !== null) {
    if (kdj.k[i1] <= kdj.d[i1] && kdj.k[i] > kdj.d[i]) { bull.push('KDJ金叉'); str += 1.5; }
    else if (kdj.k[i1] >= kdj.d[i1] && kdj.k[i] < kdj.d[i]) { bear.push('KDJ死叉'); str -= 1.5; }
    if (kdj.k[i] < 20) { bull.push('KDJ超卖'); str += 1.5; }
    else if (kdj.k[i] > 80) { bear.push('KDJ超买'); str -= 1.5; }
  }
  if (rsi6[i] !== null) {
    if (rsi6[i] < 30) { bull.push('RSI超卖'); str += 1; }
    else if (rsi6[i] > 70) { bear.push('RSI超买'); str -= 1; }
  }
  if (vm5[i] !== null) {
    const vr = v[i] / vm5[i];
    if (vr > 1.5 && c[i] > c[i1]) { bull.push('放量上涨'); str += 1; }
    else if (vr > 1.5 && c[i] < c[i1]) { bear.push('放量下跌'); str -= 1; }
  }

  let signal, label;
  if (str >= 3) { signal = 'buy'; label = '🟢 买入'; }
  else if (str <= -3) { signal = 'sell'; label = '🔴 卖出'; }
  else { signal = 'hold'; label = '🟡 持有'; }

  return { signal, label, strength: str, reasons: { bull: bull.slice(0, 4), bear: bear.slice(0, 4) }, details: { ma5: ma5[i], ma10: ma10[i], ma20: ma20[i], ma60: ma60[i], macd: { dif: macd.dif[i], dea: macd.dea[i], bar: macd.bar[i] }, kdj: { k: kdj.k[i], d: kdj.d[i], j: kdj.j[i] }, rsi6: rsi6[i], rsi14: rsi14[i] } };
}

/* ===== ECharts ===== */
let myChart = null, chartType = 'kline', cached = [];

function initChart() {
  myChart = echarts.init(document.getElementById('chartBox'), null, { renderer: 'canvas' });
  window.addEventListener('resize', () => myChart && myChart.resize());
}
function switchChart(t) {
  chartType = t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.chart === t));
  renderChart();
}
function renderChart() {
  if (!myChart || !cached.length) return;
  var km = cached, dates = km.map(function(x){return x.date;}), c = km.map(function(x){return x.close;}), h = km.map(function(x){return x.high;}), l = km.map(function(x){return x.low;}), o = km.map(function(x){return x.open;}), v = km.map(function(x){return x.volume;});
  var C0={bg:"rgba(20,25,50,.9)",bd:"rgba(56,189,248,.2)",text:"#e2e8f0",t2:"#8899c0",up:"#f87171",dn:"#34d399"};
  var sd={height:8,bottom:0,borderColor:C0.bd,backgroundColor:"transparent",dataBackground:{lineStyle:{color:C0.t2,width:.5},areaStyle:{color:"rgba(100,120,160,.08)"}},selectedDataBackground:{lineStyle:{color:"#38bdf8",width:1},areaStyle:{color:"rgba(56,189,248,.15)"}},handleStyle:{color:"#38bdf8"},textStyle:{color:C0.t2,fontSize:9}};
  if(chartType==="kline"){
    var m5=TA.ma(c,5),m10=TA.ma(c,10),m20=TA.ma(c,20),m60=TA.ma(c,60);
    myChart.setOption({animation:true,animationDuration:800,animationEasing:"elasticOut",
      tooltip:{trigger:"axis",axisPointer:{type:"cross",label:{backgroundColor:"#1a1e30",color:"#e2e8f0"}},backgroundColor:C0.bg,borderColor:C0.bd,borderWidth:1,textStyle:{color:C0.text,fontSize:12},
        formatter:function(p){if(!p||!p[0])return"";var i=p[0].dataIndex,dp=p[0].data;var op=Array.isArray(dp)?dp[0]:0,cl=Array.isArray(dp)?dp[1]:0,lo=Array.isArray(dp)?dp[2]:0,hi=Array.isArray(dp)?dp[3]:0;var ch=cl-op,pt=op?(ch/op*100).toFixed(2):"0",vl=v[i]||0,dt=dates[i]||"";return"<b style=\"font-size:13px;color:#fbbf24\">"+dt+"</b><br/>\u5f00 "+op.toFixed(2)+" | \u6536 <b style=\"color:"+(ch>=0?C0.up:C0.dn)+"\">"+cl.toFixed(2)+"</b><br/>\u9ad8 "+hi.toFixed(2)+" | \u4f4e "+lo.toFixed(2)+"<br/>\u6da8\u5e45 <b style=\"color:"+(ch>=0?C0.up:C0.dn)+"\">"+(ch>=0?"+":"")+pt+"%</b> | \u91cf "+(vl/10000).toFixed(0)+"\u4e07";}
      },
      grid:[{left:"5%",right:"5%",top:"9%",height:"56%"},{left:"5%",right:"5%",top:"73%",height:"19%"}],
      xAxis:[{type:"category",data:dates,gridIndex:0,axisLine:{lineStyle:{color:C0.bd}},axisLabel:{fontSize:10,color:C0.t2,hideOverlap:true}},{type:"category",data:dates,gridIndex:1,axisLabel:{show:false}}],
      yAxis:[{type:"value",gridIndex:0,scale:true,splitLine:{lineStyle:{color:C0.bd,opacity:.2,type:"dashed"}},axisLabel:{fontSize:11,color:C0.t2}},{type:"value",gridIndex:1,splitLine:{show:false},axisLabel:{fontSize:10,color:C0.t2}}],
      series:[
        {name:"K\u7ebf",type:"candlestick",xAxisIndex:0,yAxisIndex:0,data:km.map(function(x){return[x.open,x.close,x.low,x.high];}),itemStyle:{color:C0.up,color0:C0.dn,borderColor:C0.up,borderColor0:C0.dn,shadowBlur:6,shadowColor:"rgba(0,0,0,.4)"},animationDelay:function(idx){return idx*2;}},
        {name:"MA5",type:"line",xAxisIndex:0,yAxisIndex:0,data:m5,smooth:true,symbol:"none",connectNulls:true,lineStyle:{width:2,color:"#ff9800"},endLabel:{show:true,formatter:"MA5",color:"#ff9800",fontSize:11},animationDelay:function(idx){return idx*2+30;}},
        {name:"MA10",type:"line",xAxisIndex:0,yAxisIndex:0,data:m10,smooth:true,symbol:"none",connectNulls:true,lineStyle:{width:2,color:"#2196f3"},endLabel:{show:true,formatter:"MA10",color:"#2196f3",fontSize:11},animationDelay:function(idx){return idx*2+60;}},
        {name:"MA20",type:"line",xAxisIndex:0,yAxisIndex:0,data:m20,smooth:true,symbol:"none",connectNulls:true,lineStyle:{width:2,color:"#9c27b0"},endLabel:{show:true,formatter:"MA20",color:"#9c27b0",fontSize:11},animationDelay:function(idx){return idx*2+90;}},
        {name:"MA60",type:"line",xAxisIndex:0,yAxisIndex:0,data:m60,smooth:true,symbol:"none",connectNulls:true,lineStyle:{width:1.5,color:"#607d8b"},endLabel:{show:true,formatter:"MA60",color:"#607d8b",fontSize:11},animationDelay:function(idx){return idx*2+120;}},
        {name:"\u91cf",type:"bar",xAxisIndex:1,yAxisIndex:1,data:v.map(function(x,i){return{value:x,itemStyle:{color:c[i]>=o[i]?C0.up:C0.dn,opacity:.4,borderRadius:[2,2,0,0]}};})}
      ],
      legend:{data:["MA5","MA10","MA20","MA60"],top:0,left:"center",textStyle:{fontSize:10,color:C0.t2}},
      dataZoom:[{type:"inside",xAxisIndex:[0,1],start:0,end:100},{type:"slider",xAxisIndex:[0,1],start:0,end:100}]
    },true);
  }else if(chartType==="macd"){
    var md=TA.macd(c);
    myChart.setOption({animation:true,animationDuration:600,animationEasing:"cubicOut",
      tooltip:{trigger:"axis",backgroundColor:C0.bg,borderColor:C0.bd,borderWidth:1,textStyle:{color:C0.text,fontSize:12}},
      grid:{left:"5%",right:"5%",top:"10%",bottom:"10%"},
      xAxis:{type:"category",data:dates,axisLabel:{fontSize:10,color:C0.t2,hideOverlap:true},axisLine:{lineStyle:{color:C0.bd}}},
      yAxis:{type:"value",scale:true,splitLine:{lineStyle:{color:C0.bd,opacity:.2,type:"dashed"}},axisLabel:{fontSize:11,color:C0.t2}},
      series:[
        {name:"DIF",type:"line",data:md.dif,symbol:"none",smooth:true,lineStyle:{color:"#2196f3",width:2.5},areaStyle:{color:"rgba(33,150,243,.06)"}},
        {name:"DEA",type:"line",data:md.dea,symbol:"none",smooth:true,lineStyle:{color:"#ff9800",width:2.5}},
        {name:"MACD",type:"bar",data:md.bar.map(function(v){return{value:v,itemStyle:{color:v>=0?"#f87171":"#34d399",opacity:.7,borderRadius:[3,3,0,0]}};})}
      ],
      legend:{data:["DIF","DEA","MACD"],top:0,left:"center",textStyle:{fontSize:10,color:C0.t2}},
      dataZoom:[{type:"inside",start:0,end:100},{type:"slider",start:0,end:100}]
    },true);
  }else if(chartType==="kdj"){
    var kdj=TA.kdj(h,l,c);
    myChart.setOption({animation:true,animationDuration:600,animationEasing:"cubicOut",
      tooltip:{trigger:"axis",backgroundColor:C0.bg,borderColor:C0.bd,borderWidth:1,textStyle:{color:C0.text,fontSize:12}},
      grid:{left:"5%",right:"5%",top:"10%",bottom:"10%"},
      xAxis:{type:"category",data:dates,axisLabel:{fontSize:10,color:C0.t2,hideOverlap:true},axisLine:{lineStyle:{color:C0.bd}}},
      yAxis:{type:"value",min:0,max:100,splitLine:{lineStyle:{color:C0.bd,opacity:.2,type:"dashed"}},axisLabel:{fontSize:11,color:C0.t2}},
      series:[
        {name:"K",type:"line",data:kdj.k,symbol:"none",smooth:true,lineStyle:{color:"#f87171",width:2.5}},
        {name:"D",type:"line",data:kdj.d,symbol:"none",smooth:true,lineStyle:{color:"#2196f3",width:2.5}},
        {name:"J",type:"line",data:kdj.j,symbol:"none",smooth:true,lineStyle:{color:"#9c27b0",width:1.5,type:"dashed"}},
        {name:"\u8d85\u4e70",type:"line",data:Array(c.length).fill(80),symbol:"none",lineStyle:{color:"#f87171",width:1,type:"dotted"}},
        {name:"\u8d85\u5356",type:"line",data:Array(c.length).fill(20),symbol:"none",lineStyle:{color:"#34d399",width:1,type:"dotted"}}
      ],
      legend:{data:["K","D","J"],top:0,left:"center",textStyle:{fontSize:10,color:C0.t2}},
      dataZoom:[{type:"inside",start:0,end:100},{type:"slider",start:0,end:100}]
    },true);
  }else if(chartType==="rsi"){
    var r6=TA.rsi(c,6),r12=TA.rsi(c,12),r24=TA.rsi(c,24);
    myChart.setOption({animation:true,animationDuration:600,animationEasing:"cubicOut",
      tooltip:{trigger:"axis",backgroundColor:C0.bg,borderColor:C0.bd,borderWidth:1,textStyle:{color:C0.text,fontSize:12}},
      grid:{left:"5%",right:"5%",top:"10%",bottom:"10%"},
      xAxis:{type:"category",data:dates,axisLabel:{fontSize:10,color:C0.t2,hideOverlap:true},axisLine:{lineStyle:{color:C0.bd}}},
      yAxis:{type:"value",min:0,max:100,splitLine:{lineStyle:{color:C0.bd,opacity:.2,type:"dashed"}},axisLabel:{fontSize:11,color:C0.t2}},
      series:[
        {name:"RSI6",type:"line",data:r6,symbol:"none",smooth:true,lineStyle:{color:"#f87171",width:2.5}},
        {name:"RSI12",type:"line",data:r12,symbol:"none",smooth:true,lineStyle:{color:"#ff9800",width:2}},
        {name:"RSI24",type:"line",data:r24,symbol:"none",smooth:true,lineStyle:{color:"#9c27b0",width:1.5,type:"dashed"}},
        {name:"\u8d85\u4e70",type:"line",data:Array(c.length).fill(70),symbol:"none",lineStyle:{color:"#f87171",width:1,type:"dotted"}},
        {name:"\u8d85\u5356",type:"line",data:Array(c.length).fill(30),symbol:"none",lineStyle:{color:"#34d399",width:1,type:"dotted"}}
      ],
      legend:{data:["RSI6","RSI12","RSI24"],top:0,left:"center",textStyle:{fontSize:10,color:C0.t2}},
      dataZoom:[{type:"inside",start:0,end:100},{type:"slider",start:0,end:100}]
    },true);
  }else if(chartType==="timeline"){
    if(!cached.length)return;
    var code=document.getElementById("ovCode")?.textContent||"";
    if(!code)return;
    API.timeline(code).then(function(res){
      var d2=res.data;if(!d2||!d2.lines)return;
      var times=d2.lines.map(function(x){return x.time;}),prices=d2.lines.map(function(x){return x.price;}),vols=d2.lines.map(function(x){return x.volume;});
      var avg=d2.prevClose||prices[0],cols=prices.map(function(p){return p>=avg?"#f87171":"#34d399";});
      myChart.setOption({animation:true,animationDuration:800,animationEasing:"cubicOut",
        tooltip:{trigger:"axis",axisPointer:{type:"cross",label:{backgroundColor:"#1a1e30",color:"#e2e8f0"}},backgroundColor:C0.bg,borderColor:C0.bd,borderWidth:1,textStyle:{color:C0.text,fontSize:12}},
        grid:[{left:"5%",right:"5%",top:"9%",height:"56%"},{left:"5%",right:"5%",top:"73%",height:"19%"}],
        xAxis:[{type:"category",data:times,gridIndex:0,axisLabel:{fontSize:10,color:C0.t2,interval:30},axisLine:{lineStyle:{color:C0.bd}}},{type:"category",data:times,gridIndex:1,axisLabel:{show:false}}],
        yAxis:[{type:"value",gridIndex:0,scale:true,splitLine:{lineStyle:{color:C0.bd,opacity:.2,type:"dashed"}},axisLabel:{fontSize:11,color:C0.t2}},{type:"value",gridIndex:1,splitLine:{show:false},axisLabel:{fontSize:10,color:C0.t2}}],
        series:[
          {name:"\u4ef7\u683c",type:"line",xAxisIndex:0,yAxisIndex:0,data:prices,symbol:"none",smooth:true,lineStyle:{width:2.5,color:"#38bdf8"},areaStyle:{color:{type:"linear",x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:"rgba(56,189,248,.25)"},{offset:1,color:"rgba(56,189,248,.02)"}]}}},
          {name:"\u5747\u4ef7",type:"line",xAxisIndex:0,yAxisIndex:0,data:Array(prices.length).fill(avg),symbol:"none",lineStyle:{width:1,color:"#fbbf24",type:"dashed",opacity:.7}},
          {name:"\u6210\u4ea4\u91cf",type:"bar",xAxisIndex:1,yAxisIndex:1,data:vols.map(function(v,i){return{value:v,itemStyle:{color:cols[i],opacity:.4,borderRadius:[2,2,0,0]}};})}
        ],
        legend:{data:["\u4ef7\u683c","\u5747\u4ef7"],top:0,left:"center",textStyle:{fontSize:10,color:C0.t2}},
        dataZoom:[{type:"inside",xAxisIndex:[0,1],start:0,end:100}]
      },true);
    });
  }
  // apply slider
  try{var oo=myChart.getOption();if(oo.dataZoom&&oo.dataZoom[1]){oo.dataZoom[1]=Object.assign({},sd,oo.dataZoom[1]);myChart.setOption(oo,true);}}catch(e){}
}function showLoading(s) { document.getElementById('loading').classList.toggle('active', s); }
function showError(msg) { const e = document.getElementById('errorBox'); e.textContent = msg || ''; e.classList.toggle('active', !!msg); }
function fmtVol(v) { if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿'; if (v >= 1e4) return (v / 1e4).toFixed(2) + '万'; return v.toFixed(0); }
function fmtAmt(v) { if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿'; if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿'; if (v >= 1e4) return (v / 1e4).toFixed(2) + '万'; return v.toFixed(0); }

const TT = {
  '\u6700\u9ad8':'\u5f53\u5929\u6700\u9ad8\u6210\u4ea4\u4ef7',
  '\u6700\u4f4e':'\u5f53\u5929\u6700\u4f4e\u6210\u4ea4\u4ef7',
  '\u5f00\u76d8':'\u5f53\u5929\u5f00\u76d8\u4ef7',
  '\u6628\u6536':'\u6628\u5929\u6536\u76d8\u4ef7\uff08\u524d\u6536\u76d8\u4ef7\uff09',
  '\u6210\u4ea4\u91cf':'\u5f53\u5929\u6210\u4ea4\u80a1\u7968\u6570\u91cf\uff08\u624b\uff091\u624b=100\u80a1',
  '\u6210\u4ea4\u989d':'\u5f53\u5929\u6210\u4ea4\u603b\u91d1\u989d\uff08\u5143\uff09',
  '\u6da8\u5e45':'=(\u5f53\u524d\u4ef7-\u6628\u6536\u4ef7)/\u6628\u6536\u4ef7x100%',
  '\u6da8\u8dcc':'=\u5f53\u524d\u4ef7-\u6628\u6536\u4ef7',
  '\u6362\u624b\u7387':'=\u6210\u4ea4\u91cf/\u6d41\u901a\u80a1\u672cx100%\uff0c\u53cd\u6620\u6d3b\u8dc3\u5ea6',
  '\u5e02\u76c8\u7387':'=\u80a1\u4ef7/\u6bcf\u80a1\u6536\u76ca\uff0c\u8861\u91cf\u4f30\u503c\u9ad8\u4f4e',
  '\u632f\u5e45':'=(\u6700\u9ad8-\u6700\u4f4e)/\u6628\u6536\u4ef7x100%\uff0c\u53cd\u6620\u4ef7\u683c\u6ce2\u52a8',
  '\u603b\u5e02\u503c':'=\u80a1\u4ef7x\u603b\u80a1\u672c\uff0c\u516c\u53f8\u5e02\u573a\u603b\u4f30\u503c',
  '\u6d41\u901a\u5e02\u503c':'=\u80a1\u4ef7x\u6d41\u901a\u80a1\u672c\uff0c\u53ef\u4e8c\u7ea7\u4ea4\u6613\u90e8\u5206',
  'MA5':'5\u65e5\u6536\u76d8\u4ef7\u5e73\u5747\u503c\uff0c\u53cd\u6620\u77ed\u671f\u8d8b\u52bf\u3002\u80a1\u4ef7\u7ad9\u4e0aMA5\u77ed\u671f\u504f\u5f3a',
  'MA10':'10\u65e5\u6536\u76d8\u4ef7\u5e73\u5747\u503c\uff0c\u914d\u5408MA5\u5224\u65ad\u91d1\u53c9/\u6b7b\u53c9',
  'MA20':'20\u65e5\u6536\u76d8\u4ef7\u5e73\u5747\u503c\uff0c\u4e2d\u671f\u8d8b\u52bf',
  'MA60':'60\u65e5\u6536\u76d8\u4ef7\u5e73\u5747\u503c\uff0c\u4e2d\u957f\u671f\u8d8b\u52bf',
  'DIF':'\u5feb\u7ebf(12\u65e5)-\u6162\u7ebf(26\u65e5)\uff0c\u5dee\u503c\u8d8a\u5927\u591a\u5934\u52a8\u80fd\u8d8a\u5f3a',
  'DEA':'DIF\u76849\u65e5\u5e73\u5747\u7ebf\uff0c\u4e0a\u7a7f=\u91d1\u53c9(\u770b\u591a)\uff0c\u4e0b\u7a7f=\u6b7b\u53c9(\u770b\u7a7a)',
  'BAR':'\u67f1\u72b6\u7ebf=DIF-DEA\u3002\u7ea2\u67f1=\u591a\u5934\u52a8\u80fd\u589e\u5f3a\uff0c\u7eff\u67f1=\u7a7a\u5934\u52a8\u80fd\u589e\u5f3a',
  'KDJ-K':'\u5feb\u901f\u53cd\u5e94\u7ebf\uff0cK<20\u8d85\u5356(\u53ef\u80fd\u53cd\u5f39)\uff0cK>80\u8d85\u4e70(\u53ef\u80fd\u56de\u8c03)',
  'KDJ-D':'\u6162\u901f\u786e\u8ba4\u7ebf\uff0cK\u7a7f\u8d8aD=KDJ\u91d1\u53c9/\u6b7b\u53c9',
  'KDJ-J':'\u6700\u654f\u611f\u7ebf\uff0c\u6781\u7aef\u503c\u610f\u5473\u7740\u53cd\u8f6c',
  'RSI6':'6\u65e5\u76f8\u5bf9\u5f3a\u5f31\uff0c<30\u8d85\u5356(\u770b\u6da8)\uff0c>70\u8d85\u4e70(\u770b\u8dcc)',
  'RSI14':'14\u65e5\u76f8\u5bf9\u5f3a\u5f31\u6307\u6807\uff0c\u901a\u5e38\u4e0eRSI6\u914d\u5408\u4f7f\u7528'
};
function renderOverview(quote) {
  const f = quote.data || {};
  document.getElementById('ovName').textContent = f.name || '--';
  document.getElementById('ovCode').textContent = f.code || '--';
  const isUp = f.changeAmt >= 0;
  const pe = document.getElementById('ovPrice');
  pe.textContent = (f.price || 0).toFixed(2);
  pe.style.color = isUp ? '#e74c3c' : '#27ae60';
  document.getElementById('ovMeta').innerHTML = [
    ['最高', (f.high||0).toFixed(2)], ['最低', (f.low||0).toFixed(2)], ['开盘', (f.open||0).toFixed(2)], ['昨收', (f.prevClose||0).toFixed(2)],
    ['成交量', fmtVol(f.volume||0)+'手'], ['成交额', fmtAmt(f.amount||0)], ['涨幅', (f.changePct>=0?'+':'')+f.changePct.toFixed(2)+'%'], ['涨跌', (f.changeAmt>=0?'+':'')+f.changeAmt.toFixed(2)],
    ['换手率', f.turnover ? f.turnover+'%' : '--'], ['市盈率', f.pe ? f.pe : '--'],
    ['振幅', f.amplitude ? f.amplitude+'%' : '--'],
    ['总市值', f.totalMv ? f.totalMv+'亿' : '--'], ['流通市值', f.circMv ? f.circMv+'亿' : '--'],
  ].map(d => `<div class="ov-meta-item" data-tip="${TT[d[0]]||d[0]}"><div class="l">${d[0]}</div><div class="v">${d[1]}</div></div>`).join('');
  document.getElementById('overview').classList.add('active');
}

function renderAdvice(result) {
  const badge = document.getElementById('adviceBadge');
  badge.textContent = result.label; badge.className = 'badge ' + result.signal;
  document.getElementById('reasonGroup').innerHTML =
    `<div class="reason-card bull"><h4>✅ 看多 (${result.reasons.bull.length})</h4><ul>${result.reasons.bull.length ? result.reasons.bull.map(r => `<li>${r}</li>`).join('') : '<li>暂无</li>'}</ul></div>` +
    `<div class="reason-card bear"><h4>⚠️ 看空 (${result.reasons.bear.length})</h4><ul>${result.reasons.bear.length ? result.reasons.bear.map(r => `<li>${r}</li>`).join('') : '<li>暂无</li>'}</ul></div>`;
  document.getElementById('advice').classList.add('active');
}

function renderDiagnose(result) {
  const d = result.details;
  const str = result.strength || 0;
  // 评分 1-10
  let score = Math.round((str + 10) / 20 * 10);
  score = Math.max(1, Math.min(10, score));
  const scoreColor = score >= 7 ? 'var(--red)' : score >= 4 ? 'var(--hc)' : 'var(--green)';
  const scoreLabel = score >= 7 ? '偏多 📈' : score >= 4 ? '中性 ➡️' : '偏空 📉';

  const lines = [];
  // 均线
  if (d.ma5 !== null && d.ma10 !== null) {
    if (d.ma5 > d.ma10) lines.push('✅ 均线: MA5('+d.ma5.toFixed(0)+') > MA10('+d.ma10.toFixed(0)+')，短期偏多');
    else lines.push('⚠️ 均线: MA5('+d.ma5.toFixed(0)+') < MA10('+d.ma10.toFixed(0)+')，短期偏空');
  }
  // MACD
  if (d.macd?.dif !== undefined && d.macd?.dea !== undefined) {
    if (d.macd.dif > d.macd.dea) lines.push('✅ MACD: DIF('+d.macd.dif.toFixed(2)+') > DEA('+d.macd.dea.toFixed(2)+')，多头动能');
    else lines.push('⚠️ MACD: DIF('+d.macd.dif.toFixed(2)+') < DEA('+d.macd.dea.toFixed(2)+')，空头动能');
  }
  // KDJ
  if (d.kdj?.k !== null) {
    if (d.kdj.k > 80) lines.push('⚠️ KDJ: K值'+d.kdj.k.toFixed(0)+'，处于超买区，注意回调');
    else if (d.kdj.k < 20) lines.push('✅ KDJ: K值'+d.kdj.k.toFixed(0)+'，处于超卖区，可能反弹');
    else lines.push('ℹ️ KDJ: K值'+d.kdj.k.toFixed(0)+'，处于中性区间');
  }
  // RSI
  if (d.rsi6 !== null) {
    if (d.rsi6 > 70) lines.push('⚠️ RSI: RSI6='+d.rsi6.toFixed(0)+'，超买区间');
    else if (d.rsi6 < 30) lines.push('✅ RSI: RSI6='+d.rsi6.toFixed(0)+'，超卖区间');
    else lines.push('ℹ️ RSI: RSI6='+d.rsi6.toFixed(0)+'，中性区间');
  }
  // 建议
  const advice = result.label || '--';

  document.getElementById('diagContent').innerHTML =
    `<div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
      <div style="text-align:center">
        <div style="font-size:32px;font-weight:700;color:${scoreColor}">${score}</div>
        <div style="font-size:11px;color:var(--t2)">/10 评分</div>
      </div>
      <div>
        <div style="font-size:14px;font-weight:600">${scoreLabel}</div>
        <div style="font-size:12px;color:var(--t2);margin-top:2px">${result.reasons.bull.length}个看多 / ${result.reasons.bear.length}个看空</div>
        <div style="margin-top:4px"><span class="badge ${result.signal}" style="font-size:12px">${advice}</span></div>
      </div>
    </div>
    <div style="font-size:12px;line-height:1.8;color:var(--text)">${lines.map(l => {
      if (l.startsWith('✅')) return `<span style="color:var(--red)">✅</span> ${l.slice(2)}`;
      if (l.startsWith('⚠️')) return `<span style="color:var(--green)">⚠️</span> ${l.slice(2)}`;
      return l;
    }).join('<br>')}</div>`;
  document.getElementById('diagnose').style.display = 'block';
}

function renderIndicators(result) {
  const d = result.details, last = cached.length ? cached[cached.length-1].close : 0;
  const items = [
    ['MA5', d.ma5], ['MA10', d.ma10], ['MA20', d.ma20], ['MA60', d.ma60],
    ['DIF', d.macd?.dif], ['DEA', d.macd?.dea], ['BAR', d.macd?.bar],
    ['KDJ-K', d.kdj?.k], ['KDJ-D', d.kdj?.d], ['KDJ-J', d.kdj?.j],
    ['RSI6', d.rsi6], ['RSI14', d.rsi14],
  ];
  document.getElementById('indGrid').innerHTML = items.map(([name, val]) => {
    const v = val !== null && val !== undefined ? (typeof val === 'number' ? val.toFixed(2) : val.toFixed(3)) : '--';
    let sig = 'neutral', lbl = '--';
    if (typeof val === 'number' && name.startsWith('MA')) { sig = val < last ? 'bullish' : 'bearish'; lbl = val < last ? '↑' : '↓'; }
    else if (name === 'BAR') { sig = val > 0 ? 'bullish' : 'bearish'; lbl = val > 0 ? '红' : '绿'; }
    else if (name === 'KDJ-K') { sig = val > 80 ? 'bearish' : val < 20 ? 'bullish' : 'neutral'; lbl = val > 80 ? '超买' : val < 20 ? '超卖' : '--'; }
    else if (name === 'RSI6') { sig = val > 70 ? 'bearish' : val < 30 ? 'bullish' : 'neutral'; lbl = val > 70 ? '超买' : val < 30 ? '超卖' : '--'; }
    return `<div class="ind-card" data-tip="${TT[name]||name}"><div class="ind-name">${name}</div><div class="ind-val">${v}</div><span class="ind-signal ${sig}">${lbl}</span></div>`;
  }).join('');
  document.getElementById('indicators').classList.add('active');
}

/* ===== 加载股票详情 ===== */
async function loadStock(code) {
  showError(null);
  document.getElementById('welcome').style.display = 'none';
  ['overview','advice','chartSection','indicators','diagnose'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active'); el.style.display = 'none'; }
  });
  document.getElementById('searchInput').value = code;
  showLoading(true);
  try {
    const [qr, kr] = await Promise.all([API.quote(code), API.kline(code, 120)]);
    if (!qr?.data?.name) throw new Error('未找到该股票');
    if (!kr?.data?.klines || kr.data.klines.length < 30) throw new Error('K线数据不足');
    cached = kr.data.klines;
    ['overview','advice','diagnose','indicators'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    renderOverview(qr);
    const result = analyzeSignals(cached);
    renderAdvice(result);
    renderDiagnose(result);
    renderIndicators(result);
    const cs = document.getElementById('chartSection');
    cs.style.display = '';
    cs.classList.add('active');
    if (!myChart) initChart();
    setTimeout(() => myChart?.resize(), 50);
    renderChart();
    showLoading(false);
    // 滚动到详情感应区
    document.getElementById('overview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { showLoading(false); showError(e.message); }
}

/* ===== 板块 ===== */
let currentSector = null;

/* ===== 自选股 ===== */
function getWatchlist() {
  try { return JSON.parse(localStorage.getItem('watchlist') || '[]'); } catch { return []; }
}
function saveWatchlist(w) { localStorage.setItem('watchlist', JSON.stringify(w)); }
function toggleWatch(code) {
  let w = getWatchlist();
  if (w.includes(code)) w = w.filter(c => c !== code); else w.push(code);
  saveWatchlist(w);
  // 如果当前显示的是自选板块，刷新
  const active = document.querySelector('.sector-tab.active');
  if (active && active.dataset.idx === '-1') loadWatchlist();
}
function isWatched(code) { return getWatchlist().includes(code); }

let sortBy = 'default';
let filterMinPct = '', filterMaxPct = '', filterMinPrice = '', filterMaxPrice = '';

async function loadSectorHeat() {
  try {
    const res = await API.sectorHeat();
    const list = res.data || [];
    const tabs = document.querySelectorAll('.sect-tab');
    list.forEach(function(s,i){
      var tab = tabs[i]; if(!tab) return;
      var pctEl = tab.querySelector('.st-pct');
      if(pctEl){var isUp=s.avgPct>=0;pctEl.textContent=(isUp?'+':'')+s.avgPct.toFixed(2)+'%';pctEl.style.color=isUp?'var(--red)':'var(--green)';}
    });
  } catch(e){}
}
async function initSectors() {
  try {
    const res = await API.sectors();
    const sectors = res.data || [];
    const navBar = document.getElementById('sectorNav');
    const listBar = document.getElementById('sectorList');
    navBar.innerHTML = `<button class="sector-tab nav-tab" data-idx="-1">⭐ 自选</button><button class="sector-tab nav-tab" data-idx="-2">📊 排行</button><button class="sector-tab nav-tab" data-idx="-5">📋 推荐</button>`;
    // 第1行：大金融(0) 新能源(1) 科技(2)  第2行：消费(3) 医药(4) 周期(5) 军工(6)
    const row1=[0,1,2], row2=[3,4,5,6];
    function renderRow(indices){
      return indices.map(function(i){
        var s=sectors[i],p=s.name.split(/\s+/);
        return '<button class="sector-tab sect-tab" data-idx="'+i+'">'+(p[0]||'')+' '+(p.slice(1).join(' ')||s.name)+' <span class="st-pct"></span></button>';
      }).join('');
    }
    listBar.innerHTML = '<div class="sector-row sector-row-3">'+renderRow(row1)+'</div><div class="sector-row sector-row-4">'+renderRow(row2)+'</div>';
    function secClick(btn){
      document.querySelectorAll('.sector-tab').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      var idx=parseInt(btn.dataset.idx);
      if(idx===-1)loadWatchlist();
      else if(idx===-2)loadRanking();
      else if(idx===-5)loadRecommend();
      else loadSector(idx,sectors);
    }
    navBar.addEventListener('click',function(e){var b=e.target.closest('.sector-tab');if(b)secClick(b);});
    listBar.addEventListener('click',function(e){var b=e.target.closest('.sector-tab');if(b)secClick(b);});
    document.querySelector('[data-idx="-2"]')?.classList.add('active');
    loadRanking();
    showLoading(false);
  } catch (e) { document.getElementById('stockList').innerHTML = '<div class="empty">板块加载失败</div>'; showLoading(false); }
}

async function loadRecommend() {
  const list = document.getElementById('stockList');
  list.innerHTML = '<div class="empty"><div class="spinner"></div><div>⏳ 正在分析全部185只股票，请稍候...</div></div>';
  try {
    const res = await fetch('/api/recommend').then(r => r.json());
    const d = res.data || {};
    const now = d.updated || '';
    function renderGroup(items, title, color) {
      if (!items.length) return '';
      return `<div style="margin-bottom:10px">
        <h4 style="font-size:13px;margin-bottom:6px;color:${color}">${title} (${items.length})</h4>
        <div class="stock-grid">${items.map(q => `<div class="stock-card" onclick="loadStock('${q.code}')">
          <div><span class="s-name">${q.name}</span><span class="s-code">${q.code}</span></div>
          <div class="s-price" style="color:${q.pct>=0?'var(--red)':'var(--green)'}">${q.price.toFixed(2)}<span class="s-chg">${q.pct>=0?'+':''}${q.pct.toFixed(2)}%</span></div>
        </div>`).join('')}</div>`;
    }
    list.innerHTML = (d.buy?.length ? renderGroup(d.buy, '🟢 建议买入', 'var(--red)') : '') +
      (d.sell?.length ? renderGroup(d.sell, '🔴 建议卖出', 'var(--green)') : '') +
      (d.hold?.length ? renderGroup(d.hold, '🟡 建议持有', 'var(--hc)') : '') +
      `<div style="font-size:11px;color:var(--t3);margin-top:8px">更新于 ${now} · 基于技术指标自动分析</div>`;
  } catch { list.innerHTML = '<div class="empty">加载失败</div>'; }
}

async function loadRanking() {
  const list = document.getElementById('stockList');
  list.innerHTML = '<div class="empty">加载中...</div>';
  try {
    const res = await fetch('/api/ranking').then(r => r.json());
    const d = res.data || {};
    const gainers = d.gainers || [];
    const losers = d.losers || [];
    function renderRank(items, title, cls) {
      if (!items.length) return '<div class="empty">暂无数据</div>';
      return `<div style="margin-bottom:10px"><h4 style="font-size:13px;margin-bottom:6px">${title}</h4>
        <div class="stock-grid">${items.map(q => {
          const isUp = q.changeAmt >= 0;
          return `<div class="stock-card" onclick="loadStock('${q.code}')">
            <div><span class="s-name">${q.name}</span><span class="s-code">${q.code}</span></div>
            <div class="s-price" style="color:${isUp ? 'var(--red)' : 'var(--green)'}">${q.price.toFixed(2)}<span class="s-chg ${isUp ? 'up' : 'down'}">${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%</span></div>
          </div>`;
        }).join('')}</div>`;
    }
    list.innerHTML = renderRank(gainers, '🚀 涨幅榜', 'up') + renderRank(losers, '📉 跌幅榜', 'down');
  } catch { list.innerHTML = '<div class="empty">加载失败</div>'; }
}



async function loadWatchlist() {
  const codes = getWatchlist();
  const list = document.getElementById('stockList');
  if (!codes.length) { list.innerHTML = '<div class="empty">⭐ 点击股票上的☆收藏</div>'; return; }
  list.innerHTML = '<div class="empty">加载中...</div>';
  try {
    const res = await API.sectorQuotes(codes);
    renderStockList(res.data || [], codes);
  } catch { list.innerHTML = '<div class="empty">加载失败</div>'; }
}

async function loadSector(idx, sectors) {
  if (!sectors) { try { const r = await API.sectors(); sectors = r.data || []; } catch { return; } }
  const sector = sectors[idx];
  if (!sector) return;
  currentSector = sector;
  const list = document.getElementById('stockList');
  list.innerHTML = '<div class="empty">加载中...</div>';
  try {
    const codes = sector.stocks.map(s => s.code);
    const res = await API.sectorQuotes(codes);
    renderStockList(res.data || [], codes);
  } catch { list.innerHTML = '<div class="empty">数据加载失败</div>'; }
}

function applyFilter(items) {
  return items.filter(q => {
    if (filterMinPct && q.changePct < parseFloat(filterMinPct)) return false;
    if (filterMaxPct && q.changePct > parseFloat(filterMaxPct)) return false;
    if (filterMinPrice && q.price < parseFloat(filterMinPrice)) return false;
    if (filterMaxPrice && q.price > parseFloat(filterMaxPrice)) return false;
    return true;
  });
}

function renderStockList(quotes, codes) {
  const map = {}; quotes.forEach(q => map[q.code] = q);
  let items = codes.map(code => map[code]).filter(Boolean);
  // 排序
  if (sortBy === 'pctUp') items.sort((a, b) => b.changePct - a.changePct);
  else if (sortBy === 'pctDown') items.sort((a, b) => a.changePct - b.changePct);
  else if (sortBy === 'priceUp') items.sort((a, b) => b.price - a.price);
  else if (sortBy === 'priceDown') items.sort((a, b) => a.price - b.price);
  const filtered = applyFilter(items);
  const w = getWatchlist();
  document.getElementById('stockList').innerHTML =
    `<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap;align-items:center">
      <button class="sort-btn ${sortBy==='default'?'active':''}" onclick="setSort('default')">默认</button>
      <button class="sort-btn ${sortBy==='pctUp'?'active':''}" onclick="setSort('pctUp')">涨幅↓</button>
      <button class="sort-btn ${sortBy==='pctDown'?'active':''}" onclick="setSort('pctDown')">跌幅↓</button>
      <button class="sort-btn ${sortBy==='priceUp'?'active':''}" onclick="setSort('priceUp')">价高↓</button>
      <button class="sort-btn ${sortBy==='priceDown'?'active':''}" onclick="setSort('priceDown')">价低↓</button>
      <span style="flex:1"></span>
      <button class="sort-btn" onclick="toggleFilter()">🎯 筛选</button>
    </div>
    <div id="filterBar" style="display:none;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center;padding:8px;border:1px solid var(--bd);border-radius:8px;background:var(--bg)">
      <input id="fMinPct" placeholder="涨幅≥" style="width:70px;padding:4px 8px;border:1px solid var(--bd);border-radius:4px;font-size:11px;background:var(--card);color:var(--text)">%
      <span style="color:var(--t2);font-size:11px">~</span>
      <input id="fMaxPct" placeholder="涨幅≤" style="width:70px;padding:4px 8px;border:1px solid var(--bd);border-radius:4px;font-size:11px;background:var(--card);color:var(--text)">%
      <input id="fMinPrice" placeholder="价≥" style="width:70px;padding:4px 8px;border:1px solid var(--bd);border-radius:4px;font-size:11px;background:var(--card);color:var(--text)">
      <span style="color:var(--t2);font-size:11px">~</span>
      <input id="fMaxPrice" placeholder="价≤" style="width:70px;padding:4px 8px;border:1px solid var(--bd);border-radius:4px;font-size:11px;background:var(--card);color:var(--text)">
      <button class="sort-btn active" onclick="doFilter()">筛选</button>
      <button class="sort-btn" onclick="resetFilter()">重置</button>
    </div>
    ${filtered.length < items.length ? `<div style="font-size:11px;color:var(--t2);margin-bottom:6px">筛选结果: ${filtered.length}/${items.length} 只</div>` : ''}
    <div class="stock-grid">${filtered.map(q => {
      const isUp = q.changeAmt >= 0;
      const star = w.includes(q.code) ? '★' : '☆';
      return `<div class="stock-card">
        <div style="display:flex;justify-content:space-between;align-items:center" onclick="loadStock('${q.code}')">
          <div><span class="s-name">${q.name}</span><span class="s-code">${q.code}</span></div>
          <span style="cursor:pointer;font-size:14px;color:${w.includes(q.code)?'#fbbf24':'var(--t3)'}" onclick="event.stopPropagation();toggleWatch('${q.code}');this.textContent=isWatched('${q.code}')?'★':'☆';this.style.color=isWatched('${q.code}')?'#fbbf24':'var(--t3)'">${star}</span>
        </div>
        <div class="s-price" style="color:${isUp ? 'var(--red)' : 'var(--green)'}" onclick="loadStock('${q.code}')">${q.price.toFixed(2)}<span class="s-chg ${isUp ? 'up' : 'down'}">${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%</span></div>
      </div>`;
    }).join('')}</div>`;
}

let filterVisible = false;
function toggleFilter() {
  filterVisible = !filterVisible;
  document.getElementById('filterBar').style.display = filterVisible ? 'flex' : 'none';
}
function doFilter() {
  filterMinPct = document.getElementById('fMinPct').value;
  filterMaxPct = document.getElementById('fMaxPct').value;
  filterMinPrice = document.getElementById('fMinPrice').value;
  filterMaxPrice = document.getElementById('fMaxPrice').value;
  const btn = document.querySelector('.sector-tab.active');
  if (btn) btn.click();
}
function resetFilter() {
  filterMinPct = filterMaxPct = filterMinPrice = filterMaxPrice = '';
  document.getElementById('fMinPct').value = '';
  document.getElementById('fMaxPct').value = '';
  document.getElementById('fMinPrice').value = '';
  document.getElementById('fMaxPrice').value = '';
  filterVisible = false;
  document.getElementById('filterBar').style.display = 'none';
  const btn = document.querySelector('.sector-tab.active');
  if (btn) btn.click();
}

function setSort(type) {
  sortBy = type;
  const btn = document.querySelector('.sector-tab.active');
  if (btn) btn.click();
}

/* ===== 搜索 ===== */
const searchInput = document.getElementById('searchInput');
let searchTimer;
searchInput.addEventListener('input', function() {
  clearTimeout(searchTimer);
  const v = this.value.trim();
  if (v.length < 1) { document.getElementById('suggestions').classList.remove('active'); return; }
  if (/^\d{6}$/.test(v)) return;
  searchTimer = setTimeout(async () => {
    try {
      const data = await API.search(v);
      const items = data.Data || [];
      const el = document.getElementById('suggestions');
      if (!items.length) { el.classList.remove('active'); return; }
      el.innerHTML = items.slice(0, 6).map(item => {
        const c = item.Code || '', n = item.Name || '';
        const tag = item.SecurityTypeName || '';
        return `<div class="item" onclick="loadStock('${c}')"><div><span class="name">${n}</span> <span class="code">${c}</span></div></div>`;
      }).join('');
      el.classList.add('active');
    } catch(e) {}
  }, 300);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (/^\d{6}$/.test(v)) loadStock(v);
    else {
      (async () => {
        try { const d = await API.search(v); if (d.Data?.length) loadStock(d.Data[0].Code); } catch(e) {}
      })();
    }
  }
});
document.addEventListener('click', e => { if (!e.target.closest('.search-box')) document.getElementById('suggestions').classList.remove('active'); });
document.getElementById('searchBtn').addEventListener('click', () => {
  const v = searchInput.value.trim();
  if (!v) return;
  if (/^\d{6}$/.test(v)) loadStock(v);
  else { (async () => { try { const d = await API.search(v); if (d.Data?.length) loadStock(d.Data[0].Code); } catch(e) {} })(); }
});

/* ===== 新闻 ===== */
async function loadNews() {
  try {
    const res = await API.news();
    const list = res.data || [];
    document.getElementById('newsList').innerHTML = list.length
      ? list.map(n => `<a class="news-item" href="${n.url || '#'}" target="_blank">${n.title}<span class="n-time">${(n.time || '').slice(0, 10)}</span></a>`).join('')
      : '<div class="empty">暂无新闻</div>';
  } catch (e) { document.getElementById('newsList').innerHTML = '<div class="empty">新闻加载失败</div>'; }
}

/* ===== 导出图片 ===== */
async function exportPNG(btn) {
  if (btn) btn.textContent = '⏳';
  try {
    const el = document.querySelector('.overview')?.parentElement;
    if (!el) return;
    const canvas = await html2canvas(el, { useCORS: true, backgroundColor: '#fff', scale: 2 });
    const link = document.createElement('a');
    link.download = 'stock-analysis.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch(e) { console.error(e); }
  if (btn) setTimeout(() => btn.textContent = '📸', 1000);
}

/* ===== 教程切换 ===== */
document.getElementById('guideBtn')?.addEventListener('click', () => {
  document.getElementById('guidePanel')?.classList.toggle('active');
});

/* ===== 主题切换 ===== */
(function initTheme() {
  const themes = ['light', 'dark', 'colorful'];
  const icons = { light: '☀️', dark: '🌙', colorful: '✨' };
  let current = localStorage.getItem('stock-theme') || 'light';
  document.documentElement.setAttribute('data-theme', current);
  const btn = document.getElementById('themeBtn');
  if (btn) {
    btn.textContent = icons[current] || '🌙';
    btn.addEventListener('click', () => {
      const idx = themes.indexOf(current);
      current = themes[(idx + 1) % themes.length];
      document.documentElement.setAttribute('data-theme', current);
      localStorage.setItem('stock-theme', current);
      btn.textContent = icons[current];
      // 通知 ECharts 重绘
      setTimeout(() => { if (myChart) myChart.resize(); }, 100);
    });
  }
})();

/* ===== 启动 ===== */
var tooltipEl = null;
function initTooltip() {
  if (!tooltipEl) { tooltipEl = document.createElement('div'); tooltipEl.className = 'tooltip-box'; document.body.appendChild(tooltipEl); }
  document.addEventListener('mouseover', function(e) {
    var target = e.target.closest('[data-tip]');
    if (!target) { if (tooltipEl) tooltipEl.classList.remove('show'); return; }
    tooltipEl.textContent = target.getAttribute('data-tip');
    tooltipEl.classList.add('show');
  });
  document.addEventListener('mousemove', function(e) {
    if (!tooltipEl || !tooltipEl.classList.contains('show')) return;
    var x = e.clientX + 14, y = e.clientY + 14;
    if (x + tooltipEl.offsetWidth > window.innerWidth - 10) x = e.clientX - tooltipEl.offsetWidth - 14;
    if (y + tooltipEl.offsetHeight > window.innerHeight - 10) y = e.clientY - tooltipEl.offsetHeight - 14;
    tooltipEl.style.left = x + 'px'; tooltipEl.style.top = y + 'px';
  });
  document.addEventListener('mouseout', function(e) {
    if (e.target.closest('[data-tip]') && tooltipEl) tooltipEl.classList.remove('show');
  });
}
document.addEventListener('DOMContentLoaded', function() {
  initTooltip();
  loadNews();
  initSectors();
  loadSectorHeat();
});
