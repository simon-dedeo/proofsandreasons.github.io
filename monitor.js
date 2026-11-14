/* monitor.js -- everything the three host-monitor pages (akdeniz.html,
   wright.html, ganesha.html) have in common: number and time formatting, the
   line-chart renderer, the 1 h / 24 h / 30 d history windows, the health rows
   built from metrics.json, polling, the masonry layout, and the visitors and
   server-room panels. Each page keeps only its own cards and its render().

   Plain globals on purpose: the pages are static files with no build step. */

// ---------- formatting ----------
function fmtBytes(b){
  if(b===null||b===undefined||isNaN(b)) return "—";
  var u=["B","KB","MB","GB","TB","PB"], i=0; b=Math.abs(b);
  while(b>=1024 && i<u.length-1){ b/=1024; i++; }
  return (b>=100?b.toFixed(0):b>=10?b.toFixed(1):b.toFixed(2))+" "+u[i];
}
function fmtBytesPs(b){ return b===null||b===undefined||isNaN(b) ? "—" : fmtBytes(b)+"/s"; }
function fmtBps(b){
  if(b===null||b===undefined||isNaN(b)) return "—";
  var bits=b*8, u=["bit","Kb","Mb","Gb"], i=0;
  while(bits>=1000 && i<u.length-1){ bits/=1000; i++; }
  return (bits>=100?bits.toFixed(0):bits>=10?bits.toFixed(1):bits.toFixed(2))+" "+u[i]+"/s";
}
function fmtDur(s){
  if(s===null||s===undefined) return "—";
  var d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60);
  return d>0 ? d+"d "+h+"h" : h>0 ? h+"h "+m+"m" : m+"m";
}
function fmtW(v){ return v===null||v===undefined||isNaN(v) ? "—" : v.toFixed(0)+" W"; }
function fmtN(v){ return v===null||v===undefined||isNaN(v) ? "—" : Math.round(v).toLocaleString(); }
function fmtAge(s){ return s<90 ? s+"s" : fmtDur(s); }
var DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function clock(ts){
  var d=new Date(ts*1000);
  return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}
// A day-long axis crosses midnight, so bare HH:MM is ambiguous there; a
// month-long one needs the date.
function dayclock(ts){ return DAYS[new Date(ts*1000).getDay()]+" "+clock(ts); }
function daymonth(ts){ var d=new Date(ts*1000); return d.getDate()+" "+MONTHS[d.getMonth()]; }
function dateclock(ts){ return daymonth(ts)+" "+clock(ts); }
function ago(ts){ return ts ? fmtAge(Math.max(0,Math.round(Date.now()/1000-ts)))+" ago" : "—"; }
function txt(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; }
// Place names come from a third-party geolocation database and process names
// from whoever runs them: nothing here is trusted to be free of markup.
function esc(s){
  return String(s===null||s===undefined?"":s).replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; });
}
// ISO 3166-1 alpha-2 -> regional indicator pair, which renders as a flag.
function flag(cc){
  if(!cc || !/^[A-Za-z]{2}$/.test(cc)) return "";
  var a=cc.toUpperCase();
  return String.fromCodePoint(0x1F1E6+a.charCodeAt(0)-65, 0x1F1E6+a.charCodeAt(1)-65);
}
function heat(pct){ return pct>=90?"var(--bad)":pct>=75?"var(--warn)":"var(--s1)"; }
// Sensors report Celsius; the pages show Fahrenheit. Thresholds stay in °C.
function F(c){ return c*9/5+32; }
// A temperature (or, with a unit, any number) as a pill coloured by thresholds.
function pill(v, warn, bad, unit){
  if(v===null||v===undefined) return "<span class='pill'>—</span>";
  var cls=v>=bad?"bad":v>=warn?"warn":"ok";
  return "<span class='pill "+cls+"'>"+(unit?v.toFixed(0)+unit:F(v).toFixed(0)+"°F")+"</span>";
}
// A status pill: cls is "ok", "warn", "bad" or "" (neutral).
function spill(cls, text){ return "<span class='pill "+cls+"'>"+esc(text)+"</span>"; }

