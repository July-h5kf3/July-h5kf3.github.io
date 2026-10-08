/*
 * Archive page activity heatmap (layouts/_partials/archives/activity.html).
 * Vanilla JS, no dependencies. Data: JSON array of events embedded by Hugo:
 *   { d: "YYYY-MM-DD", k: "pub"|"upd", title, full, url, track, trackKey, tag, tagUrl }
 */
(function () {
    "use strict";

    var root = document.querySelector("[data-activity]");
    if (!root) return;

    var events = [];
    try {
        events = JSON.parse(root.querySelector("[data-activity-json]").textContent) || [];
    } catch (e) {
        events = [];
    }

    var grid = root.querySelector("[data-grid]");
    var scroller = root.querySelector("[data-scroll]");
    var tip = root.querySelector("[data-tip]");
    var panel = root.querySelector("[data-panel]");
    var summary = root.querySelector("[data-summary]");
    var yearsBox = root.querySelector("[data-years]");

    var WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
    var MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

    /* ---- index events by day ---- */
    var byDay = Object.create(null);
    var years = Object.create(null);
    events.forEach(function (ev) {
        (byDay[ev.d] = byDay[ev.d] || []).push(ev);
        years[ev.d.slice(0, 4)] = true;
    });

    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function key(dt) { return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate()); }
    function addDays(dt, n) { var x = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); x.setDate(x.getDate() + n); return x; }
    function mondayIndex(dt) { return (dt.getDay() + 6) % 7; } // Mon = 0 … Sun = 6
    function level(n) { return n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4; }
    function counts(list) {
        var c = { pub: 0, upd: 0 };
        (list || []).forEach(function (ev) { c[ev.k === "upd" ? "upd" : "pub"]++; });
        return c;
    }
    function describe(c) {
        var parts = [];
        if (c.pub) parts.push(c.pub + " 篇发布");
        if (c.upd) parts.push(c.upd + " 篇更新");
        return parts.length ? parts.join("，") : "没有动态";
    }
    function el(tag, cls, text) {
        var x = document.createElement(tag);
        if (cls) x.className = cls;
        if (text != null) x.textContent = text;
        return x;
    }

    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var todayKey = key(today);

    var mode = "recent";
    var selected = null;

    /* ---- range for the current mode: [start (Monday), end] + visible window ---- */
    function range() {
        var from, to;
        if (mode === "recent") {
            to = today;
            from = addDays(today, -364);
        } else {
            var y = +mode;
            from = new Date(y, 0, 1);
            to = new Date(y, 11, 31);
        }
        var start = addDays(from, -mondayIndex(from));
        var weeks = Math.ceil((Math.round((to - start) / 864e5) + 1) / 7);
        return { from: from, to: to, start: start, weeks: weeks };
    }

    /* ---- size cells to fill the card; below the minimum the grid scrolls ---- */
    function fit(weeks) {
        var gap = 3, label = 26;
        var avail = scroller.clientWidth - label - 2;
        var cell = Math.floor((avail - gap * weeks) / weeks);
        cell = Math.max(11, Math.min(15, cell));
        grid.style.setProperty("--hm-cell", cell + "px");
        grid.style.setProperty("--hm-gap", gap + "px");
        grid.style.setProperty("--hm-weeks", weeks);
    }

    /* month (0–11) whose 1st falls in the week starting `monday` and inside the range, else -1 */
    function firstOfMonthIn(monday, fromKey, toKey) {
        for (var j = 0; j < 7; j++) {
            var dj = addDays(monday, j), kj = key(dj);
            if (dj.getDate() === 1 && kj >= fromKey && kj <= toKey) return dj.getMonth();
        }
        return -1;
    }

    function render() {
        var r = range();
        grid.textContent = "";
        fit(r.weeks);

        var fromKey = key(r.from), toKey = key(r.to);
        var total = { pub: 0, upd: 0 }, activeDays = 0;
        var lastMonthCol = -10;

        var corner = el("span", "hm-wday hm-corner"); // masks month labels scrolled under the sticky weekday column
        corner.style.gridRow = "1";
        grid.appendChild(corner);

        ["一", "", "三", "", "五", "", ""].forEach(function (t, i) {
            if (!t) return;
            var lab = el("span", "hm-wday", t);
            lab.style.gridRow = String(i + 2);
            grid.appendChild(lab);
        });

        for (var w = 0; w < r.weeks; w++) {
            for (var d = 0; d < 7; d++) {
                var day = addDays(r.start, w * 7 + d);
                var k = key(day);

                /* month label above the column containing the 1st of a month */
                if (d === 0) {
                    var mon = firstOfMonthIn(day, fromKey, toKey);
                    if (w === 0 && mon < 0 && firstOfMonthIn(addDays(day, 7), fromKey, toKey) < 0 &&
                        firstOfMonthIn(addDays(day, 14), fromKey, toKey) < 0) {
                        mon = r.from.getMonth(); // leading partial month
                    }
                    if (mon >= 0 && w - lastMonthCol >= 3) {
                        var m = el("span", "hm-month", MONTHS[mon]);
                        m.style.gridColumn = (w + 2) + " / span 3";
                        grid.appendChild(m);
                        lastMonthCol = w;
                    }
                }

                var out = k < fromKey || k > toKey;
                var future = k > todayKey;
                var cell;
                if (out) {
                    cell = el("span", "hm-cell is-out");
                } else {
                    var list = byDay[k] || [];
                    var c = counts(list);
                    var n = list.length;
                    if (n) { activeDays++; total.pub += c.pub; total.upd += c.upd; }
                    cell = el("button", "hm-cell hm-l" + level(n) + (future ? " is-future" : "") + (k === selected ? " is-selected" : ""));
                    cell.type = "button";
                    cell.dataset.date = k;
                    cell.tabIndex = n ? 0 : -1;
                    cell.setAttribute("aria-label", k + "，" + describe(c));
                    if (future) cell.disabled = true;
                }
                cell.style.gridColumn = String(w + 2);
                cell.style.gridRow = String(d + 2);
                grid.appendChild(cell);
            }
        }

        var scope = mode === "recent" ? "近一年" : mode + " 年";
        var parts = [total.pub + " 篇发布"];
        if (total.upd) parts.push(total.upd + " 次更新");
        parts.push(activeDays + " 个活跃日");
        summary.innerHTML = "";
        summary.appendChild(el("strong", null, scope));
        summary.appendChild(document.createTextNode(" · " + parts.join(" · ")));

        if (mode === "recent") scroller.scrollLeft = scroller.scrollWidth;
        else scroller.scrollLeft = 0;
    }

    /* ---- year switcher (only when content spans more than one year) ---- */
    var yearList = Object.keys(years).sort().reverse();
    if (yearList.length > 1) {
        yearsBox.hidden = false;
        ["recent"].concat(yearList).forEach(function (y) {
            var b = el("button", "activity-year" + (y === mode ? " is-active" : ""), y === "recent" ? "近一年" : y);
            b.type = "button";
            b.setAttribute("aria-pressed", y === mode ? "true" : "false");
            b.addEventListener("click", function () {
                mode = y;
                Array.prototype.forEach.call(yearsBox.children, function (x) {
                    var on = x === b;
                    x.classList.toggle("is-active", on);
                    x.setAttribute("aria-pressed", on ? "true" : "false");
                });
                hideTip();
                render();
            });
            yearsBox.appendChild(b);
        });
    }

    /* ---- tooltip ---- */
    function showTip(cell) {
        var k = cell.dataset.date;
        tip.textContent = k + " · " + describe(counts(byDay[k]));
        tip.hidden = false;
        var cr = cell.getBoundingClientRect();
        var rr = root.getBoundingClientRect();
        var tw = tip.offsetWidth;
        var x = cr.left - rr.left + cr.width / 2 - tw / 2;
        x = Math.max(6, Math.min(x, rr.width - tw - 6));
        tip.style.left = x + "px";
        tip.style.top = (cr.top - rr.top - tip.offsetHeight - 8) + "px";
        tip.style.setProperty("--tip-arrow", (cr.left - rr.left + cr.width / 2 - x) + "px");
    }
    function hideTip() { tip.hidden = true; }

    grid.addEventListener("mouseover", function (e) {
        var c = e.target.closest(".hm-cell[data-date]");
        if (c) showTip(c);
    });
    grid.addEventListener("mouseleave", hideTip);
    grid.addEventListener("focusin", function (e) {
        var c = e.target.closest(".hm-cell[data-date]");
        if (c) showTip(c);
    });
    grid.addEventListener("focusout", hideTip);
    scroller.addEventListener("scroll", hideTip, { passive: true });

    /* ---- day panel ---- */
    function renderPanel(k) {
        panel.textContent = "";
        if (!k) { panel.hidden = true; return; }
        var list = byDay[k] || [];
        var parts = k.split("-");
        var dt = new Date(+parts[0], +parts[1] - 1, +parts[2]);

        var head = el("div", "heatmap-day-head");
        head.appendChild(el("strong", null, k));
        head.appendChild(el("span", "heatmap-day-week", WEEKDAYS[mondayIndex(dt)]));
        head.appendChild(el("span", "heatmap-day-count", list.length ? describe(counts(list)) : "没有动态"));
        var close = el("button", "heatmap-day-close", "×");
        close.type = "button";
        close.setAttribute("aria-label", "关闭");
        close.addEventListener("click", function () { select(null); });
        head.appendChild(close);
        panel.appendChild(head);

        if (!list.length) {
            var empty = el("p", "heatmap-day-empty", "这一天没有发布或更新文章，换个有颜色的格子看看吧。");
            panel.appendChild(empty);
        } else {
            var ul = el("ul", "heatmap-day-list");
            list.slice().sort(function (a, b) { return a.k === b.k ? 0 : a.k === "pub" ? -1 : 1; }).forEach(function (ev) {
                var li = el("li", "heatmap-day-item");
                li.appendChild(el("span", "news-kind news-kind--" + (ev.k === "upd" ? "upd" : "pub"), ev.k === "upd" ? "更新" : "发布"));
                var a = el("a", "heatmap-day-title");
                a.href = ev.url;
                a.title = ev.full;
                if (ev.track) a.appendChild(el("span", "track-tag track-" + (ev.trackKey || "other"), ev.track));
                a.appendChild(el("span", null, ev.title));
                li.appendChild(a);
                if (ev.tag) {
                    var t = el("a", "news-tag", ev.tag);
                    t.href = ev.tagUrl;
                    li.appendChild(t);
                }
                ul.appendChild(li);
            });
            panel.appendChild(ul);
        }
        panel.hidden = false;
    }

    function select(k) {
        selected = k;
        Array.prototype.forEach.call(grid.querySelectorAll(".hm-cell.is-selected"), function (c) { c.classList.remove("is-selected"); });
        if (k) {
            var c = grid.querySelector('.hm-cell[data-date="' + k + '"]');
            if (c) c.classList.add("is-selected");
        }
        root.classList.toggle("has-selection", !!k);
        renderPanel(k);
    }

    grid.addEventListener("click", function (e) {
        var c = e.target.closest(".hm-cell[data-date]");
        if (!c || c.disabled) return;
        showTip(c);
        select(selected === c.dataset.date ? null : c.dataset.date);
    });

    document.addEventListener("click", function (e) {
        if (!tip.hidden && !e.target.closest(".hm-cell")) hideTip();
    });

    var resizeTimer;
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { fit(range().weeks); }, 120);
    });

    render();
})();
