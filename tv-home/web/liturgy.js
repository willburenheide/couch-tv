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
  var LITCAL = "https://litcal.johnromanodorazio.com/api/v5/calendar/nation/US/";   // + year + CIVIL: January to December
  var WOF = "Word on Fire \u00b7 Daily Gospel Reflection (NRSV-CE)";
  var DOT = { red: "#e53935", green: "#43a047", purple: "#8e44ad", violet: "#8e44ad", rose: "#f48fb1", pink: "#f48fb1", gold: "#ffc107", black: "#9e9e9e" };
  var GLOW = { red: "198,40,40", green: "46,158,68", purple: "123,31,162", violet: "123,31,162", rose: "224,86,155", pink: "224,86,155", black: "69,90,100" };
  var DEG = "°", DROP = "💧";
  var today = null, tomorrow = null, alerts = [], panel = null, panelKind = "", saintCache = null;

  function home() { return window.CouchHome || null; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function ymd(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function clock24() { var h = home(); return h && h.clock24 ? h.clock24() : false; }

  // ------------------------------------------------------------------ the calendar
  function rankLabel(g) { return { 2: "Optional memorial", 3: "Memorial", 4: "Feast", 5: "Feast of the Lord", 6: "Solemnity", 7: "Solemnity" }[g] || ""; }
  // "The Immaculate Conception of the Blessed Virgin Mary, Patronal feastday of the USA" -> "Immaculate Conception"
  function holyName(n) { return n.replace(/, Patronal.*$/, "").replace(/^The /, "").replace(/ of the Blessed Virgin Mary$/, ""); }
  function shortName(n) { var i = n.indexOf(","); return i > 0 ? n.slice(0, i) : n; }

  // For each date the highest-ranking celebration (vigil Masses left out), plus every optional
  // memorial when the day itself is only a weekday (some days have two or three).
  function summarise(events) {
    var days = {}, best = {};
    events.forEach(function (e) {
      if (e.is_vigil_mass || /Vigil Mass/.test(e.name || "")) return;
      var date = String(e.date || "").slice(0, 10);
      if (date.length < 10) return;
      var g = e.grade || 0, color = (e.color && e.color[0]) || "white";
      var day = days[date] || (days[date] = {});
      if (e.liturgical_season) day.s = String(e.liturgical_season).toLowerCase();   // advent, christmas, lent, ...
      if (e.holy_day_of_obligation && !day.h) day.h = holyName(e.name || "");
      if (g === 2) { (day.o || (day.o = [])).push(shortName(e.name || "")); return; }
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
    var kept = store("litcal3." + year);
    if (kept) { try { return Promise.resolve(JSON.parse(kept)); } catch (e) {} }
    return fetch(LITCAL + year + "?year_type=CIVIL", { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        var days = summarise(j.litcal || []);
        if (Object.keys(days).length < 300) return days;   // a partial or odd answer: use it today, ask again next time
        store("litcal3." + year, JSON.stringify(days));
        // older copies: last year's, and the church-year download (it ended on 28 November 2026)
        store("litcal3." + (year - 1), ""); store("litcal2." + year, ""); store("litcal." + year, "");
        return days;
      });
  }

  function refreshDay() {
    var d = new Date(), t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    var years = [loadYear(d.getFullYear())];
    if (t.getFullYear() !== d.getFullYear()) years.push(loadYear(t.getFullYear()).catch(function () { return {}; }));   // 31 December: tomorrow is next year
    return Promise.all(years).then(function (ys) {
      today = ys[0][ymd(d)] || null;
      tomorrow = (ys[1] || ys[0])[ymd(t)] || null;
      renderLine(); renderWreath(); renderHoly();
    }, function () { renderLine(); renderWreath(); renderHoly(); });
  }

  // ------------------------------------------------------------------ Advent wreath
  // From the First Sunday of Advent one more candle is lit each Sunday (violet, violet, rose for
  // Gaudete, violet); through the Christmas season all four burn with the white Christ candle. A line
  // icon on the quick buttons' own frosted pill (class qbtn), top left. As the frame dashboard.
  function dayNum(d) { return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); }
  function firstAdvent(y) { var x = new Date(y, 11, 25), w = x.getDay(); return dayNum(x) - (w === 0 ? 7 : w) - 21; }
  var ORD = ["", "First", "Second", "Third", "Fourth"];
  function wreathCandles() {
    var season = today && today.s, now = new Date();
    if (season === "christmas") return 5;
    if (season !== "advent") return 0;
    return Math.max(1, Math.min(4, Math.floor((dayNum(now) - firstAdvent(now.getFullYear())) / 7) + 1));
  }
  function renderWreath() {
    var n = wreathCandles(), el = $("lit-wreath");
    if (!n) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div"); el.id = "lit-wreath"; el.className = "qbtn lit-wreath"; el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    var C = [{ x: 13, b: 33, h: 17, c: "#a77be0" }, { x: 25, b: 29, h: 15, c: "#a77be0" }, { x: 39, b: 29, h: 15, c: "#f2a6c6" }, { x: 51, b: 33, h: 17, c: "#a77be0" }];
    var flame = function (x, top) { return '<path class="flame" d="M' + x + " " + (top - 9) + 'c2.6 3.2 3 5.6 0 7.4c-3-1.8-2.6-4.2 0-7.4z"/>'; };
    var candle = function (k) {
      var c = C[k], top = c.b - c.h, lit = k < n;
      return '<rect x="' + (c.x - 3) + '" y="' + top + '" width="6" height="' + c.h + '" rx="1.6" fill="' + (lit ? c.c : "none") + '"/>' +
        (lit ? flame(c.x, top) : '<path d="M' + c.x + " " + top + 'v-2.5"/>');
    };
    var christ = n === 5 ? '<rect x="29" y="9" width="6" height="22" rx="1.6" fill="#fffaf0"/>' + flame(32, 9) : "";
    var now = new Date(), cap, sub;
    if (n === 5) { cap = "Christmas season"; sub = "Merry Christmas"; }
    else {
      cap = ORD[n] + " week of Advent";
      var xmas = Math.round((Date.UTC(now.getFullYear(), 11, 25) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
      if (n < 4) {
        var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - now.getDay()));
        sub = "Next candle " + next.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      } else sub = xmas === 1 ? "Christmas is tomorrow" : "Christmas in " + xmas + " days";
    }
    el.innerHTML = '<svg viewBox="0 0 64 40">' + candle(1) + candle(2) + christ +
      '<ellipse cx="32" cy="32" rx="29" ry="5.5" fill="rgba(16,16,20,.35)"/>' + candle(0) + candle(3) + "</svg>" +
      '<div class="lit-wreath-cap">' + esc(cap) + "<small>" + esc(sub) + "</small></div>";
  }

  // ------------------------------------------------------------------ Holy Days of Obligation
  // A reminder under the liturgy line from 3 PM the day before until noon on the day (not Sundays,
  // which are always days of obligation), as the frame dashboard.
  function renderHoly() {
    var el = $("lit-holy"), now = new Date(), h = now.getHours(), text = "";
    var notSunday = function (off) { return new Date(now.getFullYear(), now.getMonth(), now.getDate() + off).getDay() !== 0; };
    if (h >= 15 && tomorrow && tomorrow.h && notSunday(1)) {
      var t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      text = "Tomorrow is a Holy Day of Obligation <small>\u00b7 " + esc(tomorrow.h) + ", " +
        esc(t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })) + "</small>";
    } else if (h < 12 && today && today.h && notSunday(0)) {
      text = "Today is a Holy Day of Obligation <small>\u00b7 " + esc(today.h) + "</small>";
    }
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
      var nws = $("nws");
      if (!nws) return;
      el = document.createElement("div"); el.id = "lit-holy"; el.className = "qbtn lit-holy";
      nws.parentNode.insertBefore(el, nws);
    }
    el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v18M7 8h10"/></svg><span>' + text + "</span>";
  }

  function renderLine() {
    var el = $("litcal");
    if (!el) return;
    if (!today || !today.t) { el.innerHTML = ""; el.classList.remove("on"); setGlow(null); return; }
    // "Monday of the 33rd Week of Ordinary Time – Saint Margaret of Scotland or Saint Gertrude the Great"
    var line = esc(today.t) + (today.r ? " &middot; " + esc(today.r) : "");
    var opt = today.o ? [].concat(today.o) : [];
    if (opt.length) line += " &ndash; " + opt.map(esc).join(" or ");
    el.innerHTML = '<span class="lit-dot" style="background:' + (DOT[today.c] || "#f7f3e8") + '"></span>' + line;
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
  function openPanel(title, sub, body, kind) {
    closePanel();
    panelKind = kind || "";
    panel = document.createElement("div");
    panel.className = "lit-panel";
    var reading = kind === "saint" || kind === "gospel";
    panel.innerHTML = '<div class="lit-card">' + (reading ? '<div class="lit-tabs"><span class="lit-tab' + (kind === "saint" ? " on" : "") +
      '">Saint of the Day</span><span class="lit-tab' + (kind === "gospel" ? " on" : "") + '">Today\u2019s Gospel</span></div>' : "") +
      '<h1 class="lit-title"></h1><p class="lit-sub"></p>' +
      '<div class="lit-body" id="lit-body"></div><p class="lit-foot"></p></div>';
    panel.querySelector(".lit-title").textContent = title;
    panel.querySelector(".lit-sub").textContent = sub || "";
    panel.querySelector(".lit-foot").textContent = (reading ? "\u2190 \u2192 Saint or Gospel \u00b7 " : "") + "\u2191 \u2193 to scroll \u00b7 OK or Back to close";
    panel.querySelector(".lit-body").innerHTML = body || "";
    document.body.appendChild(panel);
    return panel;
  }
  function closePanel() { if (panel) { panel.remove(); panel = null; } panelKind = ""; }
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
    else if ((k === 37 || k === 21 || k === 39 || k === 22) && (panelKind === "saint" || panelKind === "gospel")) {
      if (panelKind === "saint" && (k === 39 || k === 22)) openGospel();
      else if (panelKind === "gospel" && (k === 37 || k === 21)) openSaint();
    }
    else if (k === 13 || k === 23 || k === 32 || k === 27 || k === 8 || k === 4 || k === 37 || k === 21 ||
      e.key === "GoBack" || e.key === "BrowserBack" || e.key === "Escape") closePanel();
  }, true);

  // The cross button: Saint of the Day on a saint's day (a memorial or feast of a saint, or a weekday
  // with optional memorials), else Today's Gospel (Sundays, plain weekdays, solemnities, feasts of the
  // Lord), as the frame dashboard decides. Left and Right switch between the two either way.
  function openReading() {
    var saintDay = !!(today && (today.o || /^(Memorial|Optional memorial|Feast)$/.test(today.r || "")));
    if (saintDay) openSaint(); else openGospel();
  }
  function readingSub(d) { return (today && today.t ? today.t + " \u00b7 " : "") + d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); }

  // Today's Gospel and Bishop Barron's reflection, from Word on Fire's feed, which the TV app fetches
  // (TVOS.gospelFeed: the feed sends no CORS header). Today's item only.
  var gospelCache = null;
  function openGospel() {
    var d = new Date();
    openPanel("Today\u2019s Gospel", readingSub(d), wait("Loading\u2026"), "gospel");
    if (gospelCache && gospelCache.day === ymd(d)) { showGospel(gospelCache); return; }
    var asked = false;
    try { asked = !!(TV && TV.gospelFeed && TV.gospelFeed()); } catch (e) {}
    if (!asked) setPanel(null, null, wait("Today's Gospel needs the couch-tv TV app."));
  }
  function gospelReply(xml) {
    if (panelKind !== "gospel") return;
    if (!xml) { setPanel(null, null, wait("Couldn't load today's Gospel. Check the internet connection and try again.")); return; }
    var now = new Date(), want = MONTHS[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear();
    var items = xml.split(/<item>/i).slice(1);
    var item = items.filter(function (x) { return ((/<title>([^<]*)<\/title>/.exec(x) || [])[1] || "").indexOf(want) >= 0; })[0];
    if (!item) { setPanel(null, null, wait("Word on Fire hasn't posted today's Gospel yet. Try again a little later.")); return; }
    var html = (/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/.exec(item) || [])[1] || "";
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var blocks = [].slice.call(tmp.querySelectorAll("h1, h2, h3, h4, h5, h6, p")).map(function (n) {
      return { h: /^H/.test(n.tagName), text: (n.textContent || "").replace(/\s+/g, " ").trim() };
    }).filter(function (b) { return b.text; });
    var gi = -1, ri = -1;
    blocks.forEach(function (b, i) {
      if (gi < 0 && b.h && /^(The |Holy )?Gospel( Reading)?$/i.test(b.text)) gi = i;
      if (ri < 0 && b.h && /^Reflection$/i.test(b.text)) ri = i;
    });
    if (gi < 0) { setPanel(null, null, wait("Couldn't read today's Gospel.")); return; }
    var g = blocks.slice(gi + 1, ri > gi ? ri : undefined);
    gospelCache = { day: ymd(now),
      ref: (g.filter(function (b) { return b.h && /\d+:\d+/.test(b.text); })[0] || {}).text || "",
      gospel: g.filter(function (b) { return !b.h; }).map(function (b) { return b.text; }),
      reflection: ri > 0 ? blocks.slice(ri + 1).filter(function (b) { return !b.h; }).map(function (b) { return b.text; }) : [] };
    showGospel(gospelCache);
  }
  function showGospel(c) {
    setPanel(c.ref || "Today\u2019s Gospel", null,
      c.gospel.map(function (t) { return '<p class="lit-quote">' + esc(t) + "</p>"; }).join("") +
      (c.reflection.length ? "<h3>Bishop Barron\u2019s reflection</h3>" + c.reflection.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") : "") +
      '<p class="lit-credit">' + WOF + "</p>");
  }

  // Saint of the Day. The TV app fetches Franciscan Media's feed and answers through saintReply().
  function openSaint() {
    var d = new Date();
    openPanel("Saint of the Day", readingSub(d), wait("Loading…"), "saint");
    if (saintCache && saintCache.day === ymd(d)) { showSaint(saintCache); return; }
    var asked = false;
    try { asked = !!(TV && TV.saintFeed && TV.saintFeed()); } catch (e) {}
    if (!asked) setPanel(null, null, wait("The saint's story needs the couch-tv TV app."));
  }

  // Today's saint, as the frame dashboard picks it: the feed item dated today (the feed's years are
  // wrong, so month and day only). The feed can lag behind the website (on 16 November 2026 its newest
  // item was still the 15th), so then the Saint of the Day page's newest saints are read, and one is
  // used only if its own heading says "Saint of the Day for <today>". Never another day's saint.
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SITE = "https://www.franciscanmedia.org/saint-of-the-day/";
  var siteLeft = [];   // the saint pages still to try for today

  function saintReply(xml) {
    if (panelKind !== "saint") return;
    if (!xml) { setPanel(null, null, wait("Couldn't load today's saint. Check the internet connection and try again.")); return; }
    try {
      var doc = new DOMParser().parseFromString(xml, "text/xml");
      var items = [].slice.call(doc.getElementsByTagName("item"));
      var get = function (item, tag) { var n = item.getElementsByTagName(tag)[0]; return n ? n.textContent : ""; };
      var now = new Date(), item = items.filter(function (it) {
        var m = /(\d{1,2}) ([A-Z][a-z]{2})/.exec(get(it, "pubDate"));
        return m && +m[1] === now.getDate() && m[2] === MONTHS[now.getMonth()].slice(0, 3);
      })[0];
      if (!item) { askPage(SITE); return; }   // not in the feed yet: the website
      var html = get(item, "content:encoded") || get(item, "encoded") || get(item, "description");
      saintCache = { day: ymd(now), title: get(item, "title"), html: html, img: "" };
      showSaint(saintCache);
      var link = get(item, "link").trim();
      try { if (link && TV && TV.saintImage) TV.saintImage(link); } catch (e) {}
    } catch (e) {
      setPanel(null, null, wait("Couldn't read today's saint."));
    }
  }

  function askPage(url) {
    var ok = false;
    try { ok = !!(TV && TV.saintPage && TV.saintPage(url)); } catch (e) {}
    if (!ok) notPosted();
  }
  function notPosted() {
    if (panelKind === "saint") setPanel(null, null, wait("Franciscan Media hasn't posted today's saint yet. Try again a little later."));
  }

  // The TV app's answer to saintPage(): the Saint of the Day index, or one saint's page.
  function pageReply(url, html) {
    if (panelKind !== "saint") return;
    if (!html) { notPosted(); return; }
    if (url === SITE) {
      var seen = {};
      siteLeft = (html.match(/https:\/\/www\.franciscanmedia\.org\/saint-of-the-day\/[a-z0-9-]+\//g) || [])
        .filter(function (u) { if (seen[u] || /\/(sort|calendar|feed|page)\//.test(u)) return false; return (seen[u] = true); })
        .slice(0, 2);
    } else {
      var now = new Date(), want = ">Saint of the Day for " + MONTHS[now.getMonth()] + " " + now.getDate() + "<";
      var at = html.indexOf(want);
      if (at >= 0) {
        var from = html.lastIndexOf("<h", at), refl = html.indexOf(">Reflection<", at);
        var to = refl > 0 ? html.indexOf("<hr", refl) : -1;
        if (to < 0) to = refl > 0 ? refl + 6000 : at + 12000;
        var meta = function (prop) {
          var m = new RegExp('<meta[^>]+property="' + prop + '"[^>]+content="([^"]+)"', "i").exec(html);
          var d = document.createElement("textarea"); d.innerHTML = m ? m[1] : ""; return d.value;   // &amp; and the like
        };
        var img = meta("og:image");
        saintCache = { day: ymd(now), title: meta("og:title").replace(/\s*\|\s*Franciscan Media\s*$/i, ""),
          html: html.slice(from, to).replace(/<h\d[^>]*>\s*Saint of the Day for [^<]*<\/h\d>/i, ""), img: /^https:\/\//.test(img) ? img : "" };
        showSaint(saintCache);
        return;
      }
    }
    if (siteLeft.length) askPage(siteLeft.shift());
    else notPosted();
  }

  // The saint's picture, from the story page (the TV app reads its og:image): the feed's own
  // pictures are newsletter adverts, so none of those are shown.
  function saintImage(url) {
    if (!saintCache || !/^https:\/\//.test(url)) return;
    saintCache.img = url;
    if (panelKind === "saint") showSaint(saintCache);
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
    openPanel(w && w.place ? String(w.place).split(",")[0] : "Weather", "", wait("Loading…"), "forecast");
    var mine = panel;   // the reply only fills this panel, not one opened since
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
      if (panel !== mine) return;
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
    }, function () { if (panel === mine) setPanel(null, null, wait("Couldn't load the forecast. Check the internet connection.")); });
  }

  // ------------------------------------------------------------------ styles and start
  var css = document.createElement("style");
  css.textContent = [
    ".litcal{display:none;max-width:46vw;margin-left:auto;padding:.2rem 0 .2rem .25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:.3rem;font-size:1.25rem;line-height:1.75rem;color:rgba(255,255,255,.86);text-shadow:0 1px 6px rgba(0,0,0,.55)}",
    ".litcal.on{display:block}",
    ".lit-dot{display:inline-block;width:.8rem;height:.8rem;border-radius:50%;margin-right:.55rem;vertical-align:.05rem;box-shadow:0 0 0 2px rgba(255,255,255,.25)}",
    ".lit-glow{position:fixed;inset:0;pointer-events:none;z-index:0;transition:background 1.2s}",
    ".nws{display:none;margin-top:.5rem;font-size:1.125rem;line-height:1.6rem;padding:.25rem .8rem;border-radius:1rem}",
    ".nws.on{display:inline-block}.nws.tone2{background:rgba(198,40,40,.85)}.nws.tone1{background:rgba(230,140,0,.85)}.nws.tone0{background:rgba(60,90,140,.8)}",
    ".nws-ico{margin-right:.4rem}",
    ".lit-panel{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}",
    ".lit-tabs{display:flex;gap:.5rem;margin-bottom:.6rem}",
    ".lit-tab{padding:.3rem 1.1rem;border-radius:1rem;font-size:1.05rem;color:rgba(255,255,255,.6);background:rgba(255,255,255,.07)}",
    ".lit-tab.on{background:#fff;color:#111;font-weight:600}",
    ".lit-quote{border-left:3px solid rgba(233,217,166,.6);padding-left:1rem}",
    ".qbtn.lit-wreath{position:fixed;left:5rem;top:3.6rem;gap:1.2rem;height:5.5rem;padding:0 2.1rem 0 1.5rem;border-radius:2.75rem;z-index:5;justify-content:flex-start;pointer-events:none}",
    ".theme-night .qbtn.lit-wreath svg,.qbtn.lit-wreath svg{width:5.6rem;height:3.5rem;fill:none;stroke:#fff;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round;overflow:visible}",
    ".qbtn.lit-wreath svg ellipse{stroke-width:2.2}",
    ".lit-wreath .flame{fill:#ffd27a;stroke:none;filter:drop-shadow(0 0 3px rgba(255,190,90,.95));transform-box:fill-box;transform-origin:50% 100%;animation:lit-flick 1.6s ease-in-out infinite}",
    "@keyframes lit-flick{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.12)}}",
    "@media (prefers-reduced-motion: reduce){.lit-wreath .flame{animation:none}}",
    "html.still .lit-wreath .flame{animation:none}",
    ".lit-wreath-cap{text-align:left;font-size:1.4375rem;font-weight:600;line-height:1.8rem}",
    ".lit-wreath-cap small{display:block;font-size:1.1rem;font-weight:400;line-height:1.4rem;color:rgba(255,255,255,.7)}",
    ".qbtn.lit-holy{display:inline-flex;height:auto;min-width:0;margin-top:.55rem;padding:.45rem 1.3rem .45rem 1rem;border-radius:1.6rem;font-size:1.2rem;gap:.7rem;box-shadow:inset 0 0 0 .1rem rgba(233,200,110,.75);pointer-events:none}",
    ".theme-night .qbtn.lit-holy svg,.qbtn.lit-holy svg{width:1.6rem;height:1.6rem;stroke:#e9c86e}",
    ".lit-holy small{font-weight:400;color:rgba(255,255,255,.75)}",
    ".theme-night .qbtn.lit-holy span{display:inline}",   // the Night look hides button labels; this one is the point
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
    setInterval(function () { var n = ymd(new Date()); if (n !== shown) { shown = n; refreshDay(); } else renderHoly(); }, 10 * 60e3);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else setTimeout(start, 0);

  window.Liturgy = {
    openSaint: openReading,
    gospelReply: gospelReply,
    openForecast: openForecast,
    saintReply: saintReply,
    pageReply: pageReply,
    saintImage: saintImage,
    isOpen: function () { return !!panel; },
    close: closePanel,
    today: function () { return today; },
    refresh: function () { refreshDay(); refreshAlerts(); }
  };
})();