// ---------- charts ----------
// Chart series: the akdeniz palette, snapped into the dark-mode OKLCH band.
var S1="#c58200", S2="#108bbb", S3="#24a25f";
// One shared line-chart renderer. Series share a single y-axis by
// construction -- there is deliberately no second scale.
function lineChart(wrapId, series, fmt, axisMax){
  var wrap=document.getElementById(wrapId);
  var svg=wrap.querySelector("svg"), tip=wrap.querySelector(".tip");
  var W=600,H=96,PL=4,PR=4,PT=8,PB=14;
  while(svg.firstChild) svg.removeChild(svg.firstChild);

  var pts=series[0].data.length;
  if(pts<2){ return; }
  var all=[]; series.forEach(function(s){ s.data.forEach(function(v){ if(v!==null&&!isNaN(v)) all.push(v); }); });
  if(!all.length) return;
  var max=Math.max.apply(null,all), min=0;
  if(max<=0) max=1;
  // axisMax pins the scale for bounded quantities (a percentage tops out at
  // 100); otherwise leave a little headroom above the observed peak.
  max = axisMax ? axisMax : max*1.12;

  var X=function(i){ return PL+(W-PL-PR)*(i/(pts-1)); };
  var Y=function(v){ return PT+(H-PT-PB)*(1-(v-min)/(max-min)); };
  var NS="http://www.w3.org/2000/svg";
  function el(n,a){ var e=document.createElementNS(NS,n); for(var k in a) e.setAttribute(k,a[k]); return e; }

  // recessive gridlines
  var g=el("g",{"class":"grid"});
  [0,.5,1].forEach(function(f){
    var y=PT+(H-PT-PB)*f;
    g.appendChild(el("line",{x1:PL,x2:W-PR,y1:y,y2:y}));
  });
  svg.appendChild(g);
  var lab=el("text",{x:PL+2,y:PT+8,"class":"ax"}); lab.textContent=fmt(max); svg.appendChild(lab);

  series.forEach(function(s){
    var d="",open=false;
    s.data.forEach(function(v,i){
      if(v===null||isNaN(v)){ open=false; return; }
      d += (open?" L":" M")+X(i).toFixed(1)+" "+Y(v).toFixed(1); open=true;
    });
    var attrs={d:d.trim(),"class":"series",stroke:s.color};
    if(s.dash){ attrs["stroke-dasharray"]="4 3"; attrs["stroke-opacity"]=".55"; }
    svg.appendChild(el("path",attrs));
  });

  // time axis ends
  var t0=el("text",{x:PL,y:H-2,"class":"ax"}); t0.textContent=series[0].labels[0];
  var t1=el("text",{x:W-PR,y:H-2,"class":"ax","text-anchor":"end"});
  t1.textContent=series[0].labels[series[0].labels.length-1];
  svg.appendChild(t0); svg.appendChild(t1);

  // hover layer: crosshair + per-series markers + tooltip
  var cross=el("line",{"class":"cross",y1:PT,y2:H-PB}); svg.appendChild(cross);
  var marks=el("g",{"class":"mk"});
  series.forEach(function(s){ marks.appendChild(el("circle",{fill:s.color,cx:0,cy:0})); });
  svg.appendChild(marks);

  var hit=el("rect",{x:0,y:0,width:W,height:H,fill:"transparent",style:"cursor:crosshair"});
  svg.appendChild(hit);

  function move(ev){
    var r=svg.getBoundingClientRect();
    var cx=(ev.touches?ev.touches[0].clientX:ev.clientX)-r.left;
    var i=Math.round((cx/r.width*W-PL)/((W-PL-PR)/(pts-1)));
    i=Math.max(0,Math.min(pts-1,i));
    cross.setAttribute("x1",X(i)); cross.setAttribute("x2",X(i));
    cross.style.display="block"; marks.style.display="block";
    var rows="<div class='tt'>"+series[0].labels[i]+"</div>";
    series.forEach(function(s,k){
      var v=s.data[i], c=marks.childNodes[k];
      if(v===null||isNaN(v)){ c.setAttribute("cy",-99); }
      else { c.setAttribute("cx",X(i)); c.setAttribute("cy",Y(v)); }
      rows+="<div class='tr'><span class='sw' style='background:"+s.color+"'></span>"+
            s.name+"<span class='tv'>"+(v===null||isNaN(v)?"—":fmt(v))+"</span></div>";
    });
    tip.innerHTML=rows; tip.style.display="block";
    var tw=tip.offsetWidth, px=cx-tw/2;
    px=Math.max(0,Math.min(r.width-tw,px));
    tip.style.left=px+"px"; tip.style.top="0px";
  }
  function leave(){ cross.style.display="none"; marks.style.display="none"; tip.style.display="none"; }
  hit.addEventListener("mousemove",move);
  hit.addEventListener("mouseleave",leave);
  hit.addEventListener("touchmove",function(e){ move(e); e.preventDefault(); },{passive:false});
  hit.addEventListener("touchend",leave);
}

