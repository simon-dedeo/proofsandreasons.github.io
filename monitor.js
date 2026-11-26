/* monitor.js -- everything the three host-monitor pages (akdeniz.html,
   wright.html, ganesha.html) have in common: number and time formatting, the
   line-chart renderer, the 1 h / 24 h / 30 d history windows, the health rows
   built from metrics.json, polling, the masonry layout, and the cluster-jobs,
   visitors and server-room panels. Each page keeps only its own cards and its render().

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
function fmtTok(v){
  if(v===null||v===undefined||isNaN(v)) return "—";
  return v>=1000 ? (v/1000).toFixed(v>=10000?1:2)+"k/s" : Math.round(v)+"/s";
}
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
    // Every sample of the last hour, by the clock. Where the collector missed
    // some, a null is put in so the line breaks rather than bridging the hole.
    var every=d.interval_s||30, newest=rows[rows.length-1].t, before=null;
    rows.forEach(function(x){
      if(newest-x.t>3600) return;
      if(before!==null && x.t-before>3*every) push(before+every, null);
      push(x.t, x); before=x.t;
    });
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
// Empty a chart whose series is not in this payload, so the last drawing does
// not sit there looking current.
function clearChart(id){
  var svg=document.querySelector("#"+id+" svg");
  while(svg && svg.firstChild) svg.removeChild(svg.firstChild);
}
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
    clearChart(o.chart);
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
  } else {
    clearChart("netchart");
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
//
// A block the collector reads on its own slow cadence carries `age_s` (seconds
// since that probe last succeeded; null if it never has) and, when the last
// attempt failed, `error`. hxStale() turns those into a visible amber note:
// a probe that could not look must never read as a green "nothing found".
function hxStale(b, limit){
  if(!b || (b.age_s===undefined && !b.error)) return "";            // an older collector: no claim either way
  if(b.age_s===null) return " "+spill("warn","not read"+(b.error?": "+b.error:""));
  if(b.error || b.age_s>limit) return " "+spill("warn", "stale · read "+fmtAge(b.age_s)+" ago");
  return "";
}
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
  var st=hxStale(o, 3600);
  if(st) rows+=hxRow("Update / unit checks", st, o.error||"");
  return rows;
}
// OOM kills, GPU faults, hardware and I/O errors (metrics.events). Hovering a
// row shows the kernel's own lines for the latest events.
function hxEventRows(d){
  var ev=d.events; if(!ev) return "";
  // Normally the whole boot; later than that when the collector first read a
  // kernel log that no longer reached back to it.
  var since=(ev.since-(d.ts-d.uptime_s)>3600) ? "since "+daymonth(ev.since) : "since boot";
  // The kernel log could not be read (or has not been for half an hour): a
  // zero then means nothing, and is shown as unknown rather than as clear.
  var stale=hxStale(ev, 1800), gaps=ev.gaps?" The log was lost track of "+ev.gaps+" time"+(ev.gaps===1?"":"s")+
      " in that span; events in those gaps are not counted.":"";
  function row(label, e, what, detail){
    e=e||{};
    var l=(e.recent||[])[0], more=l&&detail?detail(l):"";
    return hxRow(label,
      (e.n ? spill(e.n_24h?"bad":e.n_7d?"warn":"", e.n.toLocaleString()+" "+since)
           : stale ? spill("warn","unknown") : spill("ok","none "+since))+
      (l ? hxU("last "+dateclock(l.t)+(more?" · "+more:"")) : ""),
      hxLines(what+", "+since+": "+(e.n||0)+"."+gaps+(ev.error?" Last read failed: "+ev.error:""), e.recent, e.n));
  }
  var rows=row("Out-of-memory kills", ev.oom, "Processes the kernel killed for memory", function(l){
    return l.comm+(l.rss?" at "+fmtBytes(l.rss):"")+(l.where?" in "+l.where:l.cg?" · container limit":"")+(l.user?" · "+l.user:""); });
  if((d.gpu||[]).length) rows+=row("GPU faults", ev.xid, "NVIDIA Xid events in the kernel log", function(l){
    return "Xid "+l.code+(l.comm?" · "+l.comm:""); });
  rows+=row("Hardware / I/O errors", ev.err, "Kernel log lines reporting a hardware or I/O error");
  return stale ? rows+hxRow("Kernel log", stale, ev.error||"") : rows;
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
    (sel.pct?hxU(sel.pct+"% full"):"")+(when?hxU(when):"")+hxStale(sel, 7200),
    (sel.last?"Most recent entry: "+sel.last:"")+(note?"\n"+note:""));
}
// BMC sensors that used to read "ok" and no longer do (metrics.ipmi.alerts):
// gone past a threshold, or stopped answering. Sensors that were never ok
// (empty slots, unwired rails) are not in the list.
function hxBmcAlerts(d){
  return ((d.ipmi||{}).alerts||[]).map(function(a){
    var what=/cr$/.test(a.status)?"critical":/nr$/.test(a.status)?"non-recoverable":/nc$/.test(a.status)?"warning":
             a.status==="ns"?"no reading":a.status;
    return hxRow("BMC · "+esc(a.n), spill(/nc$/.test(a.status)?"warn":"bad", what)+hxU(a.reading),
      "This sensor has read ok before and does not now (BMC status \""+a.status+"\")");
  }).join("");
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
    // A reading that could not be refreshed keeps its age: an old PASSED is
    // not a current one. (A disk left asleep is expected to be old.)
    if(sm.failed) warn+=" "+spill("warn","unreadable");
    if(sm.asleep) bits.push("asleep");
    if(sm.age_s>3600 || ((sm.failed||sm.asleep) && sm.age_s!==null && sm.age_s!==undefined)) bits.push("read "+fmtAge(sm.age_s)+" ago");
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
  document.getElementById("byuser").title=document.getElementById("topprocs").title=
    "Measured between two samples 30 s apart: a process that starts and ends in between is not seen, "+
    "and memory is resident size summed per process, so shared pages are counted more than once.";
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
// Fetch `src` every 30 s and hand each document to render(). The banner goes
// up, and the dot red, both when the fetch fails and when a document arrives
// that cannot be drawn; either way the last good sample stays on screen and is
// said to be so. A sample only becomes "the last good one" once render() has
// returned. One request at a time, each with a deadline, and a response older
// than what is already shown is dropped.
function startMonitor(src, render){
  var last=null, broken=false, busy=false, STALE_S=120, DEAD_S=600;
  function mark(){
    if(!last || broken) return;
    var age=Math.max(0,Math.round(Date.now()/1000-last.ts));
    txt("age", fmtAge(age)+" ago");
    document.getElementById("dot").className="dot"+(age>DEAD_S?" dead":age>STALE_S?" stale":"");
  }
  function tick(){
    if(busy) return;
    busy=true;
    var ctl=new AbortController(), timer=setTimeout(function(){ ctl.abort(); }, 20000), drawing=false;
    fetch(src,{cache:"no-store", signal:ctl.signal})
      .then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(function(d){
        if(!d || typeof d.ts!=="number" || !Array.isArray(d.history)) throw new Error("not a metrics document");
        if(last && d.ts<last.ts) return;
        drawing=true;
        render(d);
        last=d; broken=false;
        document.getElementById("err").style.display="none";
        mark();
      })
      .catch(function(e){
        broken=true;
        var el=document.getElementById("err");
        el.style.display="block";
        el.textContent=(drawing ? "The latest sample could not be drawn ("+e.message+"). The page may be partly out of date."
                                : "Cannot reach telemetry endpoint ("+(e.name==="AbortError"?"timed out":e.message)+"). "+
                                  (last ? "Showing the last good sample." : "No data yet."));
        document.getElementById("dot").className="dot dead";
      })
      .then(function(){ clearTimeout(timer); busy=false; });
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
// The camera on grothendieck: a frame every 15 s or so, plus the record of its
// change detector (worker.py there compares each frame with a slow-moving
// background and saves one when more than 1.5% of it differs; it keeps the
// last 50). Only the record is public; the flagged frames stay on groth's
// page, which the card links to (CMU network only).
//
// How fresh the picture is comes from the record's `ts`, the moment the frame
// was captured and compared -- not from whether a JPEG could be downloaded,
// which stays true for a camera that froze an hour ago.
//
// "New" means newer than the last one this browser acknowledged, kept in
// localStorage; following the link to groth, or clicking the pill, clears it.
function startCamera(){
  var BASE="https://photos.proofsandreasons.io/akdeniz/";
  var img=document.getElementById("camimg"), row=document.getElementById("camev");
  var newest="", captured=null, imgOk=true;
  function seen(){ try{ return localStorage.getItem("camSeen")||""; }catch(e){ return ""; } }
  function acknowledge(){ try{ localStorage.setItem("camSeen", newest); }catch(e){} events(); }
  // "2026-11-14 03:12:40" -> "14 Nov 03:12", in the camera's own clock.
  function when(s){
    var m=/^\d{4}-(\d\d)-(\d\d) (\d\d:\d\d)/.exec(s||"");
    return m ? (+m[2])+" "+MONTHS[(+m[1])-1]+" "+m[3] : (s||"");
  }
  function status(){
    var age=captured?Math.max(0,Math.round(Date.now()/1000-captured)):null, el=document.getElementById("camts");
    var stalled=!imgOk || (age!==null && age>180);
    el.style.color=stalled?"var(--warn)":"";
    el.textContent=!imgOk ? "camera image unavailable"
      : age===null ? "frame loaded; capture time not published"
      : stalled ? "camera stalled: last frame captured "+fmtAge(age)+" ago"
      : "frame captured "+fmtAge(age)+" ago";
  }
  function frame(){
    var u=BASE+"camera.jpg?t="+Date.now(), probe=new Image();
    probe.onload=function(){ img.src=u; imgOk=true; status(); };
    probe.onerror=function(){ imgOk=false; status(); };
    probe.src=u;
  }
  function events(){
    fetch(BASE+"camera-events.json",{cache:"no-store"}).then(function(r){ return r.json(); }).then(function(d){
      var ev=d.events||[], last=ev[ev.length-1];
      newest=last?last.time:"";
      captured=d.ts||null;
      status();
      var fresh=ev.filter(function(e){ return e.time>seen(); }).length;
      row.innerHTML=hxRow("Change detection",
        (fresh ? "<button type='button' class='pill bad' id='camack' style='cursor:pointer;background:none' "+
                 "title='Mark as seen'>"+fresh+" new</button> " : "")+
        (ev.length ? spill("warn", ev.length+" frame"+(ev.length===1?"":"s")+" flagged")+
                     hxU("last "+when(last.time)+" · "+last.score+"% of the frame changed")
                   : spill("ok","nothing flagged"))+
        hxU("now "+(d.last_score||0)+"%"),
        ["The frames the detector has kept (the latest "+(d.kept||50)+" at most; each is one where more than 1.5% of "+
         "the picture differed from its running background). It last looked at "+when(d.updated)+"."]
          .concat(ev.slice(-8).reverse().map(function(e){ return when(e.time)+"  "+e.score+"% changed"; })).join("\n"));
      var b=document.getElementById("camack");
      if(b) b.addEventListener("click", acknowledge);
    }).catch(function(){ row.innerHTML=hxRow("Change detection", spill("warn","record not available")); });
  }
  [].forEach.call(document.querySelectorAll("a[href*='groth.lan.cmu.edu/camera']"), function(a){
    a.addEventListener("click", acknowledge);
  });
  frame(); events();
  setInterval(frame,15000); setInterval(events,15000); setInterval(status,5000);
}

// ---------- cluster jobs ----------
// Our GPU queues on NCSA DeltaAI and ORCHARD, written by akdeniz-jobs.timer
// every five minutes rather than by the 30s telemetry collectors. Separate
// file, separate cadence, separate failures: NCSA is asked over a logged-in
// ssh connection held on wright, ORCHARD through a Google login on akdeniz,
// and either can lapse while the other (and the rest of the page) carries on,
// so ages are tracked per cluster.
function startClusterJobs(opts){
  opts=opts||{};
  var JOBS_SRC="https://photos.proofsandreasons.io/akdeniz/jobs.json";
  var TOK_SRC="https://photos.proofsandreasons.io/wright/metrics.json";
  var JOBS_STALE_S=1200;     // four missed polls
  var lastJobs=null, lastTokDoc=null, tokRange="24h", tokPicked=false;
  var TOK_NAMES={wright:"wright", deltaai:"DeltaAI", orchard:"ORCHARD", nrp:"NRP"};
  // "2026-01-01" -> "1 Jan". Parsed by hand rather than via Date, which would
  // read a bare ISO date as UTC and shift it a day west of here.
  function monthDay(iso){
    var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||"");
    if(!m) return iso||"";
    return (+m[3])+" "+MONTHS[(+m[2])-1];
  }
  // Class q carries the alignment and must be on every count cell, including
  // the zero and missing ones -- those drop the wait/run colour class.
  function jobCell(n, cls){
    if(n===null||n===undefined) return "<td class='q z'>&mdash;</td>";
    return "<td class='q "+(n?cls:"z")+"'>"+n+"</td>";
  }
  function hourCell(n){
    if(n===null||n===undefined) return "<td class='hrs z'>&mdash;</td>";
    return "<td class='hrs'>"+n.toLocaleString()+"</td>";
  }
  function renderJobs(j){
    var tbl=document.getElementById("clustertable"), notes=document.getElementById("clnotes");
    if(!tbl||!notes) return;
    var cls=(j&&j.clusters)||[];
    if(!cls.length){
      tbl.innerHTML=""; notes.textContent="No cluster data yet.";
      txt("jobsmeta",""); return;
    }
    var now=Date.now()/1000, newest=0, rows="", note=[];
    // The hours column counts from a date that can differ by cluster. One
    // shared date goes in the column heading; otherwise each cluster's line
    // below the table says its own.
    var sinces=cls.map(function(c){ return (c.hours||{}).since||""; }).filter(Boolean);
    var shared=sinces.length && sinces.every(function(x){ return x===sinces[0]; }) ? sinces[0] : null;
    cls.forEach(function(c){
      var w=(c.jobs||{}).waiting||{}, r=(c.jobs||{}).running||{}, hrs=c.hours||{};
      var age=c.ts?Math.max(0,Math.round(now-c.ts)):null, stale=(age===null)||(age>JOBS_STALE_S);
      var who=cls.length>1 ? "<b style='color:var(--ink)'>"+esc(c.name)+"</b> &mdash; " : "";
      if(c.ts&&c.ts>newest) newest=c.ts;
      // GPU jobs and GPU-hours only; CPU jobs and bundled cores are left out.
      rows+="<tr class='top"+(stale?" stale":"")+"'>"+
        "<th class='nm'>"+esc(c.name)+
          (c.label?"<span class='ago'>"+esc(c.label)+"</span>":"")+
          "<span class='ago"+(stale?" old":"")+"'>"+(age===null?"never":fmtAge(age)+" ago")+"</span></th>"+
        "<th class='kind'>GPU</th>"+
        jobCell(c.jobs?w.gpu||0:null,"wait")+jobCell(c.jobs?r.gpu||0:null,"run")+
        hourCell(c.hours?hrs.gpu||0:null)+"</tr>";

      // Resources behind the job counts, and when the queued ones might start.
      var bits=[];
      if(c.jobs&&c.gpus){
        if(c.gpus.running) bits.push("<b>running</b> "+c.gpus.running.toLocaleString()+" GPU");
        if(c.gpus.waiting) bits.push("<b>queued</b> "+c.gpus.waiting.toLocaleString()+" GPU");
        if(c.jobs.other) bits.push("<b>other states</b> "+c.jobs.other);
      }
      (c.running||[]).filter(function(x){ return x.gpus; }).slice(0,3).forEach(function(x){
        if(x.node) bits.push("<b>"+esc(x.node)+"</b> "+(x.left_s!==null&&x.left_s!==undefined?fmtDur(x.left_s)+" left":"running"));
      });
      if(w.gpu){
        if(c.next_start) bits.push("<b>next start</b> "+(c.next_start<=now?"due":esc(dayclock(c.next_start))+" (est.)"));
        var why=Object.keys(c.reasons||{});
        if(why.length) bits.push("<b>waiting on</b> "+esc(why.join(", ").toLowerCase()));
        if(c.fairshare!==null&&c.fairshare!==undefined) bits.push("<b>fair-share</b> "+c.fairshare.toFixed(2));
      }
      if(!shared && hrs.since) bits.push("hours since "+esc(monthDay(hrs.since)));
      if(bits.length) note.push("<div"+(note.length?" style='margin-top:5px'":"")+">"+who+bits.join(" &nbsp;&middot;&nbsp; ")+"</div>");

      // The allocation: what has been charged and what is left of the grant.
      var al=c.alloc;
      if(al&&al.deposited){
        var pct=100*al.balance/al.deposited;
        note.push("<div title='Charged hours, from the centre&#39;s own accounting. It will not match the GPU-hours "+
          "in the table exactly: the table counts running jobs up to this minute, which the centre has not "+
          "finished charging, and the interactive partition is charged at twice the rate.'>"+
          "<b>allocation</b> "+(al.deposited-al.balance).toLocaleString()+" charged &nbsp;&middot;&nbsp; "+
          al.balance.toLocaleString()+" of "+al.deposited.toLocaleString()+" "+esc(al.unit||"hours")+" left</div>"+
          "<div class='track' style='margin:5px 0 3px'><div class='fill' style='width:"+Math.max(0,Math.min(100,pct)).toFixed(1)+
          "%;background:"+(pct<10?"var(--bad)":pct<25?"var(--warn)":"var(--s3)")+"'></div></div>");
      }
      // A failed poll: the raw text stays in jobs.json (c.err), but the two
      // cases a person has to act on are named. NCSA takes no ssh keys, so its
      // poll rides a logged-in connection held on wright; ORCHARD's goes
      // through a Google login on akdeniz that Google expires now and then.
      // Neither recovers until someone logs in again.
      if(c.ok===false){
        note.push("<div style='color:var(--warn)'>"+esc(c.name)+": "+(c.err_kind==="session"
          ? "the login on wright has lapsed &mdash; run <b>ncsa-login --on wright</b> and approve the Duo push"
          : c.err_kind==="auth"
          ? "the Google login on akdeniz has lapsed &mdash; run <b>gcloud auth login</b> there"
          : c.err_kind==="jump"||c.err_kind==="timeout" ? "the login node could not be reached; showing the previous numbers"
          : "last poll failed; showing the previous numbers")+"</div>");
      }
    });

    tbl.innerHTML="<thead><tr><th class='l'>Cluster</th><th class='l'></th>"+
      "<th class='l'>Waiting</th><th class='l'>Running</th>"+
      "<th>Total hours"+(shared?"<small>since "+esc(monthDay(shared))+"</small>":"")+"</th>"+
      "</tr></thead><tbody>"+rows+"</tbody>";
    notes.innerHTML=note.join("");
    // "our" is the part worth keeping -- these are our jobs, not the cluster's
    // whole queue.
    txt("jobsmeta", "our jobs"+(newest?" · polled "+ago(newest):""));
  }
  function renderTok(d){
    var wrap=document.getElementById("tokwrap");
    if(!wrap || !d) return;
    lastTokDoc=d;
    var tk=d.tok||{};
    var hasLive=tk.total!==null&&tk.total!==undefined;
    txt("toknow", hasLive ? Math.round(tk.total).toLocaleString() : "—");
    txt("tokmeta", tk.servers ? tk.servers+" server"+(tk.servers===1?"":"s") : (hasLive?"idle":""));
    var by=tk.by||{}, order=["wright","deltaai","orchard","nrp"].concat(
      Object.keys(by).filter(function(k){ return ["wright","deltaai","orchard","nrp"].indexOf(k)<0; }));
    var parts=order.filter(function(k){ return by[k]>0; }).map(function(k){
      var v=by[k];
      return "<b>"+esc(TOK_NAMES[k]||k)+"</b> "+(v>=1000?(v/1000).toFixed(v>=10000?1:1)+"k":v);
    });
    var byEl=document.getElementById("tokby");
    if(byEl) byEl.innerHTML=parts.join(" &middot; ");

    var wins={"1h":windowFor(d,"1h"), "24h":windowFor(d,"24h"), "30d":windowFor(d,"30d")};
    var have={"1h":!!(wins["1h"]&&wins["1h"].tok), "24h":!!(wins["24h"]&&wins["24h"].tok), "30d":!!(wins["30d"]&&wins["30d"].tok)};
    var active=tokRange;
    if(!have[active]){
      if(have["1h"]) active="1h";
      else if(have["24h"]) active="24h";
      else if(have["30d"]) active="30d";
    } else if(!tokPicked && tokRange==="24h"){
      active="24h";
    }
    [].forEach.call(document.querySelectorAll("#tokrange button"), function(b){
      var ok=have[b.dataset.range];
      b.setAttribute("aria-pressed", b.dataset.range===active ? "true" : "false");
      b.disabled=!ok;
      b.title=ok?"":"Not enough throughput history yet";
      b.style.opacity=ok?"":".4";
    });

    var w=wins[active], keys="", stat="";
    if(w && w.tok) w=trimLead(w, ["tok"]);
    if(w && w.tok && w.tok.length>1){
      var series=[{name:"Tokens/s",color:S3,data:w.tok,labels:w.labels}], cols=["tok"];
      keys="<span><i style='background:var(--s3)'></i>Generation &mdash; "+spanText(w.span)+"</span>";
      if(w.tokMax){
        series.push({name:"Peak",color:S3,dash:true,data:w.tokMax,labels:w.labels});
        keys+="<span><i class='dash' style='color:var(--s3)'></i>"+w.peak+"</span>";
        cols.push("tokMax");
      }
      lineChart("tokchart", series, fmtTok);
      document.querySelector("#tokchart svg").setAttribute("aria-label","Token generation throughput, "+spanText(w.span));
      var s=stats(w.tok), pk=stats(w.tokMax||w.tok);
      if(s) stat="avg "+fmtTok(s.avg)+" · peak "+fmtTok(pk.max);
      document.getElementById("toktblcap").innerHTML="Table view &mdash; throughput, "+spanText(w.span);
      document.getElementById("toktable").innerHTML=
        "<thead><tr><th>Time</th><th>Tok/s</th>"+(w.tokMax?"<th>Peak</th>":"")+"</tr></thead><tbody>"+
        tableRows(w, cols, fmtTok)+"</tbody>";
    } else {
      document.getElementById("toktable").innerHTML="<tbody><tr><td>Collecting throughput history&hellip;</td></tr></tbody>";
      stat=hasLive?"collecting history…":"";
    }
    document.getElementById("tokkeys").innerHTML=keys;
    txt("tokstat", stat);
  }
  var tr=document.getElementById("tokrange");
  if(tr){
    tr.addEventListener("click", function(ev){
      var b=ev.target.closest("button");
      if(!b || b.disabled) return;
      tokRange=b.dataset.range;
      tokPicked=true;
      if(lastTokDoc) renderTok(lastTokDoc);
    });
  }
  function tickJobs(){
    fetch(JOBS_SRC,{cache:"no-store"})
      .then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(function(j){ lastJobs=j; renderJobs(j); })
      .catch(function(){ if(!lastJobs) renderJobs(null); });
  }
  function tickTok(){
    fetch(TOK_SRC,{cache:"no-store"})
      .then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(function(d){ renderTok(d); })
      .catch(function(){});
  }
  tickJobs();
  setInterval(tickJobs, 60000);
  // Ages in the cluster card drift between polls just like the header's does.
  setInterval(function(){ if(lastJobs) renderJobs(lastJobs); }, 15000);
  if(opts.pollTok!==false && document.getElementById("tokwrap")){
    tickTok();
    setInterval(tickTok, 30000);
  }
  return {updateTok: renderTok};
}
