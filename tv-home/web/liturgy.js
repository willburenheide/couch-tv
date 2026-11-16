// Roman Calendar, Saint of the Day, forecast and US weather alerts on the home. Ported from Clean TV
// Home (the Chromecast launcher: Liturgy.java, SaintCard.java, ForecastCard.java), with the NWS alert
// tones from the frame dashboard.
//
// - Under the date: today's celebration in the US Roman Calendar with a dot in the liturgical colour,
//   for example "● Saint Charles Borromeo, Bishop · Memorial". On a weekday it names any optional
//   memorial too. Data: the free Liturgical Calendar API (litcal.johnromanodorazio.com), downloaded
//   once a year and kept in the page's storage.
// - A soft glow over the scene in the day's colour (green, violet, red, rose, or gold for white days).
// - A National Weather Service alert line ("Winter Storm Warning until 6 PM") when one is active for
//   the weather place. api.weather.gov, US only; elsewhere it finds none and shows nothing.
// - Two panels the quick buttons open (app.js, "liturgy" and "forecast"):
//   Saint of the Day, the story from Franciscan Media's feed, which the TV app fetches for the page
//   (TVOS.saintFeed, MainActivity.kt) because the feed does not allow web pages to read it; and the
//   forecast: the next 10 hours, 5 days, and the full text of any NWS alert.
//   Up and down scroll a panel; OK, Back or Left closes it.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var TV = window.TVOS || null;
  var LITCAL = "https://litcal.johnromanodorazio.com/api/v5/calendar/nation/US/";
  var DOT = { red: "#e53935", green: "#43a047", purple: "#8e44ad", violet: "#8e44ad", rose: "#f48fb1", pink: "#f48fb1", gold: "#ffc107", black: "#9e9e9e" };
  var GLOW = { red: "198,40,40", green: "46,158,68", purple: "123,31,162", violet: "123,31,162", rose: "224,86,155", pink: "224,86,155", black: "69,90,100" };
  var DEG = "°", DROP = "💧";
  var today = null, alerts = [], panel = null, saintCache = null;

  function home() { return window.CouchHome || null; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function ymd(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function clock24() { var h = home(); return h && h.clock24 ? h.clock24() : false; }

  // ------------------------------------------------------------------ the calendar
  function rankLabel(g) { return { 2: "Optional memorial", 3: "Memorial", 4: "Feast", 5: "Feast of the Lord", 6: "Solemnity", 7: "Solemnity" }[g] || ""; }
  function shortName(n) { var i = n.indexOf(","); return i > 0 ? n.slice(0, i) : n; }

  // For each date the highest-ranking celebration (vigil Masses left out), plus the first optional
  // memorial when the day itself is only a weekday. Same rules as Clean TV Home's Liturgy.java.
  function summarise(events) {
    var days = {}, best = {};
    events.forEach(function (e) {
      if (e.is_vigil_mass || /Vigil Mass/.test(e.name || "")) return;
      var date = String(e.date || "").slice(0, 10);
      if (date.length < 10) return;
      var g = e.grade || 0, color = (e.color && e.color[0]) || "white";
      var day = days[date] || (days[date] = {});
      if (g === 2) { if (!day.o) day.o = shortName(e.name || ""); return; }
      if (g > (best[date] == null ? -1 : best[date])) {
        best[date] = g;
        day.t = e.name || "";
        day.r = /Sunday/.test(day.t) ? "" : rankLabel(g);   // Sundays carry a feast grade; the name says enough
        day.c = color;
      }
    });
    Object.keys(days).forEach(function (k) { if ((best[k] || 0) >= 3) delete days[k].o; });
    return days;
  }

  function loadYear(year) {
    var kept = store("litcal." + year);
    if (kept) { try { return Promise.resolve(JSON.parse(kept)); } catch (e) {} }
    return fetch(LITCAL + year, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        var days = summarise(j.litcal || []);
        store("litcal." + year, JSON.stringify(days));
        store("litcal." + (year - 1), "");   // last year's copy is no longer needed
        return days;
      });
  }

  function refreshDay() {
    var d = new Date();
    return loadYear(d.getFullYear()).then(function (days) {
      today = days[ymd(d)] || null;
      renderLine();
    }, function () { renderLine(); });
  }

  function renderLine() {
    var el = $("litcal");
    if (!el) return;
    if (!today || !today.t) { el.innerHTML = ""; el.classList.remove("on"); setGlow(null); return; }
    var parts = [esc(today.t)];
    if (today.r) parts.push(esc(today.r));
    if (today.o) parts.push("or " + esc(today.o));
    el.innerHTML = '<span class="lit-dot" style="background:' + (DOT[today.c] || "#f7f3e8") + '"></span>' + parts.join(" &middot; ");
    el.classList.add("on");
    setGlow(today.c);
  }

  function setGlow(color) {
    var g = $("lit-glow");
    if (!g) return;
    var rgb = color ? (GLOW[color] || "212,166,58") : null;   // white days glow gold: a white glow only greys the scene
    g.style.background = rgb ? "radial-gradient(ellipse at 85% 0%, rgba(" + rgb + ",0.30), rgba(" + rgb + ",0.08) 45%, rgba(" + rgb + ",0) 75%)" : "none";
  }

  // ------------------------------------------------------------------ NWS alerts
  function wx() { var h = home(); return h && h.weather ? h.weather() : null; }

  function refreshAlerts() {
    var w = wx();
    if (!w || !isFinite(w.lat) || !isFinite(w.lon)) return Promise.resolve();
    var url = "https://api.weather.gov/alerts/active?status=actual&point=" + (+w.lat).toFixed(4) + "," + (+w.lon).toFixed(4);
    return fetch(url, { headers: { Accept: "application/geo+json" } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        var now = new Date();
        alerts = (j.features || []).map(function (f) { return f.properties || {}; })
          .filter(function (a) { return a.event && a.messageType !== "Cancel" && (!a.ends || new Date(a.ends) > now) && (!a.expires || new Date(a.expires) > now); })
          .sort(function (a, b) { return tone(b) - tone(a); });
        renderAlerts();
      }, function (e) {
        if (String(e && e.message) === "404" || String(e && e.message) === "400") { alerts = []; renderAlerts(); }   // outside the US
      });
  }

  function tone(a) { return /warning/i.test(a.event) || a.severity === "Extreme" ? 2 : (/watch/i.test(a.event) || a.severity === "Severe" ? 1 : 0); }
  function timeText(iso) {
    var d = new Date(iso);
    var day = d.toDateString() === new Date().toDateString() ? "" : d.toLocaleDateString("en-US", { weekday: "short" }) + " ";
    return day + d.toLocaleTimeString("en-US", { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined, hour12: !clock24() });
  }

  function renderAlerts() {
    var el = $("nws");
    if (!el) return;
    if (!alerts.length) { el.innerHTML = ""; el.className = "nws"; return; }
    var a = alerts[0], until = a.ends || a.expires;
    var more = alerts.length > 1 ? " (+" + (alerts.length - 1) + ")" : "";
    el.className = "nws on tone" + tone(a);
    el.innerHTML = '<span class="nws-ico">&#9888;</span>' + esc(a.event) + (until ? " until " + esc(timeText(until)) : "") + more;
  }

  // ------------------------------------------------------------------ panels
  function openPanel(title, sub, body) {
    closePanel();
    panel = document.createElement("div");
    panel.className = "lit-panel";
    panel.innerHTML = '<div class="lit-card"><h1 class="lit-title"></h1><p class="lit-sub"></p>' +
      '<div class="lit-body" id="lit-body"></div><p class="lit-foot"></p></div>';
    panel.querySelector(".lit-title").textContent = title;
    panel.querySelector(".lit-sub").textContent = sub || "";
    panel.querySelector(".lit-foot").textContent = "↑ ↓ to scroll · OK or Back to close";
    panel.querySelector(".lit-body").innerHTML = body || "";
    document.body.appendChild(panel);
    return panel;
  }
  function closePanel() { if (panel) { panel.remove(); panel = null; } }
  function setPanel(title, sub, body) {
    if (!panel) return;
    if (title != null) panel.querySelector(".lit-title").textContent = title;
    if (sub != null) panel.querySelector(".lit-sub").textContent = sub;
    if (body != null) panel.querySelector(".lit-body").innerHTML = body;
  }
  function wait(msg) { return '<p class="lit-wait">' + esc(msg) + "</p>"; }

  // app.js acts on OK when the key comes up; swallow that too while a panel is open or just closed by it.
  // (Registered before the key handler below, so it sees whether a panel was open when the key went down.)
  var swallowUp = false;
  window.addEventListener("keydown", function () { swallowUp = !!panel; }, true);
  window.addEventListener("keyup", function (e) { if (panel || swallowUp) { swallowUp = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  // While a panel is open its keys never reach the home underneath (this listens before app.js does).
  window.addEventListener("keydown", function (e) {
    if (!panel) return;
    var k = e.keyCode, b = $("lit-body");
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat && (k === 13 || k === 23)) return;
    if (k === 38 || k === 19) { if (b) b.scrollTop -= 160; }
    else if (k === 40 || k === 20) { if (b) b.scrollTop += 160; }
    else if (k === 13 || k === 23 || k === 32 || k === 27 || k === 8 || k === 4 || k === 37 || k === 21 ||
      e.key === "GoBack" || e.key === "BrowserBack" || e.key === "Escape") closePanel();
  }, true);

  // Saint of the Day. The TV app fetches Franciscan Media's feed and answers through saintReply().
  function openSaint() {
    var d = new Date();
    var sub = (today && today.t ? today.t + " · " : "") + d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    openPanel("Saint of the Day", sub, wait("Loading…"));
    if (saintCache && saintCache.day === ymd(d)) { showSaint(saintCache); return; }
    var asked = false;
    try { asked = !!(TV && TV.saintFeed && TV.saintFeed()); } catch (e) {}
    if (!asked) setPanel(null, null, wait("The saint's story needs the couch-tv TV app."));
  }

  function saintReply(xml) {
    if (!xml) { setPanel(null, null, wait("Couldn't load today's saint. Check the internet connection and try again.")); return; }
    try {
      var doc = new DOMParser().parseFromString(xml, "text/xml");
      var items = [].slice.call(doc.getElementsByTagName("item"));
      if (!items.length) throw new Error("no item");
      var get = function (item, tag) { var n = item.getElementsByTagName(tag)[0]; return n ? n.textContent : ""; };
      // the item for today's date (the feed runs a day ahead), else the newest, as SaintCard.java
      var now = new Date(), item = items.filter(function (it) {
        var d = new Date(get(it, "pubDate"));
        return !isNaN(d) && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      })[0] || items[0];
      var html = get(item, "content:encoded") || get(item, "encoded") || get(item, "description");
      saintCache = { day: ymd(now), title: get(item, "title"), html: html, img: "" };
      if (panel) showSaint(saintCache);
      var link = get(item, "link").trim();
      try { if (link && TV && TV.saintImage) TV.saintImage(link); } catch (e) {}
    } catch (e) {
      setPanel(null, null, wait("Couldn't read today's saint."));
    }
  }

  // The saint's picture, from the story page (the TV app reads its og:image): the feed's own
  // pictures are newsletter adverts, so none of those are shown.
  function saintImage(url) {
    if (!saintCache || !/^https:\/\//.test(url)) return;
    saintCache.img = url;
    if (panel) showSaint(saintCache);
  }

  // The story as plain paragraphs with the saint's picture on top; image credits dropped (as SaintCard.java).
  function showSaint(s) {
    var tmp = document.createElement("div");
    tmp.innerHTML = s.html;
    var src = s.img || "";
    var paras = [];
    tmp.querySelectorAll("p, h2, h3, li").forEach(function (n) {
      var txt = (n.textContent || "").replace(/\s+/g, " ").trim();
      if (!txt || /^Image:/i.test(txt)) return;
      if (txt.length < 60 && /Images|Wikimedia|Commons/.test(txt)) return;
      paras.push(/^H[23]$/.test(n.tagName) ? "<h3>" + esc(txt) + "</h3>" : "<p>" + esc(txt) + "</p>");
    });
    if (!paras.length) paras.push("<p>" + esc((tmp.textContent || "").trim()) + "</p>");
    setPanel(s.title || "Saint of the Day", null,
      (src && /^https:\/\//.test(src) ? '<img class="lit-img" src="' + esc(src) + '" alt="">' : "") + paras.join("") +
      '<p class="lit-credit">From Franciscan Media</p>');
  }

  // Forecast: Open-Meteo (free, no key) for the weather place, laid out like Clean TV Home's
  // ForecastCard: the place, "Now 54°, cloudy · H 61° L 40°", the next 10 hours from "Now", then 5
  // days from "Today", rain chance blue from 30%. Then the full text of any NWS alert.
  var WMO = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Snow showers",
    95: "Storms", 96: "Storms", 99: "Storms" };
  function glyph(code, day) {
    if (code >= 95) return "⛈";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "❄";
    if (code >= 51) return "☔";
    if (code === 45 || code === 48 || code === 3) return "☁";
    if (code === 2) return day ? "⛅" : "☁";
    return day ? "☀" : "☾";
  }
  function rain(p) { p = p || 0; return '<small class="' + (p >= 30 ? "wet" : "") + '">' + DROP + " " + p + "%</small>"; }

  function openForecast() {
    var w = wx();
    openPanel(w && w.place ? String(w.place).split(",")[0] : "Weather", "", wait("Loading…"));
    if (!w || !isFinite(w.lat)) { setPanel(null, null, wait("No weather place is set.")); return; }
    var h = home(), F = h && h.fahrenheit ? h.fahrenheit() : true, c24 = clock24();
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + w.lat + "&longitude=" + w.lon +
      "&hourly=temperature_2m,weather_code,is_day,precipitation_probability" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&current=temperature_2m,weather_code,is_day,apparent_temperature" +
      "&temperature_unit=" + (F ? "fahrenheit" : "celsius") +
      "&timezone=" + encodeURIComponent(w.timezone || "auto") + "&forecast_days=5";
    refreshAlerts();
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var out = "", D = j.daily, H = j.hourly;
      if (j.current) {
        var c = j.current;
        setPanel(null, "Now " + Math.round(c.temperature_2m) + DEG + ", " + String(WMO[c.weather_code] || "").toLowerCase() +
          (D ? "  ·  H " + Math.round(D.temperature_2m_max[0]) + DEG + "  L " + Math.round(D.temperature_2m_min[0]) + DEG : "") +
          "  ·  feels like " + Math.round(c.apparent_temperature) + DEG, null);
      }
      var hourStart = Math.floor(Date.now() / 3600e3) * 3600e3, cells = [];
      for (var i = 0; H && i < H.time.length && cells.length < 10; i++) {
        var tm = new Date(H.time[i]);
        if (tm.getTime() < hourStart) continue;
        var hr = tm.getHours(), lbl = !cells.length ? "Now" : (c24 ? ("0" + hr).slice(-2) + ":00" : (hr % 12 || 12) + (hr < 12 ? " AM" : " PM"));
        cells.push('<div class="wx-cell' + (!cells.length ? " hl" : "") + '"><b>' + lbl + '</b><span class="wx-g">' + glyph(H.weather_code[i], H.is_day[i]) + "</span>" +
          '<span class="wx-hi">' + Math.round(H.temperature_2m[i]) + DEG + "</span>" + rain(H.precipitation_probability ? H.precipitation_probability[i] : 0) + "</div>");
      }
      if (cells.length) out += '<h3 class="wx-lbl">Next ' + cells.length + ' hours</h3><div class="wx-row">' + cells.join("") + "</div>";
      var days = [];
      for (var k = 0; D && k < D.time.length && days.length < 5; k++) {
        var dd = new Date(D.time[k] + "T12:00:00");
        days.push('<div class="wx-cell' + (!k ? " hl" : "") + '"><b>' + (!k ? "Today" : dd.toLocaleDateString("en-US", { weekday: "short" })) + '</b>' +
          '<span class="wx-g big">' + glyph(D.weather_code[k], 1) + "</span>" +
          '<span class="wx-hi">' + Math.round(D.temperature_2m_max[k]) + DEG + '</span><span class="wx-lo">' + Math.round(D.temperature_2m_min[k]) + DEG + "</span>" +
          rain(D.precipitation_probability_max ? D.precipitation_probability_max[k] : 0) + "</div>");
      }
      if (days.length) out += '<h3 class="wx-lbl">Next ' + days.length + ' days</h3><div class="wx-row">' + days.join("") + "</div>";
      alerts.forEach(function (a) {
        out += '<div class="wx-alert tone' + tone(a) + '"><h3>&#9888; ' + esc(a.event) + "</h3>" +
          (a.headline ? "<p><b>" + esc(a.headline) + "</b></p>" : "") +
          String(a.description || "").split(/\n\s*\n/).map(function (p) { return "<p>" + esc(p.replace(/\s*\n\s*/g, " ")) + "</p>"; }).join("") +
          (a.instruction ? "<p><i>" + esc(a.instruction.replace(/\s*\n\s*/g, " ")) + "</i></p>" : "") + "</div>";
      });
      out += '<p class="lit-credit">Open-Meteo' + (alerts.length ? " · National Weather Service" : "") + "</p>";
      setPanel(null, null, out);
    }, function () { setPanel(null, null, wait("Couldn't load the forecast. Check the internet connection.")); });
  }

  // ------------------------------------------------------------------ styles and start
  var css = document.createElement("style");
  css.textContent = [
    ".litcal{display:none;margin-top:.5rem;font-size:1.25rem;line-height:1.75rem;color:rgba(255,255,255,.86);text-shadow:0 1px 6px rgba(0,0,0,.55)}",
    ".litcal.on{display:block}",
    ".lit-dot{display:inline-block;width:.8rem;height:.8rem;border-radius:50%;margin-right:.55rem;vertical-align:.05rem;box-shadow:0 0 0 2px rgba(255,255,255,.25)}",
    ".lit-glow{position:fixed;inset:0;pointer-events:none;z-index:0;transition:background 1.2s}",
    ".nws{display:none;margin-top:.5rem;font-size:1.125rem;line-height:1.6rem;padding:.25rem .8rem;border-radius:1rem}",
    ".nws.on{display:inline-block}.nws.tone2{background:rgba(198,40,40,.85)}.nws.tone1{background:rgba(230,140,0,.85)}.nws.tone0{background:rgba(60,90,140,.8)}",
    ".nws-ico{margin-right:.4rem}",
    ".lit-panel{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}",
    ".lit-card{width:min(62rem,88vw);max-height:84vh;display:flex;flex-direction:column;padding:2rem 2.4rem 1.4rem;border-radius:1.6rem;background:rgba(24,24,30,.94);box-shadow:0 1.5rem 4rem rgba(0,0,0,.6);color:#fff;text-align:left}",
    ".lit-title{margin:0;font-size:2.2rem;font-weight:600}.lit-sub{margin:.4rem 0 0;font-size:1.15rem;color:rgba(255,255,255,.65)}",
    ".lit-body{margin-top:1rem;overflow:hidden;overflow-y:auto;scroll-behavior:smooth;font-size:1.3rem;line-height:1.85rem;color:rgba(255,255,255,.9)}",
    ".lit-body p{margin:0 0 .9rem}.lit-body h3{margin:1.1rem 0 .6rem;font-size:1.35rem}",
    ".lit-img{display:block;max-width:100%;max-height:22rem;margin:0 auto 1rem;border-radius:1rem;object-fit:contain}",
    ".lit-foot,.lit-credit{margin:.8rem 0 0;font-size:.95rem;color:rgba(255,255,255,.5)}",
    ".lit-wait{color:rgba(255,255,255,.7)}",
    ".wx-lbl{text-transform:uppercase;letter-spacing:.08em;font-size:.95rem!important;color:rgba(255,255,255,.6)}",
    ".wx-row{display:flex;gap:.5rem}",
    ".wx-cell{flex:1;display:flex;flex-direction:column;align-items:center;padding:.6rem .2rem;border-radius:1rem;text-align:center}",
    ".wx-cell.hl{background:rgba(255,255,255,.12)}",
    ".wx-cell b{font-weight:600;font-size:1rem;color:rgba(255,255,255,.8)}",
    ".wx-g{font-size:1.7rem;line-height:2.4rem}.wx-g.big{font-size:2.2rem;line-height:3rem}",
    ".wx-hi{font-size:1.3rem;font-weight:600}.wx-lo{font-size:1.05rem;color:rgba(255,255,255,.6)}",
    ".wx-cell small{font-size:.9rem;color:rgba(255,255,255,.5)}.wx-cell small.wet{color:#7cc4ff}",
    ".wx-alert{margin-top:1.2rem;padding:.6rem 1rem;border-radius:1rem}.wx-alert.tone2{background:rgba(198,40,40,.3)}.wx-alert.tone1{background:rgba(230,140,0,.25)}.wx-alert.tone0{background:rgba(60,90,140,.3)}"
  ].join("\n");
  document.head.appendChild(css);

  function start() {
    refreshDay();
    setTimeout(refreshAlerts, 5000);   // after app.js has read the weather place from the settings
    setInterval(refreshAlerts, 5 * 60e3);
    // the day changes at midnight: look again every 10 minutes (cheap, the year is kept)
    var shown = ymd(new Date());
    setInterval(function () { var n = ymd(new Date()); if (n !== shown) { shown = n; refreshDay(); } }, 10 * 60e3);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else setTimeout(start, 0);

  window.Liturgy = {
    openSaint: openSaint,
    openForecast: openForecast,
    saintReply: saintReply,
    saintImage: saintImage,
    isOpen: function () { return !!panel; },
    close: closePanel,
    today: function () { return today; },
    refresh: function () { refreshDay(); refreshAlerts(); }
  };
})();