// ---------- chart windows ----------
// Three histories arrive in one payload: `history` is every sample of the
// last hour, `history_24h` is 5-minute means for the last day, `history_30d`
// is hourly means for the last month (sent as column names plus rows, to keep
// 720 rows small). windowFor() flattens whichever one is asked for into
// {times, labels, <series>, <series>Max, ...}: one array per series the
// collector carries, so a page never lists them.
function historyRows(d, r){
  if(r==="30d"){
    var h=d.history_30d;
    return h ? {step:h.bucket_s||3600, span:30*86400, rows:h.rows.map(function(v){
      var o={}; h.cols.forEach(function(c,i){ o[c]=v[i]; }); return o; })} : null;
  }
  if(r==="24h") return {step:d.bucket_s||300, span:86400, rows:d.history_24h||[]};
  return {step:0, rows:d.history||[]};
}
function windowFor(d, r){
  var src=historyRows(d, r);
  if(!src || src.rows.length<2) return null;
  var rows=src.rows, seen={}, w={kind:r, times:[]};
  rows.forEach(function(x){ for(var k in x) if(k!=="t") seen[k]=1; });
  var keys=Object.keys(seen);                      // "cpu", "cpu_max", "rx", ...
  function name(k){ return k.replace(/_max$/,"Max"); }
  function push(t, x){
    w.times.push(t);
    keys.forEach(function(k){ var v=x?x[k]:null; w[name(k)].push(v===undefined?null:v); });
  }
  keys.forEach(function(k){ w[name(k)]=[]; });
  if(src.step){
    // Bucketed histories are laid on a regular grid, so a stretch the
    // collector was down for reads as a break in the line. The left edge is
    // clamped to the oldest bucket there is: a monitor two hours old draws
    // two hours, not 22 hours of emptiness.
    var byT={}; rows.forEach(function(b){ byT[b.t]=b; });
    var end=rows[rows.length-1].t, start=Math.max(rows[0].t, end-src.span+src.step);
    for(var t=start;t<=end;t+=src.step) push(t, byT[t]||null);
    w.span=end-start+src.step;
  } else {
    rows.forEach(function(x){ push(x.t, x); });
    w.span=w.times[w.times.length-1]-w.times[0];
  }
  w.step=src.step||d.interval_s||30;
  w.stamp= r==="30d" ? dateclock : r==="24h" ? dayclock : clock;
  w.labels=w.times.map(w.stamp);
  w.peak= r==="30d" ? "hourly peak" : "5-min peak";
  // A series with fewer than two points (one that started being recorded
  // after this window opened) is reported as absent rather than drawn.
  keys.forEach(function(k){
    if(w[name(k)].filter(function(v){ return v!==null; }).length<2) w[name(k)]=null;
  });
  return w;
}
// Series added after the others open with a stretch of nulls; drop that
// lead-in so the chart does not start with dead space. Gaps *inside* the
// series are left alone, since those are real outages.
function trimLead(w, keys){
  var f=0, n=w.times.length;
  while(f<n && keys.every(function(k){ return !w[k] || w[k][f]===null; })) f++;
  if(!f) return w;
  var out={};
  for(var p in w) out[p]=Array.isArray(w[p]) ? w[p].slice(f) : w[p];
  out.span=out.times.length ? out.times[out.times.length-1]-out.times[0]+w.step : 0;
  return out;
}
function spanText(s){
  if(s>=129600) return "last "+Math.round(s/86400)+" days";
  if(s>=82800) return "last 24 hours";
  if(s>=3400 && s<=3700) return "last hour";
  return "last "+fmtDur(s);
}
function stats(vals){
  var v=(vals||[]).filter(function(x){ return x!==null && !isNaN(x); });
  if(!v.length) return null;
  return {avg:v.reduce(function(a,b){return a+b;},0)/v.length, max:Math.max.apply(null,v)};
}
function pctFmt(v){ return v.toFixed(0)+"%"; }
// Newest-first rows for a chart's table view (the accessible fallback).
function tableRows(w, keys, fmt){
  return w.times.map(function(t,i){ return {t:t,i:i}; }).reverse()
    .filter(function(r){ return keys.some(function(k){ return w[k]&&w[k][r.i]!==null; }); })
    .slice(0,40).map(function(r){
      return "<tr><td>"+w.stamp(r.t)+"</td>"+keys.map(function(k){
        var v=w[k]?w[k][r.i]:null; return "<td>"+(v===null?"—":fmt(v))+"</td>"; }).join("")+"</tr>";
    }).join("");
}

