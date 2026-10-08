/* 奖金累计: count the total up from 0 the first time the card scrolls into view.
   The final number is already in the HTML (no-JS / reduced-motion keep it as is). */
(function () {
    var el = document.querySelector(".prize-pool-value[data-count-to]");
    if (!el || !("IntersectionObserver" in window)) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var to = parseFloat(el.dataset.countTo) || 0;
    var prec = parseInt(el.dataset.precision, 10) || 0;
    var final = el.textContent;
    var fmt = function (v) {
        return v.toLocaleString("en-US", { minimumFractionDigits: prec, maximumFractionDigits: prec });
    };
    var run = function () {
        var t0 = null, dur = 1100;
        var step = function (t) {
            if (t0 === null) t0 = t;
            var k = Math.min((t - t0) / dur, 1);
            var e = 1 - Math.pow(1 - k, 3);             /* ease-out cubic */
            el.textContent = k < 1 ? fmt(to * e) : final;
            if (k < 1) requestAnimationFrame(step);
        };
        el.textContent = fmt(0);
        requestAnimationFrame(step);
    };
    var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); run(); }
    }, { threshold: 0.6 });
    io.observe(el);
})();
