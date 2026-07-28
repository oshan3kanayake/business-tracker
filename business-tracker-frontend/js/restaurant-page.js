(function () {
    const state = {
        mode: document.body.dataset.mode || 'manager',
        user: null,
        userData: null,
        hotelId: null,
        hotelName: '',
        orders: [],
        editingId: null,
        displayCurrency: 'LKR',
        exchangeRate: null,
        activeGuests: [], // { bookingId, name, nic, roomNumber }
        menuItems: []     // { id, name, price } saved restaurant menu
    };

    const auth = firebase.auth();
    const db = firebase.firestore();
    const canManage = () => state.mode === 'manager' && state.userData && (state.userData.role === 'manager' || state.userData.role === 'staff');
    const canDownload = () => state.mode === 'owner' || (state.userData && state.userData.role !== 'staff');
    const byId = id => document.getElementById(id);

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[char]);
    }

    function getDisplayAmount(amount, originalCurrency) {
        const original = FinanceUtils.normalizeCurrency(originalCurrency);
        return FinanceUtils.convertAmountOrUnavailable(
            amount,
            original,
            state.displayCurrency,
            state.exchangeRate && state.exchangeRate.rate
        );
    }

    function formatDisplayAmount(amount, originalCurrency) {
        const original = FinanceUtils.normalizeCurrency(originalCurrency);
        if (!state.exchangeRate && original !== state.displayCurrency) {
            return FinanceUtils.formatMoney(amount, original);
        }
        return FinanceUtils.formatMoney(getDisplayAmount(amount, original), state.displayCurrency);
    }

    async function loadRate() {
        const rateLabel = byId('exchangeRateLabel');
        try {
            state.exchangeRate = await ExchangeRateService.loadUsdToLkrRate(db);
            if (rateLabel) rateLabel.textContent = ExchangeRateService.describeRate(state.exchangeRate);
        } catch (error) {
            state.exchangeRate = null;
            if (rateLabel) {
                rateLabel.textContent = `Exchange rate unavailable: ${error.message}`;
                rateLabel.classList.add('error');
            }
        }
        renderOrders();
    }

    async function resolveHotel(user) {
        const userSnapshot = await db.collection('users').doc(user.uid).get();
        if (!userSnapshot.exists) throw new Error('User profile was not found.');
        state.userData = userSnapshot.data();

        if (state.mode === 'owner') {
            if (state.userData.role !== 'owner') throw new Error('Owner access is required.');
            state.hotelId = localStorage.getItem('selectedHotelId');
            state.hotelName = localStorage.getItem('selectedHotelName') || '';
            if (!state.hotelId) {
                window.location.href = 'owner-select-hotel.html';
                return false;
            }
        } else {
            if (!['manager', 'staff'].includes(state.userData.role)) throw new Error('Manager or staff access is required.');
            state.hotelId = state.userData.role === 'staff' ? state.userData.hotelId : user.uid;
            state.hotelName = state.userData.businessName || state.userData.hotelName || '';
            if (!state.hotelId) throw new Error('No hotel is assigned to this account.');
        }
        return true;
    }

    async function loadOrders() {
        const snapshot = await db.collection('restaurantOrders').where('hotelId', '==', state.hotelId).get();
        state.orders = [];
        snapshot.forEach(doc => state.orders.push({ id: doc.id, ...doc.data() }));
        state.orders.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.orderNumber || '').localeCompare(a.orderNumber || ''));
        renderOrders();
    }

    function filteredOrders() {
        const status = byId('statusFilter').value;
        const currency = byId('currencyFilter').value;
        const startDate = byId('startDateFilter').value;
        const endDate = byId('endDateFilter').value;
        return state.orders.filter(order => {
            if (status !== 'all' && (order.paymentStatus || 'pending') !== status) return false;
            if (!FinanceUtils.matchesOriginalCurrency(order, currency)) return false;
            if (startDate && order.date < startDate) return false;
            if (endDate && order.date > endDate) return false;
            return true;
        });
    }

    function renderOrders() {
        const tableBody = byId('restaurantTableBody');
        if (!tableBody) return;
        const filtered = filteredOrders();
        const paidTotal = filtered
            .filter(order => order.paymentStatus === 'paid')
            .reduce((sum, order) => sum + getDisplayAmount(order.totalAmount, order.currency), 0);

        byId('orderCount').textContent = String(filtered.length);
        byId('paidTotal').textContent = FinanceUtils.formatMoney(paidTotal, state.displayCurrency);

        if (!filtered.length) {
            tableBody.innerHTML = '<tr><td colspan="9" class="empty">No restaurant orders match these filters.</td></tr>';
            return;
        }

        tableBody.innerHTML = filtered.map((order, index) => {
            const items = Array.isArray(order.items) ? order.items : [];
            const itemSummary = items.map(item => `${escapeHtml(item.name)} × ${Number(item.quantity || 0)}`).join(', ');
            const actions = canManage() ? `
                <div class="row-actions">
                    <button class="btn secondary" type="button" data-action="edit" data-id="${order.id}">Edit</button>
                    <button class="btn danger" type="button" data-action="delete" data-id="${order.id}">Delete</button>
                </div>` : 'Read only';
            return `<tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(order.date || '—')}</td>
                <td><strong>${escapeHtml(order.orderNumber || order.id)}</strong><br>${escapeHtml(order.customerName || order.roomNumber || '')}</td>
                <td>${itemSummary || '—'}</td>
                <td>${FinanceUtils.normalizeCurrency(order.currency)}</td>
                <td>${formatDisplayAmount(order.totalAmount, order.currency)}</td>
                <td><span class="badge ${order.paymentStatus === 'paid' ? 'paid' : 'pending'}">${order.paymentStatus === 'paid' ? 'Paid' : 'Pending'}</span></td>
                <td>${escapeHtml(order.createdBy || '—')}</td>
                <td>${actions}</td>
            </tr>`;
        }).join('');
    }

    function setSuggestionOptions(id, entries) {
        const list = byId(id);
        if (!list) return;
        const seen = new Set();
        list.replaceChildren();
        entries.forEach(entry => {
            const value = String(entry && entry.value || '').trim();
            if (!value) return;
            const key = value.toLocaleLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            const option = document.createElement('option');
            option.value = value;
            if (entry.label) option.label = entry.label;
            list.appendChild(option);
        });
    }

    function uniqueSuggestionEntries(entries) {
        const seen = new Set();
        return entries.filter(entry => {
            const value = String(entry && entry.value || '').trim();
            const key = value.toLocaleLowerCase();
            if (!value || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async function loadReferenceSuggestions() {
        if (!canManage()) return;
        const queries = [
            db.collection('rooms').where('hotelId', '==', state.hotelId).get(),
            db.collection('bookings').where('hotelId', '==', state.hotelId).get(),
            db.collection('packages').where('hotelId', '==', state.hotelId).get(),
            db.collection('buffetItems').where('hotelId', '==', state.hotelId).get()
        ];
        const results = await Promise.allSettled(queries);
        const docsFor = result => result.status === 'fulfilled'
            ? result.value.docs.map(doc => doc.data())
            : [];
        results.filter(result => result.status === 'rejected').forEach(result => {
            console.warn('A restaurant reference suggestion source was unavailable:', result.reason?.message || result.reason);
        });

        const rooms = docsFor(results[0])
            .filter(room => room.roomNumber)
            .sort((a, b) => String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, { numeric: true, sensitivity: 'base' }))
            .map(room => ({
                value: String(room.roomNumber).trim(),
                label: [room.roomType, room.status].filter(Boolean).join(' · ')
            }));
        setSuggestionOptions('restaurantRoomOptions', uniqueSuggestionEntries(rooms));

        const bookings = docsFor(results[1]);

        // Build the "Link to guest" dropdown from active/checked-in guests.
        // We store the doc id, so re-map with ids:
        const bookingDocs = results[1].status === 'fulfilled' ? results[1].value.docs : [];
        state.activeGuests = bookingDocs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(b => b.guestName && (b.status === 'active' || b.status === 'upcoming'))
            .sort((a, b) => String(a.roomNumber || '').localeCompare(String(b.roomNumber || ''), undefined, { numeric: true }))
            .map(b => ({ bookingId: b.id, name: b.guestName, nic: b.nic || '', roomNumber: b.roomNumber || '', status: b.status }));
        const guestSelect = byId('guestLink');
        if (guestSelect) {
            const keepVal = guestSelect.value;
            guestSelect.innerHTML = '<option value="">🚶 Walk-in customer (no room)</option>' +
                state.activeGuests.map(g =>
                    `<option value="${g.bookingId}">${escapeHtml(g.name)}${g.roomNumber ? ' — Room ' + escapeHtml(String(g.roomNumber)) : ''}${g.nic ? ' — NIC ' + escapeHtml(g.nic) : ''}${g.status === 'upcoming' ? ' (arriving)' : ''}</option>`
                ).join('');
            guestSelect.value = keepVal;
        }

        const guests = bookings
            .filter(booking => booking.guestName && booking.status !== 'cancelled')
            .sort((a, b) => String(b.checkIn || '').localeCompare(String(a.checkIn || '')))
            .map(booking => ({
                value: String(booking.guestName).trim(),
                label: booking.roomNumber
                    ? (/^room\b/i.test(String(booking.roomNumber).trim()) ? String(booking.roomNumber).trim() : `Room ${booking.roomNumber}`)
                    : ''
            }));
        setSuggestionOptions('restaurantGuestOptions', uniqueSuggestionEntries(guests));

        const packages = docsFor(results[2])
            .filter(item => item.name)
            .map(item => ({
                value: String(item.name).trim(),
                label: Number.isFinite(Number(item.price)) ? `Meal package · LKR ${Number(item.price).toLocaleString()}` : 'Meal package'
            }));
        const buffetItems = docsFor(results[3]).flatMap(menu => Array.isArray(menu.items) ? menu.items : [])
            .filter(item => item && item.name)
            .map(item => ({ value: String(item.name).trim(), label: 'Buffet menu item' }));
        const previousOrderItems = state.orders.flatMap(order => Array.isArray(order.items) ? order.items : [])
            .filter(item => item && item.name)
            .map(item => ({ value: String(item.name).trim(), label: 'Previous restaurant item' }));
        setSuggestionOptions('restaurantItemOptions', uniqueSuggestionEntries([
            ...previousOrderItems,
            ...buffetItems,
            ...packages
        ]));
    }

    // Build the <option> list for the item dropdown from saved menu items.
    function menuOptionsHtml(selectedName) {
        const opts = ['<option value="">— Select item —</option>'];
        state.menuItems.forEach(m => {
            const sel = selectedName && m.name === selectedName ? 'selected' : '';
            opts.push(`<option value="${escapeHtml(m.name)}" data-price="${Number(m.price) || 0}" ${sel}>${escapeHtml(m.name)} — ${FinanceUtils.formatMoney(Number(m.price) || 0, 'LKR')}</option>`);
        });
        // Custom option: lets staff type a one-off item not on the menu.
        const isCustom = selectedName && !state.menuItems.some(m => m.name === selectedName);
        opts.push(`<option value="__custom__" ${isCustom ? 'selected' : ''}>✏️ Custom item…</option>`);
        return opts.join('');
    }

    function addItemRow(item) {
        const container = byId('itemsContainer');
        if (!container) return;
        const row = document.createElement('div');
        row.className = 'item-row';
        const presetName = item && item.name ? String(item.name) : '';
        const isCustom = presetName && !state.menuItems.some(m => m.name === presetName);
        row.innerHTML = `
            <div class="item-pick">
                <select class="item-select" required>${menuOptionsHtml(presetName)}</select>
                <input class="item-name-custom" type="text" placeholder="Custom item name" value="${escapeHtml(presetName)}" ${isCustom ? '' : 'hidden'} autocomplete="off">
            </div>
            <input class="item-quantity" type="number" min="1" step="1" value="${Number(item && item.quantity) || 1}" required>
            <input class="item-price" type="number" min="0" step="0.01" placeholder="Unit price" value="${item && Number.isFinite(Number(item.unitPrice)) ? Number(item.unitPrice) : ''}" ${isCustom ? '' : 'readonly'} required>
            <button class="icon-btn remove-item" type="button" aria-label="Remove item">Remove</button>`;
        container.appendChild(row);
        updateFormTotal();
    }

    // Reads item rows: name from dropdown (or custom input), price auto from menu.
    function readItems() {
        return Array.from(document.querySelectorAll('#itemsContainer .item-row')).map(row => {
            const sel = row.querySelector('.item-select');
            const val = sel ? sel.value : '';
            let name;
            if (val === '__custom__') name = (row.querySelector('.item-name-custom').value || '').trim();
            else name = val.trim();
            return {
                name,
                quantity: Number(row.querySelector('.item-quantity').value),
                unitPrice: Number(row.querySelector('.item-price').value)
            };
        }).filter(it => it.name);
    }

    function validItems(items) {
        return items.length > 0 && items.every(item => item.name && Number.isInteger(item.quantity) && item.quantity > 0 && Number.isFinite(item.unitPrice) && item.unitPrice >= 0);
    }

    function updateFormTotal() {
        const total = FinanceUtils.calculateRestaurantTotal(readItems());
        const currency = byId('orderCurrency') ? byId('orderCurrency').value : 'LKR';
        if (byId('formTotal')) byId('formTotal').textContent = FinanceUtils.formatMoney(total, currency);
    }

    function resetForm() {
        const form = byId('restaurantForm');
        if (!form) return;
        form.reset();
        state.editingId = null;
        byId('formTitle').textContent = 'Add Restaurant Order';
        byId('submitOrderBtn').textContent = 'Save Order';
        byId('cancelEditBtn').hidden = true;
        byId('orderDate').value = new Date().toISOString().slice(0, 10);
        byId('itemsContainer').innerHTML = '';
        addItemRow();
    }

    function editOrder(id) {
        if (!canManage()) return;
        const order = state.orders.find(item => item.id === id);
        if (!order) return;
        state.editingId = id;
        byId('formTitle').textContent = 'Edit Restaurant Order';
        byId('submitOrderBtn').textContent = 'Update Order';
        byId('cancelEditBtn').hidden = false;
        byId('orderDate').value = order.date || '';
        byId('orderNumber').value = order.orderNumber || '';
        byId('customerName').value = order.customerName || '';
        byId('roomNumber').value = order.roomNumber || '';
        if (byId('guestLink')) byId('guestLink').value = order.guestBookingId || '';
        byId('orderCurrency').value = FinanceUtils.normalizeCurrency(order.currency);
        byId('paymentStatus').value = order.paymentStatus || 'pending';
        byId('orderNotes').value = order.notes || '';
        byId('itemsContainer').innerHTML = '';
        (Array.isArray(order.items) && order.items.length ? order.items : [{}]).forEach(addItemRow);
        updateFormTotal();
        byId('restaurantFormPanel').scrollIntoView({ behavior: 'smooth' });
    }

    function openRequestedRestaurantSource() {
        const orderId = new URLSearchParams(window.location.search).get('editOrder');
        if (!orderId) return;
        history.replaceState(null, '', window.location.pathname);
        if (!canManage()) return;
        const order = state.orders.find(item => item.id === orderId && item.hotelId === state.hotelId);
        if (!order) {
            alert('The linked restaurant payment could not be found for this hotel.');
            return;
        }
        editOrder(orderId);
    }

    async function saveOrder(event) {
        event.preventDefault();
        if (!canManage()) return;
        const items = readItems();
        if (!validItems(items)) {
            alert('Add at least one valid item with a name, quantity, and non-negative price.');
            return;
        }

        const orderId = state.editingId;
        const orderRef = orderId
            ? db.collection('restaurantOrders').doc(orderId)
            : db.collection('restaurantOrders').doc();
        const finalOrderId = orderRef.id;
        const oldOrder = orderId ? state.orders.find(order => order.id === orderId) : null;
        const now = firebase.firestore.FieldValue.serverTimestamp();
        // Resolve the linked guest (if any) so the checkout page can group by NIC.
        const linkedGuest = state.activeGuests.find(g => g.bookingId === byId('guestLink').value);
        const order = {
            hotelId: state.hotelId,
            date: byId('orderDate').value,
            orderNumber: byId('orderNumber').value.trim() || finalOrderId.slice(0, 8).toUpperCase(),
            customerName: byId('customerName').value.trim(),
            roomNumber: byId('roomNumber').value.trim(),
            guestBookingId: linkedGuest ? linkedGuest.bookingId : '',
            guestNic: linkedGuest ? linkedGuest.nic : '',
            items,
            totalAmount: FinanceUtils.calculateRestaurantTotal(items),
            currency: FinanceUtils.normalizeCurrency(byId('orderCurrency').value),
            paymentStatus: byId('paymentStatus').value,
            notes: byId('orderNotes').value.trim(),
            createdBy: oldOrder && oldOrder.createdBy
                ? oldOrder.createdBy
                : (state.userData.name || state.userData.username || state.user.email || 'Unknown'),
            updatedAt: now
        };
        if (!order.date || order.totalAmount <= 0) {
            alert('Enter a valid date and a total greater than zero.');
            return;
        }

        const incomeRef = db.collection('income').doc(FinanceUtils.restaurantIncomeDocumentId(finalOrderId));
        const income = FinanceUtils.buildRestaurantIncome(finalOrderId, order);
        const batch = db.batch();
        if (orderId) batch.update(orderRef, order);
        else batch.set(orderRef, { ...order, createdAt: now });
        if (income) {
            batch.set(incomeRef, { ...income, updatedAt: now, createdAt: oldOrder ? (oldOrder.createdAt || now) : now }, { merge: true });
        } else {
            batch.delete(incomeRef);
        }

        const button = byId('submitOrderBtn');
        button.disabled = true;
        try {
            await batch.commit();
            resetForm();
            await loadOrders();
            alert(`Restaurant order ${orderId ? 'updated' : 'created'} successfully.`);
        } catch (error) {
            alert(`Unable to save restaurant order: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    }

    async function deleteOrder(id) {
        if (!canManage() || !confirm('Delete this restaurant order and any linked income?')) return;
        const order = state.orders.find(item => item.id === id);
        if (!order || order.hotelId !== state.hotelId) return;
        const batch = db.batch();
        batch.delete(db.collection('restaurantOrders').doc(id));
        batch.delete(db.collection('income').doc(FinanceUtils.restaurantIncomeDocumentId(id)));
        try {
            await batch.commit();
            await loadOrders();
        } catch (error) {
            alert(`Unable to delete restaurant order: ${error.message}`);
        }
    }

    function downloadReport() {
        if (!canDownload()) return;
        const orders = filteredOrders();
        if (!orders.length) return alert('No restaurant orders match the current filters.');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('landscape');
        doc.setFontSize(18);
        doc.text('Restaurant Orders Report', 14, 18);
        doc.setFontSize(9);
        doc.text(`Hotel: ${state.hotelName || state.hotelId}`, 14, 25);
        doc.text(ExchangeRateService.describeRate(state.exchangeRate), 14, 31);
        doc.text(`Display currency: ${state.displayCurrency}`, 14, 37);
        doc.autoTable({
            startY: 43,
            head: [['#', 'Date', 'Order', 'Customer / Room', 'Items', 'Paid Currency', `Amount (${state.displayCurrency})`, 'Payment']],
            body: orders.map((order, index) => [
                index + 1,
                order.date || '—',
                order.orderNumber || order.id,
                order.customerName || order.roomNumber || '—',
                (order.items || []).map(item => `${item.name} x${item.quantity}`).join(', '),
                FinanceUtils.normalizeCurrency(order.currency),
                FinanceUtils.formatAmountNumber(getDisplayAmount(order.totalAmount, order.currency), state.displayCurrency),
                order.paymentStatus || 'pending'
            ]),
            styles: { fontSize: 7 },
            headStyles: { fillColor: [85, 115, 115] }
        });
        doc.save(`restaurant-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    }

    function wireEvents() {
        // Some elements only exist on the manager page (form, logout, etc.).
        // Guard every listener so the shared script does not crash on the
        // owner (read-only) page.
        const on = (id, evt, handler) => {
            const el = byId(id);
            if (el) el.addEventListener(evt, handler);
        };

        ['statusFilter', 'currencyFilter', 'startDateFilter', 'endDateFilter'].forEach(id => on(id, 'change', renderOrders));
        on('displayCurrency', 'change', event => {
            state.displayCurrency = FinanceUtils.normalizeCurrency(event.target.value);
            renderOrders();
        });
        // When a checked-in guest is picked, auto-fill their name + room.
        on('guestLink', 'change', event => {
            const g = state.activeGuests.find(x => x.bookingId === event.target.value);
            if (g) {
                byId('customerName').value = g.name || '';
                if (g.roomNumber) byId('roomNumber').value = g.roomNumber;
            }
        });
        on('downloadReportBtn', 'click', downloadReport);
        on('logoutBtn', 'click', async () => {
            if (state.mode === 'owner') {
                localStorage.removeItem('selectedHotelId');
                localStorage.removeItem('selectedHotelName');
            }
            await auth.signOut();
            window.location.href = 'index.html';
        });

        const tableBody = byId('restaurantTableBody');
        if (tableBody) tableBody.addEventListener('click', event => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            if (button.dataset.action === 'edit') editOrder(button.dataset.id);
            if (button.dataset.action === 'delete') deleteOrder(button.dataset.id);
        });

        const form = byId('restaurantForm');
        if (form) {
            form.addEventListener('submit', saveOrder);
            byId('addItemBtn').addEventListener('click', () => addItemRow());
            byId('cancelEditBtn').addEventListener('click', resetForm);
            byId('orderCurrency').addEventListener('change', updateFormTotal);
            byId('itemsContainer').addEventListener('input', updateFormTotal);
            // When an item is picked from the dropdown, auto-fill its price.
            // "Custom item" reveals a name box and makes the price editable.
            byId('itemsContainer').addEventListener('change', event => {
                const sel = event.target.closest('.item-select');
                if (!sel) return;
                const row = sel.closest('.item-row');
                const nameBox = row.querySelector('.item-name-custom');
                const priceBox = row.querySelector('.item-price');
                if (sel.value === '__custom__') {
                    nameBox.hidden = false;
                    priceBox.readOnly = false;
                    priceBox.value = '';
                    nameBox.focus();
                } else {
                    nameBox.hidden = true;
                    nameBox.value = '';
                    const opt = sel.options[sel.selectedIndex];
                    const price = opt ? Number(opt.dataset.price || 0) : 0;
                    priceBox.value = price;
                    priceBox.readOnly = true;
                }
                updateFormTotal();
            });
            byId('itemsContainer').addEventListener('click', event => {
                const button = event.target.closest('.remove-item');
                if (!button) return;
                if (document.querySelectorAll('#itemsContainer .item-row').length === 1) return;
                button.closest('.item-row').remove();
                updateFormTotal();
            });

            // Menu manager: add item
            const menuForm = byId('menuItemForm');
            if (menuForm) menuForm.addEventListener('submit', addMenuItem);
            const menuList = byId('menuItemsList');
            if (menuList) menuList.addEventListener('click', event => {
                const del = event.target.closest('.mc-del');
                if (del) deleteMenuItem(del.dataset.id);
            });
            resetForm();
        }
    }

    // ---- Menu items (stored in buffetItems collection: {hotelId,name,price}) ----
    async function loadMenuItems() {
        try {
            const snap = await db.collection('buffetItems').where('hotelId', '==', state.hotelId).get();
            state.menuItems = snap.docs
                .map(d => ({ id: d.id, name: d.data().name, price: Number(d.data().price) || 0 }))
                .filter(m => m.name)
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (e) {
            console.warn('Could not load menu items:', e.message);
            state.menuItems = [];
        }
        renderMenuItems();
    }

    function renderMenuItems() {
        const list = byId('menuItemsList');
        if (!list) return;
        if (!state.menuItems.length) {
            list.innerHTML = '<span class="menu-empty">No menu items yet. Add your restaurant items above.</span>';
            return;
        }
        list.innerHTML = state.menuItems.map(m =>
            `<span class="menu-chip"><span class="mc-name">${escapeHtml(m.name)}</span><span class="mc-price">${FinanceUtils.formatMoney(m.price, 'LKR')}</span><button class="mc-del" type="button" data-id="${m.id}" title="Remove">✕</button></span>`
        ).join('');
    }

    async function addMenuItem(event) {
        event.preventDefault();
        const name = (byId('menuItemName').value || '').trim();
        const price = Number(byId('menuItemPrice').value);
        if (!name || !Number.isFinite(price) || price < 0) { alert('Enter an item name and a valid price.'); return; }
        if (state.menuItems.some(m => m.name.toLowerCase() === name.toLowerCase())) { alert('That item is already on the menu.'); return; }
        try {
            await db.collection('buffetItems').add({ hotelId: state.hotelId, name, price, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            byId('menuItemForm').reset();
            await loadMenuItems();
        } catch (e) { alert('Could not add menu item: ' + e.message); }
    }

    async function deleteMenuItem(id) {
        if (!confirm('Remove this item from the menu?')) return;
        try { await db.collection('buffetItems').doc(id).delete(); await loadMenuItems(); }
        catch (e) { alert('Could not remove item: ' + e.message); }
    }

    auth.onAuthStateChanged(async user => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        state.user = user;
        try {
            const resolved = await resolveHotel(user);
            if (!resolved) return;
            if (byId('hotelName')) byId('hotelName').textContent = state.hotelName || 'Selected Hotel';
            const profileName = state.userData.username || state.userData.businessName || state.user.email || 'User';
            if (byId('profileName')) byId('profileName').textContent = profileName;
            if (byId('avatarInitials')) {
                byId('avatarInitials').textContent = profileName.split(/\s+/).map(part => part[0]).join('').toUpperCase().slice(0, 2) || 'U';
            }
            if (!canManage() && byId('restaurantFormPanel')) byId('restaurantFormPanel').hidden = true;
            if (!canManage() && byId('menuPanel')) byId('menuPanel').hidden = true;
            if (!canDownload()) byId('downloadReportBtn').hidden = true;
            // Load the saved menu FIRST so the order item dropdown is populated
            // before the form's first item row is created in wireEvents().
            if (canManage()) await loadMenuItems();
            wireEvents();
            await Promise.all([loadOrders(), loadRate()]);
            openRequestedRestaurantSource();
            await loadReferenceSuggestions();
        } catch (error) {
            console.error(error);
            alert(error.message);
            window.location.href = state.mode === 'owner' ? 'owner-select-hotel.html' : 'index.html';
        }
    });
})();