// CPU, GPU and memory are the same picture: a percentage line, a dashed
// within-bucket peak wherever the history carries one, a stat line and a
// table view. Only the ids, labels and which series to read differ.
function drawPercentSeries(o){
  var w=o.win, key=o.key, maxKey=key+"Max";
  if(w && w[key]) w=trimLead(w, [key]);
  var keys="", stat="";
  if(w && w[key] && w[key].length>1){
    var series=[{name:o.col,color:S1,data:w[key],labels:w.labels}], cols=[key];
    keys="<span><i style='background:var(--s1)'></i>"+o.legend+" &mdash; "+spanText(w.span)+"</span>";
    if(w[maxKey]){
      series.push({name:"Peak",color:S1,dash:true,data:w[maxKey],labels:w.labels});
      keys+="<span><i class='dash' style='color:var(--s1)'></i>"+w.peak+"</span>";
      cols.push(maxKey);
    }
    lineChart(o.chart, series, pctFmt, 100);
    document.querySelector("#"+o.chart+" svg").setAttribute("aria-label", o.legend+", "+spanText(w.span));
    var s=stats(w[key]), pk=stats(w[maxKey]||w[key]);
    // A peak of 100 should read "100%", one of 4.7 should not read "5%".
    if(s) stat="avg "+s.avg.toFixed(1)+"% · peak "+pk.max.toFixed(pk.max>=10?0:1)+"%";
    if(o.head) txt(o.head, o.legend+" · "+spanText(w.span));
    document.getElementById(o.tblcap).innerHTML="Table view &mdash; "+o.tblName+", "+spanText(w.span);
    document.getElementById(o.tbl).innerHTML=
      "<thead><tr><th>Time</th><th>"+o.col+"</th>"+(w[maxKey]?"<th>Peak</th>":"")+"</tr></thead><tbody>"+
      tableRows(w, cols, function(v){ return v.toFixed(1)+"%"; })+"</tbody>";
  } else {
    document.getElementById(o.tbl).innerHTML="<tbody><tr><td>No "+o.tblName+" history yet.</td></tr></tbody>";
  }
  document.getElementById(o.keys).innerHTML=keys;
  txt(o.stat, stat);
}
// Memory's chart lives in a popover and is always the day view: the card
// already shows the live number, so only the longer history is interesting.
function drawMemory(d){
  drawPercentSeries({win:windowFor(d, (d.history_24h||[]).length>=2?"24h":"1h"), key:"mem",
    chart:"memchart", keys:"memkeys", stat:"memstat", tbl:"memtable", tblcap:"memtblcap", head:"mempoph",
    legend:"RAM used", tblName:"memory", col:"Used"});
}
function drawNet(w){
  var stat="";
  if(w && w.rx && w.tx){
    lineChart("netchart",[
      {name:"Inbound", color:S2, data:w.rx, labels:w.labels},
      {name:"Outbound",color:S3, data:w.tx, labels:w.labels}
    ], fmtBps);
    document.querySelector("#netchart svg").setAttribute("aria-label","Network throughput, "+spanText(w.span));
    var rs=stats(w.rx), ts=stats(w.tx);
    stat=spanText(w.span)+(rs&&ts ? " · avg "+fmtBps(rs.avg)+" in / "+fmtBps(ts.avg)+" out" : "");
    document.getElementById("nettblcap").innerHTML="Table view &mdash; network, "+spanText(w.span);
    document.getElementById("nettbl").innerHTML=tableRows(w, ["rx","tx"], fmtBps);
  }
  txt("netstat", stat);
}

// ---------- range buttons ----------
// `range` maps a chart to the history it shows ({cpu:"24h", net:"1h", ...});
// each chart's segmented control has the id "<chart>range" and one button per
// history. syncRanges() greys out histories the payload does not carry (and
// falls back to the hour for a chart that was showing one); wireRanges()
// makes the buttons work. Charts named in `own` bring their own data rather
// than the three shared histories, so their buttons are never disabled.
function syncRanges(range, d, own){
  var have={"1h":true, "24h":(d.history_24h||[]).length>=2,
            "30d":!!(d.history_30d && d.history_30d.rows.length>=2)};
  Object.keys(range).forEach(function(k){
    var free=(own||[]).indexOf(k)>=0;
    if(!free && !have[range[k]]) range[k]="1h";
    [].forEach.call(document.querySelectorAll("#"+k+"range button"), function(b){
      var ok=free||have[b.dataset.range];
      b.setAttribute("aria-pressed", b.dataset.range===range[k] ? "true" : "false");
      b.disabled=!ok;
      b.title=ok?"":"This history is not published yet";
      b.style.opacity=ok?"":".4";
    });
  });
}
function wireRanges(range, redraw){
  Object.keys(range).forEach(function(k){
    document.getElementById(k+"range").addEventListener("click", function(ev){
      var b=ev.target.closest("button");
      if(!b || b.disabled) return;
      range[k]=b.dataset.range;
      redraw();
    });
  });
}
// The memory popover. Hover to peek, click (or focus) to pin. The short close
// delay is what lets the pointer travel from the button into the popover to
// use the chart's own crosshair without the panel vanishing on the way.
function wireMemPeek(){
  var btn=document.getElementById("mempeek"), pop=document.getElementById("mempop");
  var pinned=false, timer=null;
  function open(){ clearTimeout(timer); pop.hidden=false; btn.setAttribute("aria-expanded","true"); }
  function close(){ clearTimeout(timer); pop.hidden=true; btn.setAttribute("aria-expanded","false"); }
  function closeSoon(){ if(pinned) return; clearTimeout(timer); timer=setTimeout(close,180); }
  btn.addEventListener("mouseenter",open);
  btn.addEventListener("mouseleave",closeSoon);
  btn.addEventListener("focus",open);
  btn.addEventListener("blur",closeSoon);
  pop.addEventListener("mouseenter",function(){ clearTimeout(timer); });
  pop.addEventListener("mouseleave",closeSoon);
  btn.addEventListener("click",function(){ pinned=!pinned; if(pinned) open(); else close(); });
  document.addEventListener("keydown",function(e){ if(e.key==="Escape" && !pop.hidden){ pinned=false; close(); } });
  document.addEventListener("click",function(e){
    if(pinned && !pop.contains(e.target) && !btn.contains(e.target)){ pinned=false; close(); }
  });
}

