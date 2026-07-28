/* app-shell.js — populates the shared sidebar (hotel name, user card) and
   provides a toast() popup system. Self-contained; reads Firebase auth/user.
   Safe to include on every manager/staff page. No page logic touched. */
(function () {
    // ---------------- TOAST SYSTEM ----------------
    // Inject self-contained styles so toasts work even if app-shell.css is
    // missing or an old cached version is loaded.
    function ensureToastStyles() {
        if (document.getElementById('as-toast-style')) return;
        const st = document.createElement('style');
        st.id = 'as-toast-style';
        st.textContent = `
        #as-toast-root{position:fixed;top:22px;right:22px;z-index:2147483647;display:flex;flex-direction:column;gap:12px;pointer-events:none;max-width:min(380px,calc(100vw - 44px));font-family:'Inter',system-ui,sans-serif;}
        .as-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:12px;background:#fff;color:#1a2230;border:1px solid #e6eaf1;border-left:4px solid #64708a;border-radius:12px;padding:14px 14px 14px 16px;box-shadow:0 16px 40px rgba(23,26,38,.18);font-size:.9rem;line-height:1.4;transform:translateX(120%);opacity:0;transition:transform .28s cubic-bezier(.16,1,.3,1),opacity .28s;}
        .as-toast--in{transform:translateX(0);opacity:1;}
        .as-toast--out{transform:translateX(120%);opacity:0;}
        .as-toast__icon{flex-shrink:0;width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;color:#fff;margin-top:1px;}
        .as-toast__icon svg{width:14px;height:14px;}
        .as-toast__msg{flex:1 1 auto;font-weight:500;word-break:break-word;}
        .as-toast__close{flex-shrink:0;border:none;background:none;color:#64708a;font-size:1.3rem;line-height:1;cursor:pointer;padding:0 2px;opacity:.6;}
        .as-toast__close:hover{opacity:1;}
        .as-toast--success{border-left-color:#16a34a;} .as-toast--success .as-toast__icon{background:#16a34a;}
        .as-toast--error{border-left-color:#dc2626;} .as-toast--error .as-toast__icon{background:#dc2626;}
        .as-toast--warning{border-left-color:#d97706;} .as-toast--warning .as-toast__icon{background:#d97706;}
        .as-toast--info{border-left-color:#6366f1;} .as-toast--info .as-toast__icon{background:#6366f1;}`;
        (document.head || document.documentElement).appendChild(st);
    }
    function ensureToastRoot() {
        ensureToastStyles();
        let root = document.getElementById('as-toast-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'as-toast-root';
            root.className = 'as-toast-root';
            (document.body || document.documentElement).appendChild(root);
        }
        return root;
    }
    const ICONS = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg>',
        error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };
    function toast(message, type, opts) {
        type = type || 'info'; opts = opts || {};
        const root = ensureToastRoot();
        const el = document.createElement('div');
        el.className = 'as-toast as-toast--' + type;
        el.innerHTML =
            '<span class="as-toast__icon">' + (ICONS[type] || ICONS.info) + '</span>' +
            '<span class="as-toast__msg"></span>' +
            '<button class="as-toast__close" aria-label="Dismiss">&times;</button>';
        el.querySelector('.as-toast__msg').textContent = message;
        root.appendChild(el);
        requestAnimationFrame(() => el.classList.add('as-toast--in'));
        const dur = opts.duration || (type === 'error' ? 6000 : 3800);
        const timer = setTimeout(() => remove(), dur);
        function remove() {
            clearTimeout(timer);
            el.classList.remove('as-toast--in');
            el.classList.add('as-toast--out');
            setTimeout(() => el.remove(), 260);
        }
        el.querySelector('.as-toast__close').addEventListener('click', remove);
        return el;
    }
    // expose globally + convenience helpers
    window.toast = toast;
    window.notify = {
        success: (m, o) => toast(m, 'success', o),
        error:   (m, o) => toast(m, 'error', o),
        warning: (m, o) => toast(m, 'warning', o),
        info:    (m, o) => toast(m, 'info', o)
    };

    // Upgrade every existing alert() to a styled toast automatically, so all
    // pages get nice popups without changing their logic. Type is inferred
    // from the message wording (✅/success -> success, error/fail -> error).
    const _nativeAlert = (typeof window.alert === 'function') ? window.alert.bind(window) : function(){};
    window.alert = function (message) {
        try {
            const msg = String(message == null ? '' : message);
            const low = msg.toLowerCase();
            let type = 'info';
            if (/✅|success|added|created|updated|saved|logged|deleted|removed|complete|generated|marked/.test(low)) type = 'success';
            else if (/error|fail|invalid|cannot|could not|denied|permission|not found|unable|wrong|please (enter|fill|check|add|select)|must|required/.test(low)) type = 'error';
            else if (/⚠|warning|already|no |empty/.test(low)) type = 'warning';
            // strip common leading emojis for a cleaner look
            const clean = msg.replace(/^\s*(✅|❌|⚠️|🔒|🚪|✏️|🗑️|ℹ️)\s*/,'').trim();
            toast(clean || msg, type);
        } catch (e) { _nativeAlert(message); }
    };

    // ---------------- SIDEBAR POPULATION ----------------
    function initials(str) {
        return (str || 'U').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';
    }
    function fillSidebar(data) {
        if (!data) return;
        const hotel = data.businessName || data.hotelName || 'Hotel';
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        set('asHotelName', hotel);
        set('asHotelInitial', (hotel.trim()[0] || 'H').toUpperCase());
        set('asUserName', data.name || data.username || 'User');
        const role = (data.role || 'manager');
        set('asUserRole', role.charAt(0).toUpperCase() + role.slice(1));
        const av = document.getElementById('avatarInitials');
        if (av && !av.dataset.filled) { av.textContent = initials(data.name || data.username || hotel); }
        // Hide "Staff Accounts" nav for staff (manager-only)
        if (role === 'staff') {
            document.querySelectorAll('[data-requires="manager"]').forEach(el => { el.style.display = 'none'; });
        }
    }
    // Wait for firebase to be ready, then read the current user's doc.
    function boot() {
        if (typeof firebase === 'undefined' || !firebase.auth) { return; }
        try {
            firebase.auth().onAuthStateChanged(function (user) {
                if (!user) return;
                firebase.firestore().collection('users').doc(user.uid).get()
                    .then(doc => { if (doc.exists) fillSidebar(doc.data()); })
                    .catch(() => {});
            });
        } catch (e) { /* ignore */ }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    // ---------------- DASHBOARD HERO (date/time + stat mirror) ----------------
    function initHero() {
        const day = document.getElementById('heroDay');
        if (!day) return; // not the dashboard
        function tick() {
            const now = new Date();
            const opts = { weekday: 'long' };
            const d = document.getElementById('heroDay');
            const dt = document.getElementById('heroDate');
            const tm = document.getElementById('heroTime');
            if (d) d.textContent = now.toLocaleDateString(undefined, { weekday: 'long' });
            if (dt) dt.textContent = now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
            if (tm) tm.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        }
        tick(); setInterval(tick, 30000);

        // Mirror the real stat cards into the hero pills whenever they change.
        const pairs = [['staffCount','heroStaff'], ['roomCount','heroRooms'], ['occupiedRooms','heroOccupied']];
        function mirror() {
            pairs.forEach(([src, dst]) => {
                const a = document.getElementById(src), b = document.getElementById(dst);
                if (a && b) b.textContent = a.textContent;
            });
        }
        mirror();
        // observe source cards for updates
        pairs.forEach(([src]) => {
            const el = document.getElementById(src);
            if (el && window.MutationObserver) new MutationObserver(mirror).observe(el, { childList: true, characterData: true, subtree: true });
        });
        // also re-mirror periodically as a safety net
        setInterval(mirror, 1500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHero);
    else initHero();
})();
