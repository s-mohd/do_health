// ---- GLOBAL PATIENT WATCHER ----
window.do_health = window.do_health || {};
do_health.patientWatcher = (function () {
    const STORAGE_KEY = "do_health_active_patient";
    const handlers = new Set();
    let last = null;
    let poller = null;

    function read() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function notify(current) {
        handlers.forEach(fn => {
            try {
                fn(current);
            } catch (err) {
                console.warn("[patientWatcher] callback failed:", err);
            }
        });
    }

    function check() {
        const current = read();
        const same = JSON.stringify(current) === JSON.stringify(last);
        if (!same) {
            last = current;
            notify(current);
        }
    }

    function start() {
        stop();
        last = read();
        window.addEventListener("storage", e => {
            if (e.key === STORAGE_KEY) check();
        });
        poller = setInterval(check, 1500); // fallback for same-tab updates
    }

    function stop() {
        if (poller) clearInterval(poller);
    }

    function subscribe(fn) {
        if (typeof fn === "function") handlers.add(fn);
        check(); // run immediately
        return () => handlers.delete(fn);
    }

    return { start, stop, subscribe, read };
})();
do_health.patientWatcher.start();