// ---------- host health ----------
// Rows built from the os / events / psi blocks of metrics.json and the
// per-disk SMART records. Each helper returns "" when its block is absent.
function hxU(text){ return " <span class='u'>"+esc(text)+"</span>"; }
// A label / value row whose value may wrap; `title` is the hover text and may
// run to several lines.
function hxRow(k, v, title){
  return "<div class='row hx'"+(title?" title=\""+esc(title)+"\"":"")+"><span class='k'>"+k+
    "</span><span class='v wrap'>"+v+"</span></div>";
}
// Hover text for a list of events: one line each, newest first, in the words
// of whatever logged them ({t, msg}).
function hxLines(head, list, total){
  var lines=(list||[]).map(function(e){ return dateclock(e.t)+"  "+(e.msg||e.comm||""); });
  if(lines.length && total>lines.length) lines.push("… and "+(total-lines.length)+" earlier");
  return [head].concat(lines).join("\n");
}
// Kernel, boot date and pending updates (Ubuntu hosts: metrics.os).
function hxOsRows(d){
  var o=d.os; if(!o) return "";
  var rows=hxRow("Kernel", esc(o.kernel||"—")+(o.reboot_required?" "+spill("warn","reboot needed"):"")+
      (o.kernel_newest?hxU(o.kernel_newest.replace(/-generic$/,"")+" installed"):""),
    o.reboot_required?(o.reboot_pkgs+" packages are waiting for a restart"):"");
  rows+=hxRow("Up since", esc(daymonth(o.boot_ts))+hxU(fmtDur(d.uptime_s)));
  if(o.updates!==null&&o.updates!==undefined)
    rows+=hxRow("Updates pending",
      (o.updates?spill(o.security?"warn":"", o.updates.toLocaleString()+" package"+(o.updates===1?"":"s")):spill("ok","up to date"))+
      (o.security?hxU(o.security.toLocaleString()+" security"):"")+
      (o.lists_at?hxU("lists "+daymonth(o.lists_at)):""),
      "Packages with a newer version in the configured apt sources");
  return rows;
}
// OOM kills, GPU faults, hardware and I/O errors (metrics.events). Hovering a
// row shows the kernel's own lines for the latest events.
function hxEventRows(d){
  var ev=d.events; if(!ev) return "";
  // Normally the whole boot; later than that when the collector first read a
  // kernel log that no longer reached back to it.
  var since=(ev.since-(d.ts-d.uptime_s)>3600) ? "since "+daymonth(ev.since) : "since boot";
  function row(label, e, what, detail){
    e=e||{};
    var l=(e.recent||[])[0], more=l&&detail?detail(l):"";
    return hxRow(label,
      (e.n ? spill(e.n_24h?"bad":e.n_7d?"warn":"", e.n.toLocaleString()+" "+since) : spill("ok","none "+since))+
      (l ? hxU("last "+dateclock(l.t)+(more?" · "+more:"")) : ""),
      hxLines(what+", "+since+": "+(e.n||0), e.recent, e.n));
  }
  var rows=row("Out-of-memory kills", ev.oom, "Processes the kernel killed for memory", function(l){
    return l.comm+(l.rss?" at "+fmtBytes(l.rss):"")+(l.where?" in "+l.where:l.cg?" · container limit":"")+(l.user?" · "+l.user:""); });
  if((d.gpu||[]).length) rows+=row("GPU faults", ev.xid, "NVIDIA Xid events in the kernel log", function(l){
    return "Xid "+l.code+(l.comm?" · "+l.comm:""); });
  return rows+row("Hardware / I/O errors", ev.err, "Kernel log lines reporting a hardware or I/O error");
}
// Pressure-stall: share of the last minute some task waited on each resource.
function hxPressureRow(d){
  var p=d.psi; if(!p) return "";
  function v(r){ return p[r]&&p[r][1]!==null&&p[r][1]!==undefined ? p[r][1] : null; }
  function f(x){ return x===null?"—":(x<0.05?"0":x<10?x.toFixed(1):x.toFixed(0))+"%"; }
  var c=v("cpu"), i=v("io"), m=v("memory"), worst=Math.max(c||0,i||0,m||0);
  return hxRow("Stalled · CPU / I/O / memory",
    spill(worst>=40?"bad":worst>=10?"warn":"ok", f(c)+" / "+f(i)+" / "+f(m))+hxU("last minute"),
    "Pressure-stall information: share of the last minute in which at least one task was waiting for CPU time, for disk I/O, or for memory");
}
function hxFailedUnits(d){
  var f=d.os?d.os.failed:null;
  if(!f) return hxRow("not read yet","&mdash;");
  if(!f.length) return hxRow("no failed units", spill("ok","all clear"));
  return f.map(function(u){
    return "<div class='row' title=\""+esc(u.desc||u.unit)+"\"><span class='k'>"+esc(u.unit.replace(/\.service$/,""))+
      (u.desc&&u.desc!==u.unit?hxU(u.desc):"")+"</span><span class='v'>"+
      spill(u.missing?"":"bad", u.missing?"unit gone":"failed")+"</span></div>"; }).join("");
}
// The BMC's system event log (metrics.health.sel). `when` is the text for when
// it last changed, where the host can say.
function hxSelRow(sel, when, note){
  if(!sel||sel.entries===null||sel.entries===undefined) return "";
  return hxRow("BMC event log",
    spill(sel.overflow||sel.pct>=80?"warn":"", sel.entries+(sel.entries===1?" entry":" entries"))+
    (sel.pct?hxU(sel.pct+"% full"):"")+(when?hxU(when):""),
    (sel.last?"Most recent entry: "+sel.last:"")+(note?"\n"+note:""));
}
// Voltage rails the BMC rates as in range (metrics.ipmi.volts), as a table.
function hxVolts(d){
  var v=(d.ipmi||{}).volts||[];
  document.getElementById("voltstable").innerHTML="<thead><tr><th>Rail</th><th>Volts</th></tr></thead><tbody>"+
    v.map(function(x){ return "<tr><td>"+esc(x.n)+"</td><td>"+x.v.toFixed(2)+"</td></tr>"; }).join("")+"</tbody>";
  txt("voltscap", "Voltage rails — BMC"+(v.length?" · "+v.length+" in range":""));
}
// One row per physical disk from the SMART records riding on metrics.disk[]
// (akdeniz and wright). Several mounts can share a disk, so rows are keyed by
// device. Fills #diskhealth and hides its wrapper when there is nothing.
function hxDiskHealth(d){
  var seen={}, rows="";
  (d.disk||[]).forEach(function(k){
    var sm=k.smart; if(!sm||typeof sm!=="object"||seen[k.dev]) return; seen[k.dev]=1;
    var bits=[], tip=[], warn="";
    if(sm.wear_pct!==null&&sm.wear_pct!==undefined) bits.push(sm.wear_pct+"% worn");
    if(sm.hours) bits.push(sm.hours.toLocaleString()+" h");
    if(sm.written) bits.push(fmtBytes(sm.written)+" written");
    if(sm.spare_pct!==null&&sm.spare_pct!==undefined) tip.push(sm.spare_pct+"% spare blocks");
    if(sm.unsafe_shutdowns!==null&&sm.unsafe_shutdowns!==undefined) tip.push(sm.unsafe_shutdowns+" unsafe shutdowns");
    if(sm.temp) tip.push(sm.temp+" °C");
    if(sm.realloc>0||sm.pending>0) warn+=" "+spill("warn",(sm.realloc||0)+" realloc · "+(sm.pending||0)+" pending");
    if(sm.media_errors>0) warn+=" "+spill("bad",sm.media_errors+" media errors");
    if(sm.crc>0) warn+=" "+spill("warn",sm.crc+" link CRC");
    if(sm.wear_pct>=90) warn+=" "+spill("bad","worn out");
    rows+=hxRow(esc(k.dev)+(sm.model?hxU(sm.model):""),
      spill(sm.health==="PASSED"?"ok":"bad", sm.health==="PASSED"?"SMART ok":"SMART "+sm.health)+warn+
      (bits.length?hxU(bits.join(" · ")):""), tip.join(" · "));
  });
  document.getElementById("diskhealth").innerHTML=rows;
  document.getElementById("diskhealthwrap").hidden=!rows;
}
// Per-user and per-process CPU and memory (metrics.procs). CPU% is of one
// core, so 3200% would be every core of a 32-core box.
function hxWho(d){
  var pr=d.procs||{}, bu=pr.by_user||[], tp=pr.top||[];
  function cpu(v){ return v>=100 ? (v/100).toFixed(1)+" cores" : v.toFixed(1)+"%"; }
  txt("whometa", (d.who.sessions||0)+" session"+(d.who.sessions===1?"":"s")+
      ((d.who.users||[]).length?" · "+d.who.users.join(", "):""));
  document.getElementById("byuser").innerHTML=bu.length
    ? bu.map(function(u){
        return "<div class='row'><span class='k'>"+(u.system?"<span style='color:var(--dimmer)'>system</span>":esc(u.user))+
          hxU(u.n+" proc"+(u.n===1?"":"s")+" · "+fmtBytes(u.rss))+"</span><span class='v'>"+cpu(u.cpu)+"</span></div>"; }).join("")
    : "<div class='row'><span class='k'>no data yet</span><span class='v'>&mdash;</span></div>";
  document.getElementById("topprocs").innerHTML=tp.length
    ? tp.map(function(p){
        return "<div class='row' title='pid "+p.pid+"'><span class='k'>"+esc(p.comm)+
          hxU((p.user||"?")+" · "+fmtBytes(p.rss))+"</span><span class='v'>"+cpu(p.cpu)+"</span></div>"; }).join("")
    : "<div class='row'><span class='k'>nothing above 0.5% of a core</span><span class='v'>&mdash;</span></div>";
}
// The "most persistent failed login" block under the SSH card (metrics.ssh).
function hxAttackers(s){
  var atk=document.getElementById("sshatk"), top=s.top_attackers||[];
  atk.hidden=!top.length;
  if(!top.length) return;
  var a=top[0], parts=[];
  [a.city,a.region,a.country].forEach(function(p){ if(p && parts.indexOf(p)<0) parts.push(p); });
  var html="<div class='cap'>Most persistent failed login &middot; 24h</div>"+
    "<div class='who'>"+(flag(a.cc)?"<span class='flag'>"+flag(a.cc)+"</span>":"")+
    "<span class='ip'>"+esc(a.ip)+"</span>"+
    "<span class='n'>"+a.n.toLocaleString()+" failed login"+(a.n===1?"":"s")+"</span></div>"+
    "<div class='where'>"+(parts.length?esc(parts.join(", ")):
      (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(a.ip)?"private address":"locating&hellip;"))+"</div>";
  if(top.length>1) html+="<div class='rest'>then "+top.slice(1).map(function(r){
    return "<span>"+(flag(r.cc)||"&middot;")+" "+esc(r.ip)+" ("+r.n+")</span>"; }).join("")+"</div>";
  if(s.failed_24h!==null&&s.failed_24h!==undefined)
    html+="<div class='tot'>"+s.failed_24h.toLocaleString()+" failed attempt"+(s.failed_24h===1?"":"s")+" from "+
          s.attackers_24h+" address"+(s.attackers_24h===1?"":"es")+" in 24h</div>";
  atk.innerHTML=html;
}

