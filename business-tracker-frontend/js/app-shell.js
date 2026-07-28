/* app-shell.js — populates the shared sidebar (hotel name, user card) and
   provides a toast() popup system. Self-contained; reads Firebase auth/user.
   Safe to include on every manager/staff page. No page logic touched. */
(function () {
    // ---------------- TOAST SYSTEM ----------------
    function ensureToastRoot() {
        let root = document.getElementById('as-toast-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'as-toast-root';
            root.className = 'as-toast-root';
            document.body.appendChild(root);
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
    const _nativeAlert = window.alert.bind(window);
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
})();
