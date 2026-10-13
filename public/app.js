/*
 * Frame dashboard client. Deliberately ES5 (no arrow functions, let/const, fetch or template
 * strings) so it runs on the frame's stock Android 6 WebView as well as an upgraded one.
 *
 * Times are shown in the server's configured time zone using the offset the server sends, and
 * countdowns use the server's clock, so a wrong clock or time zone on the frame doesn't matter.
 */
(function () {
  'use strict';

  var POLL_MS = 30000;
  var params = parseQuery(location.search);
  var NIGHT_START = num(params.nightStart, 23); // dim the screen between these hours
  var NIGHT_END = num(params.nightEnd, 6);

  var data = null;
  var clockSkew = 0; // server time - frame time
  var lastOk = 0;

  var ROUTE_COLORS = {
    '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
    '4': '#00933C', '5': '#00933C', '6': '#00933C',
    '7': '#B933AD',
    'A': '#0039A6', 'C': '#0039A6', 'E': '#0039A6',
    'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'M': '#FF6319',
    'G': '#6CBE45', 'J': '#996633', 'Z': '#996633', 'L': '#A7A9AC',
    'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A',
    'S': '#808183', 'SIR': '#1D2F6F'
  };
  var DARK_TEXT = { 'N': 1, 'Q': 1, 'R': 1, 'W': 1, 'L': 1 };

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];

  function num(v, d) { var n = parseInt(v, 10); return isNaN(n) ? d : n; }

  function parseQuery(q) {
    var out = {};
    q.replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      out[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function now() { return Date.now() + clockSkew; }

  // A Date whose getUTC* fields read as wall-clock time in the dashboard's time zone.
  function wall(ms) {
    var offset = data ? data.tzOffsetMin * 60000 : -new Date(ms).getTimezoneOffset() * 60000;
    return new Date(ms + offset);
  }

  function hour12(h) { return h % 12 === 0 ? 12 : h % 12; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // ---- weather ---------------------------------------------------------------------------

  function wx(code, isDay) {
    if (code === 0) return isDay === false ? ['🌙', 'Clear'] : ['☀️', 'Sunny'];
    if (code === 1) return isDay === false ? ['🌙', 'Mostly clear'] : ['🌤️', 'Mostly sunny'];
    if (code === 2) return ['⛅', 'Partly cloudy'];
    if (code === 3) return ['☁️', 'Cloudy'];
    if (code === 45 || code === 48) return ['🌫️', 'Fog'];
    if (code >= 51 && code <= 57) return ['🌦️', 'Drizzle'];
    if (code >= 61 && code <= 67) return ['🌧️', code >= 66 ? 'Freezing rain' : 'Rain'];
    if (code >= 71 && code <= 77) return ['🌨️', 'Snow'];
    if (code >= 80 && code <= 82) return ['🌦️', 'Showers'];
    if (code === 85 || code === 86) return ['🌨️', 'Snow showers'];
    if (code >= 95) return ['⛈️', 'Thunderstorms'];
    return ['☁️', ''];
  }

  function renderWeather(w) {
    if (!w || w.error) return errorHtml('Weather', w);
    var c = w.current;
    var cw = wx(c.code, c.isDay);
    var today = w.daily[0];
    var html = '<div class="wx-now"><div class="wx-icon">' + cw[0] + '</div><div>' +
      '<div class="wx-temp">' + c.temp + '°</div>' +
      '<div class="wx-desc">' + esc(cw[1]) + (w.label ? ' · ' + esc(w.label) : '') + '</div></div></div>' +
      '<div class="wx-meta">Feels ' + c.feelsLike + '° · H ' + today.high + '° L ' + today.low +
      '° · Wind ' + c.wind + ' ' + esc(c.windUnit) + '</div>';

    html += '<div class="wx-hours">';
    for (var i = 0; i < w.hourly.length && i < 12; i += 2) {
      var h = w.hourly[i];
      var hw = wall(h.time).getUTCHours();
      html += '<div class="wx-hour"><div>' + (i === 0 ? 'Now' : hour12(hw) + (hw < 12 ? 'a' : 'p')) + '</div>' +
        '<div class="i">' + wx(h.code, h.isDay)[0] + '</div><div class="t">' + h.temp + '°</div>' +
        '<div class="p">' + (h.precip >= 20 ? h.precip + '%' : '') + '</div></div>';
    }
    html += '</div>';

    for (var d = 0; d < w.daily.length && d < 5; d++) {
      var day = w.daily[d];
      var name = d === 0 ? 'Today' : DAYS[new Date(day.date + 12 * 3600000).getUTCDay()].slice(0, 3);
      html += '<div class="wx-day"><span class="n">' + name + '</span><span class="i">' + wx(day.code)[0] + '</span>' +
        '<span class="p">' + (day.precip >= 20 ? day.precip + '%' : '') + '</span>' +
        '<span class="r">' + day.high + '°<span class="lo">' + day.low + '°</span></span></div>';
    }
    return html;
  }

  // ---- subway ----------------------------------------------------------------------------

  function bullet(route) {
    var r = String(route || '');
    var express = /^[0-9A-Z]X$/.test(r);
    if (express) r = r.charAt(0);
    if (r === 'GS' || r === 'FS' || r === 'H' || r === 'SR') r = 'S';
    if (r === 'SI') r = 'SIR';
    var color = ROUTE_COLORS[r] || '#808183';
    var label = r === 'SIR' ? 'SI' : r;
    return '<span class="bullet' + (DARK_TEXT[r] ? ' dark' : '') + (express ? ' express' : '') +
      '" style="background:' + color + '"><span>' + esc(label) + '</span></span>';
  }

  function renderSubway(s) {
    if (!s || s.error) return errorHtml('Subway', s);
    var t = now();
    var html = '';
    s.stops.forEach(function (stop) {
      html += '<div class="stop"><div class="stop-name">' + esc(stop.label) +
        (stop.direction ? ' <span class="dir">→ ' + esc(stop.direction) + '</span>' : '') + '</div><div class="arrivals">';
      var shown = 0;
      stop.arrivals.forEach(function (a) {
        var mins = Math.floor((a.time - t) / 60000);
        if (mins < 0) return;
        shown++;
        html += '<div class="arrival' + (mins === 0 ? ' now' : '') + '">' + bullet(a.route) +
          '<span class="min">' + (mins === 0 ? 'now' : mins + '<small>min</small>') + '</span></div>';
      });
      if (!shown) html += '<span class="muted">No trains scheduled</span>';
      html += '</div></div>';
    });
    (s.alerts || []).forEach(function (al) {
      html += '<div class="alert">' + al.routes.map(bullet).join('') + ' ' + esc(truncate(al.text, 140)) + '</div>';
    });
    return html + staleHtml(s);
  }

  // ---- citi bike -------------------------------------------------------------------------

  function renderCitiBike(c) {
    if (!c || c.error) return errorHtml('Citi Bike', c);
    if (!c.stations.length) return '<span class="muted">No stations configured</span>';
    var html = '<div class="cb-head"><span></span><span>Bikes</span><span>E-bikes</span><span>Docks</span></div>';
    c.stations.forEach(function (st) {
      html += '<div class="station' + (st.active ? '' : ' closed') + '"><span class="name">' + esc(st.name) +
        (st.distance != null ? '<span class="dist">' + formatDistance(st.distance) + '</span>' : '') + '</span>' +
        '<span class="count">' + st.classic + '</span>' +
        '<span class="count ebike">' + st.ebikes + '</span>' +
        '<span class="count">' + st.docks + '</span></div>';
    });
    return html + staleHtml(c);
  }

  function formatDistance(m) {
    var ft = m * 3.28084;
    return ft < 1000 ? Math.round(ft / 10) * 10 + ' ft' : (m / 1609.34).toFixed(1) + ' mi';
  }

  // ---- calendar --------------------------------------------------------------------------

  function renderCalendar(c) {
    if (!c || c.error) return errorHtml('Calendar', c);
    var t = now();
    var html = '';
    c.days.forEach(function (day) {
      html += '<div class="day"><div class="day-label">' + esc(day.label) + '</div>';
      if (!day.events.length) html += '<div class="muted">Nothing scheduled</div>';
      day.events.forEach(function (ev) {
        var past = !ev.allDay && ev.end <= t && ev.end > ev.start;
        html += '<div class="event' + (past ? ' past' : '') + '"><span class="bar" style="background:' + esc(ev.color) + '"></span>' +
          '<span class="when">' + esc(ev.time) + '</span><div class="what"><div class="title">' + esc(ev.title) + '</div>' +
          (ev.location ? '<div class="loc">' + esc(ev.location.split('\n')[0]) + '</div>' : '') + '</div></div>';
      });
      html += '</div>';
    });
    (c.errors || []).forEach(function (e) { html += '<div class="error">' + esc(e) + '</div>'; });
    return html + staleHtml(c);
  }

  // ---- shared ----------------------------------------------------------------------------

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function errorHtml(name, src) {
    return '<div class="error">' + esc(name) + ' unavailable' + (src && src.error ? ': ' + esc(src.error) : '') + '</div>';
  }

  function staleHtml(src) {
    return src.stale ? '<div class="error">Showing older data: ' + esc(src.error || '') + '</div>' : '';
  }

  function set(id, html) {
    var el = document.getElementById(id);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }

  function renderClock() {
    var d = wall(now());
    var h = d.getUTCHours();
    set('time', hour12(h) + ':' + pad(d.getUTCMinutes()) + '<span class="ampm">' + (h < 12 ? 'AM' : 'PM') + '</span>');
    set('date', DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate());
    var night = NIGHT_START > NIGHT_END ? h >= NIGHT_START || h < NIGHT_END : h >= NIGHT_START && h < NIGHT_END;
    document.body.className = night ? 'night' : '';
  }

  function renderAll() {
    renderClock();
    if (!data) return;
    if ('weather' in data) set('weather', renderWeather(data.weather));
    if ('subway' in data) set('subway', renderSubway(data.subway));
    if ('citibike' in data) set('citibike', renderCitiBike(data.citibike));
    if ('calendar' in data) set('calendar', renderCalendar(data.calendar));
    var age = Math.round((Date.now() - lastOk) / 1000);
    var status = document.getElementById('status');
    var bad = age > POLL_MS / 1000 * 3;
    status.className = 'status' + (bad ? ' bad' : '');
    status.textContent = bad ? 'Offline · last update ' + Math.round(age / 60) + ' min ago' : '';
  }

  function poll() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'api/dashboard?t=' + Date.now());
    xhr.timeout = 20000;
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          data = JSON.parse(xhr.responseText);
          clockSkew = data.now - Date.now();
          lastOk = Date.now();
        } catch (e) { /* keep last data */ }
      }
      renderAll();
    };
    xhr.onerror = xhr.ontimeout = renderAll;
    xhr.send();
  }

  // Reload the whole page once a day so code updates on the server reach the frame.
  setTimeout(function () { location.reload(); }, 24 * 3600000);

  renderClock();
  poll();
  setInterval(poll, POLL_MS);
  setInterval(renderAll, 1000);
})();