// ---------- polling ----------
// Fetch `src` every 30 s and hand each document to render(). A failed fetch
// raises the banner and leaves the last good sample on screen; between polls
// the header's age and status dot keep counting.
function startMonitor(src, render){
  var last=null, STALE_S=120, DEAD_S=600;
  function mark(){
    if(!last) return;
    var age=Math.max(0,Math.round(Date.now()/1000-last.ts));
    txt("age", fmtAge(age)+" ago");
    document.getElementById("dot").className="dot"+(age>DEAD_S?" dead":age>STALE_S?" stale":"");
  }
  function tick(){
    fetch(src,{cache:"no-store"})
      .then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(function(d){ document.getElementById("err").style.display="none"; last=d; render(d); mark(); })
      .catch(function(e){
        var el=document.getElementById("err");
        el.style.display="block";
        el.textContent="Cannot reach telemetry endpoint ("+e.message+"). "+
          (last ? "Showing the last good sample." : "No data yet.");
        document.getElementById("dot").className="dot dead";
      });
  }
  tick();
  setInterval(tick, 30000);
  setInterval(mark, 1000);
}

// ---------- masonry ----------
// Re-measures on any card resize, which covers the lot: charts drawing,
// a <details> table opening, a container appearing, and window reflow.
function masonry(){
  var grid=document.querySelector(".grid");
  if(!grid || !window.ResizeObserver) return;   // falls back to the row grid
  var ROW=4, GAP=16;
  function fit(card){ card.style.gridRowEnd="span "+Math.ceil((card.offsetHeight+GAP)/ROW); }
  grid.classList.add("masonry");
  var ro=new ResizeObserver(function(entries){ entries.forEach(function(e){ fit(e.target); }); });
  [].forEach.call(grid.children, function(c){ fit(c); ro.observe(c); });
}

