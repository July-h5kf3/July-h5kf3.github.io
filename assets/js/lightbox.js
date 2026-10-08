/* Minimal image lightbox for a[data-lightbox] (About page certificates).
   Native <dialog>; Esc / click backdrop / × closes, ←/→ switches. No deps. */
(function () {
    var links = Array.prototype.slice.call(document.querySelectorAll("a[data-lightbox]"));
    if (!links.length || typeof HTMLDialogElement === "undefined") return;

    var dlg = document.createElement("dialog");
    dlg.className = "lightbox";
    dlg.innerHTML =
        '<figure class="lightbox-figure"><img class="lightbox-img" alt=""><figcaption class="lightbox-caption"></figcaption></figure>' +
        '<button type="button" class="lightbox-btn lightbox-close" aria-label="关闭">×</button>' +
        '<button type="button" class="lightbox-btn lightbox-prev" aria-label="上一张">‹</button>' +
        '<button type="button" class="lightbox-btn lightbox-next" aria-label="下一张">›</button>';
    document.body.appendChild(dlg);
    var img = dlg.querySelector(".lightbox-img");
    var cap = dlg.querySelector(".lightbox-caption");
    var cur = 0;

    function show(i) {
        cur = (i + links.length) % links.length;
        var a = links[cur];
        img.src = a.href;
        img.alt = a.title || "";
        if (a.dataset.w) { img.width = a.dataset.w; img.height = a.dataset.h; }
        cap.textContent = a.title || "";
        dlg.classList.toggle("is-single", links.length < 2);
    }
    links.forEach(function (a, i) {
        a.addEventListener("click", function (e) {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            show(i);
            dlg.showModal();
        });
    });
    dlg.querySelector(".lightbox-close").addEventListener("click", function () { dlg.close(); });
    dlg.querySelector(".lightbox-prev").addEventListener("click", function () { show(cur - 1); });
    dlg.querySelector(".lightbox-next").addEventListener("click", function () { show(cur + 1); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg || e.target.classList.contains("lightbox-figure")) dlg.close(); });
    dlg.addEventListener("keydown", function (e) {
        if (e.key === "ArrowLeft") show(cur - 1);
        else if (e.key === "ArrowRight") show(cur + 1);
    });
    dlg.addEventListener("close", function () { img.removeAttribute("src"); });
})();