// ---------- visitors ----------
// Who outside CMU reads what ganesha serves: unique IPs, not requests, with
// VPN, scanner and bot traffic removed upstream (akdeniz-access-stats.py).
function startVisitors(){
  var AX="https://photos.proofsandreasons.io/akdeniz/access-stats.json";
  function fill(id, items, label){
    var el=document.getElementById(id);
    if(!el) return;
    // title= as well as the text: .row .k ellipsises, and "Glenwood Springs,
    // Colorado, United States" is wider than the column at one card width.
    el.innerHTML=(items&&items.length) ? items.map(function(it){
      var lab=esc(label(it));
      return '<div class="row"><span class="k" title="'+lab+'">'+lab+'</span><span class="v">'+
             it.count.toLocaleString()+'</span></div>'; }).join("")
      : '<div class="row"><span class="k" style="color:var(--dimmer)">none yet</span><span class="v">&mdash;</span></div>';
  }
  // City / state / country, skipping unknowns and repeats: the city-states come
  // back from the geo database as "Singapore, Singapore, Singapore", and a good
  // few US states share a name with their own largest city.
  function place(x){
    var out=[];
    [x.city,x.region,x.country].forEach(function(p){ if(p && p!=="Unknown" && out.indexOf(p)<0) out.push(p); });
    return out.join(", ") || "Unknown";
  }
  function refresh(){
    fetch(AX,{cache:"no-store"}).then(function(r){ return r.json(); }).then(function(d){
      var ex=d.excluded||{};
      txt("axtotal",(d.unique_ips||0).toLocaleString());
      txt("axcc",(d.countries!=null?d.countries:(d.by_country||[]).length).toLocaleString());
      txt("axdrop",(ex.total||0).toLocaleString());
      // Both lists in full: the generator caps the feed at 1000 cities and 400
      // countries, and both cards scroll past the fold rather than growing.
      fill("axcity", d.by_city, place);
      fill("axcountry", d.by_country, function(x){ return x.country; });
      // Spell out what was dropped rather than leaving a bare filtered count:
      // the number only means something alongside the reasons.
      var parts=[];
      if(ex.vpn)    parts.push(ex.vpn+" VPN/relay");
      if(ex.attack) parts.push(ex.attack+" scanning");
      if(ex.bot)    parts.push(ex.bot+" bot"+(ex.bot===1?"":"s"));
      txt("axdropnote", parts.length?("filtered: "+parts.join(", ")):"");
      // An all-time count is only readable against its start date, so "since"
      // sits with the timestamp rather than being left to the reader.
      txt("axts", [d.since?"since "+d.since:"", d.updated?"updated "+d.updated:""].filter(Boolean).join(" · "));
    }).catch(function(){ txt("axts","stats unavailable"); });
  }
  refresh(); setInterval(refresh,60000);
}

// ---------- server room ----------
// The camera on grothendieck: a frame every 15 s or so, plus the list of
// frames its change detector flagged (worker.py there compares each frame
// with a slow-moving background and saves one when more than 1.5% of it
// differs). Only the list is public; the flagged frames stay on groth's page,
// which the card links to (CMU network only).
//
// "New" means newer than the last one this browser acknowledged, kept in
// localStorage; following the link to groth, or clicking the pill, clears it.
function startCamera(){
  var BASE="https://photos.proofsandreasons.io/akdeniz/";
  var img=document.getElementById("camimg"), row=document.getElementById("camev"), newest="";
  function seen(){ try{ return localStorage.getItem("camSeen")||""; }catch(e){ return ""; } }
  function acknowledge(){ try{ localStorage.setItem("camSeen", newest); }catch(e){} events(); }
  // "2026-11-14 03:12:40" -> "14 Nov 03:12", in the camera's own clock.
  function when(s){
    var m=/^\d{4}-(\d\d)-(\d\d) (\d\d:\d\d)/.exec(s||"");
    return m ? (+m[2])+" "+MONTHS[(+m[1])-1]+" "+m[3] : (s||"");
  }
  function frame(){
    var u=BASE+"camera.jpg?t="+Date.now(), probe=new Image();
    probe.onload=function(){ img.src=u; txt("camts","updated "+new Date().toLocaleTimeString()); };
    probe.onerror=function(){ txt("camts","camera offline"); };
    probe.src=u;
  }
  function events(){
    fetch(BASE+"camera-events.json",{cache:"no-store"}).then(function(r){ return r.json(); }).then(function(d){
      var ev=d.events||[], last=ev[ev.length-1];
      newest=last?last.time:"";
      var fresh=ev.filter(function(e){ return e.time>seen(); }).length;
      row.innerHTML=hxRow("Change detection",
        (fresh ? "<button type='button' class='pill bad' id='camack' style='cursor:pointer;background:none' "+
                 "title='Mark as seen'>"+fresh+" new</button> " : "")+
        (ev.length ? spill("warn", ev.length+" frame"+(ev.length===1?"":"s")+" flagged")+
                     hxU("last "+when(last.time)+" · "+last.score+"% of the frame changed")
                   : spill("ok","nothing flagged"))+
        hxU("now "+(d.last_score||0)+"%"),
        ["Frames the detector saved (more than 1.5% of the picture differing from its running background); "+
         "it last looked at "+when(d.updated)]
          .concat(ev.slice(-8).reverse().map(function(e){ return when(e.time)+"  "+e.score+"% changed"; })).join("\n"));
      var b=document.getElementById("camack");
      if(b) b.addEventListener("click", acknowledge);
    }).catch(function(){ row.innerHTML=hxRow("Change detection", spill("","not available")); });
  }
  [].forEach.call(document.querySelectorAll("a[href*='groth.lan.cmu.edu/camera']"), function(a){
    a.addEventListener("click", acknowledge);
  });
  frame(); events();
  setInterval(frame,15000); setInterval(events,15000);
}
