(() => {
  const STATUS_OPTIONS = ['bozza', 'in attesa', 'inviato', 'accettato', 'rifiutato'];

  const state = {
    products: [],
    quotes: [],
    editingProductId: null,
    searchTimer: null
  };

  const loginSection = document.getElementById('loginSection');
  const adminPanel = document.getElementById('adminPanel');

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    injectExtraStyles();
    await checkAuth();
  }

  function injectExtraStyles() {
    if (document.getElementById('quote-engine-admin-styles')) return;

    const style = document.createElement('style');
    style.id = 'quote-engine-admin-styles';
    style.textContent = `
      * { box-sizing: border-box; }
      .toolbar-row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
      .toolbar-row.space-between { justify-content:space-between; }
      .input,.select,.textarea {
        width:100%; padding:12px 14px; border:1px solid #d5d5d5; border-radius:12px;
        background:#fff; font-size:14px; outline:none;
      }
      .input:focus,.select:focus,.textarea:focus { border-color:#111; }
      .textarea { min-height:90px; resize:vertical; }
      .grid-2,.grid-3,.grid-4 { display:grid; gap:12px; }
      .grid-2 { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .grid-3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .grid-4 { grid-template-columns:repeat(4,minmax(0,1fr)); }

      .btn {
        border:0; border-radius:12px; padding:11px 14px; cursor:pointer;
        font-weight:700; font-size:14px;
      }
      .btn-primary { background:#111; color:#fff; }
      .btn-secondary { background:#ececec; color:#111; }
      .btn-danger { background:#b42318; color:#fff; }
      .btn-success { background:#067647; color:#fff; }

      .btn:disabled { opacity:.6; cursor:not-allowed; }
      .section-title { margin:0 0 10px; font-size:22px; }
      .muted { color:#666; font-size:14px; }

      .message {
        padding:12px 14px; border-radius:12px; margin-bottom:16px; font-size:14px;
      }
      .message.success { background:#ecfdf3; color:#067647; border:1px solid #abefc6; }
      .message.error { background:#fef3f2; color:#b42318; border:1px solid #fecdca; }
      .message.info { background:#f2f4f7; color:#344054; border:1px solid #d0d5dd; }

      .split-layout {
        display:grid; grid-template-columns:380px minmax(0,1fr); gap:18px;
      }
      .card-block {
        background:#fff; border:1px solid #ddd; border-radius:16px; padding:18px;
        box-shadow:0 4px 18px rgba(0,0,0,.04);
      }

      .table-wrap { overflow-x:auto; }
      table { width:100%; border-collapse:collapse; }
      th,td {
        text-align:left; padding:12px 10px; border-bottom:1px solid #eee;
        font-size:14px; vertical-align:top;
      }
      th {
        font-size:12px; letter-spacing:.03em; text-transform:uppercase; color:#666;
      }

      .actions { display:flex; gap:8px; flex-wrap:wrap; }
      .quote-list { display:grid; gap:14px; }
      .quote-card {
        border:1px solid #e5e7eb; border-radius:16px; padding:16px; background:#fff;
      }
      .quote-head {
        display:flex; gap:14px; justify-content:space-between; align-items:flex-start;
        flex-wrap:wrap; margin-bottom:12px;
      }
      .quote-title { margin:0; font-size:18px; }
      .quote-meta { display:grid; gap:4px; font-size:14px; color:#555; }

      .badge {
        display:inline-flex; align-items:center; gap:8px; padding:6px 10px;
        border-radius:999px; font-size:12px; font-weight:700; text-transform:uppercase;
      }
      .badge-bozza,.badge-in-attesa,.badge-inviato { background:#eff4ff; color:#175cd3; }
      .badge-accettato { background:#ecfdf3; color:#067647; }
      .badge-rifiutato { background:#fef3f2; color:#b42318; }

      .quote-items {
        margin-top:12px; border:1px solid #eee; border-radius:14px; overflow:hidden;
      }

      .quote-footer {
        display:flex; gap:12px; justify-content:space-between; align-items:center;
        flex-wrap:wrap; margin-top:14px;
      }
      .quote-total { font-size:18px; font-weight:800; }

      .empty-state {
        padding:24px; border:1px dashed #d0d5dd; border-radius:16px;
        text-align:center; color:#667085; background:#fafafa;
      }

      .login-box { max-width:430px; margin:50px auto; }
      .field-label {
        display:block; margin-bottom:6px; font-size:13px; font-weight:700; color:#444;
      }
      .inline-status { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }

      @media (max-width:980px) {
        .split-layout,.grid-2,.grid-3,.grid-4 { grid-template-columns:1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeString(value) {
    return String(value ?? '').trim();
  }

  function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function normalizePrice(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return round2(value);
    if (value == null) return 0;

    let text = String(value).replace(/€/g, '').replace(/\s+/g, '').trim();
    if (!text) return 0;

    const hasComma = text.includes(',');
    const hasDot = text.includes('.');

    if (hasComma && hasDot) {
      if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
        text = text.replace(/\./g, '').replace(',', '.');
      } else {
        text = text.replace(/,/g, '');
      }
    } else if (hasComma) {
      text = text.replace(',', '.');
    }

    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? round2(parsed) : 0;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR'
    }).format(normalizePrice(value));
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';

    return new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(date);
  }

  function slugify(value) {
    return normalizeString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function capitalize(value) {
    const text = normalizeString(value);
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function getProductId(product) {
    return product.id || product._id || product.code || product.sku || slugify(product.name || product.title || 'prodotto');
  }

  function getProductName(product) {
    return normalizeString(product.name || product.title || product.productName || '');
  }

  function getProductDescription(product) {
    return normalizeString(product.description || product.desc || product.details || '');
  }

  function getProductPrice(product) {
    return normalizePrice(product.price ?? product.prezzo ?? product.unitPrice ?? product.amount ?? 0);
  }

  function normalizeProduct(product) {
    return {
      ...product,
      id: getProductId(product),
      name: getProductName(product),
      description: getProductDescription(product),
      price: getProductPrice(product)
    };
  }

  function getQuoteId(quote) {
    return quote.id || quote._id || quote.quoteNumber || quote.number || quote.createdAt || String(Math.random());
  }

  function getQuoteItems(quote) {
    const items = quote.items || quote.products || quote.lines || [];
    return Array.isArray(items) ? items : [];
  }

  function getItemName(item) {
    return normalizeString(item.name || item.title || item.productName || item.label || 'Voce');
  }

  function getItemQuantity(item) {
    const quantity = Number(item.quantity ?? item.qty ?? item.qta ?? item.amount ?? 1);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  function getItemUnitPrice(item) {
    const directPrice = normalizePrice(
      item.unitPrice ?? item.price ?? item.prezzo ?? item.unit_price ?? item.amount
    );
    if (directPrice > 0) return directPrice;

    const qty = getItemQuantity(item);
    const total = normalizePrice(item.total ?? item.lineTotal ?? item.subtotal ?? item.importo);
    if (total > 0 && qty > 0) return round2(total / qty);

    return 0;
  }

  function getItemTotal(item) {
    const directTotal = normalizePrice(item.total ?? item.lineTotal ?? item.subtotal ?? item.importo);
    if (directTotal > 0) return directTotal;

    const qty = getItemQuantity(item);
    const unitPrice = getItemUnitPrice(item);
    return round2(qty * unitPrice);
  }

  function getQuoteTotal(quote) {
    const savedTotal = normalizePrice(quote.total ?? quote.totalAmount ?? quote.amount ?? quote.importoTotale);
    if (savedTotal > 0) return savedTotal;

    return round2(getQuoteItems(quote).reduce((sum, item) => sum + getItemTotal(item), 0));
  }

  function getQuoteNumber(quote) {
    return normalizeString(quote.quoteNumber || quote.number || quote.code || quote.id || '');
  }

  function getQuoteStatus(quote) {
    const raw = normalizeString(quote.status || 'bozza').toLowerCase();
    return STATUS_OPTIONS.includes(raw) ? raw : 'bozza';
  }

  function getQuoteCustomerName(quote) {
    const first = normalizeString(quote.firstName || quote.nome || '');
    const last = normalizeString(quote.lastName || quote.cognome || '');
    const full = `${first} ${last}`.trim();
    return full || normalizeString(quote.customerName || quote.clientName || 'Cliente senza nome');
  }

  function getQuoteCompany(quote) {
    return normalizeString(quote.company || quote.companyName || quote.azienda || '');
  }

  function getQuoteEmail(quote) {
    return normalizeString(quote.email || quote.mail || '');
  }

  function getQuotePhone(quote) {
    return normalizeString(quote.phone || quote.telefono || '');
  }

  function getBadgeClass(status) {
    return `badge-${slugify(status)}`;
  }

  function showMessage(message, type = 'info') {
    const area = document.getElementById('messageArea');
    if (!area) return;

    area.innerHTML = `<div class="message ${escapeHtml(type)}">${escapeHtml(message)}</div>`;

    clearTimeout(showMessage._timer);
    showMessage._timer = setTimeout(() => {
      if (area) area.innerHTML = '';
    }, 5000);
  }

  async function api(url, options = {}) {
    const config = {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {})
      }
    };

    if (options.body !== undefined) {
      config.body = options.body instanceof FormData ? options.body : JSON.stringify(options.body);
    }

    const response = await fetch(url, config);
    const text = await response.text();

    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    if (!response.ok) {
      const error = new Error(data?.message || `Errore ${response.status}`);
      error.status = response.status;
      error.payload = data;
      throw error;
    }

    return data;
  }

  async function apiTry(calls) {
    let lastError = null;

    for (const call of calls) {
      try {
        return await api(call.url, { method: call.method, body: call.body, headers: call.headers });
      } catch (error) {
        lastError = error;
        if (error.status && error.status !== 404) break;
      }
    }

    throw lastError || new Error('Richiesta non riuscita');
  }

  async function checkAuth() {
    try {
      const data = await apiTry([{ method: 'GET', url: '/api/admin/check' }]);

      if (data?.authenticated) {
        renderAdmin();
        await Promise.all([loadCatalog(), loadQuotes()]);
      } else {
        renderLogin();
      }
    } catch {
      renderLogin();
    }
  }

  function renderLogin() {
    loginSection.style.display = 'block';
    adminPanel.style.display = 'none';

    loginSection.innerHTML = `
      <div class="wrap">
        <div id="messageArea"></div>
        <div class="card login-box">
          <h1 class="section-title">Quote Engine Admin</h1>
          <p class="muted">Accedi con la password amministratore.</p>
          <form id="loginForm" class="grid-2" style="grid-template-columns: 1fr; margin-top: 16px;">
            <div>
              <label class="field-label" for="adminPassword">Password</label>
              <input id="adminPassword" class="input" type="password" placeholder="Inserisci la password" required>
            </div>
            <button class="btn btn-primary" type="submit">Accedi</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  }

  function renderAdmin() {
    loginSection.style.display = 'none';
    adminPanel.style.display = 'block';

    adminPanel.innerHTML = `
      <div class="wrap">
        <div id="messageArea"></div>

        <div class="card-block" style="margin-bottom: 18px;">
          <div class="toolbar-row space-between">
            <div>
              <h1 class="section-title" style="margin-bottom: 4px;">Gestionale Admin</h1>
              <div class="muted">Catalogo prodotti, preventivi, stato ed email.</div>
            </div>
            <button id="logoutBtn" class="btn btn-secondary" type="button">Logout</button>
          </div>
        </div>

        <div class="split-layout">
          <div class="card-block">
            <h2 class="section-title" style="font-size: 20px;">Catalogo</h2>
            <p class="muted" style="margin-top: -4px; margin-bottom: 16px;">Qui puoi aggiungere o modificare i prodotti. I prezzi vengono salvati correttamente anche se scrivi la virgola.</p>

            <form id="productForm" class="grid-2" style="grid-template-columns: 1fr;">
              <div>
                <label class="field-label" for="productName">Nome prodotto</label>
                <input id="productName" class="input" type="text" required>
              </div>

              <div>
                <label class="field-label" for="productDescription">Descrizione</label>
                <textarea id="productDescription" class="textarea"></textarea>
              </div>

              <div>
                <label class="field-label" for="productPrice">Prezzo</label>
                <input id="productPrice" class="input" type="text" inputmode="decimal" placeholder="Es. 149,90" required>
              </div>

              <div class="actions">
                <button id="saveProductBtn" class="btn btn-primary" type="submit">Salva prodotto</button>
                <button id="cancelEditProductBtn" class="btn btn-secondary" type="button" style="display:none;">Annulla modifica</button>
              </div>
            </form>
          </div>

          <div class="card-block">
            <div class="toolbar-row space-between">
              <div>
                <h2 class="section-title" style="font-size: 20px; margin-bottom: 4px;">Lista prodotti</h2>
                <div id="catalogCount" class="muted">0 prodotti</div>
              </div>
              <div style="min-width: 250px; width: 100%; max-width: 320px;">
                <input id="catalogSearchInput" class="input" type="search" placeholder="Cerca prodotto...">
              </div>
            </div>

            <div id="catalogList"></div>
          </div>
        </div>

        <div class="card-block" style="margin-top: 18px;">
          <div class="toolbar-row space-between">
            <div>
              <h2 class="section-title" style="font-size: 20px; margin-bottom: 4px;">Preventivi</h2>
              <div id="quoteCount" class="muted">0 preventivi</div>
            </div>
          </div>

          <div class="toolbar-row">
            <div style="flex: 1 1 320px;">
              <input id="quoteSearchInput" class="input" type="search" placeholder="Cerca per nome, azienda, email, numero preventivo...">
            </div>
            <div style="width: 240px; max-width: 100%;">
              <select id="quoteStatusFilter" class="select">
                <option value="">Tutti gli stati</option>
                ${STATUS_OPTIONS.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(capitalize(status))}</option>`).join('')}
              </select>
            </div>
          </div>

          <div id="quoteList" class="quote-list"></div>
        </div>
      </div>
    `;

    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
    document.getElementById('productForm')?.addEventListener('submit', handleSaveProduct);
    document.getElementById('cancelEditProductBtn')?.addEventListener('click', resetProductForm);
    document.getElementById('catalogSearchInput')?.addEventListener('input', renderCatalog);
    document.getElementById('quoteSearchInput')?.addEventListener('input', handleQuoteSearchInput);
    document.getElementById('quoteStatusFilter')?.addEventListener('change', renderQuotes);
    adminPanel.addEventListener('click', handleAdminClick);
    adminPanel.addEventListener('change', handleAdminChange);
  }

  async function handleLogin(event) {
    event.preventDefault();

    const password = document.getElementById('adminPassword')?.value || '';
    if (!password.trim()) {
      showMessage('Inserisci la password.', 'error');
      return;
    }

    try {
      await apiTry([{ method: 'POST', url: '/api/admin/login', body: { password } }]);
      renderAdmin();
      await Promise.all([loadCatalog(), loadQuotes()]);
      showMessage('Accesso effettuato.', 'success');
    } catch (error) {
      showMessage(error.message || 'Password non valida.', 'error');
    }
  }

  async function handleLogout() {
    try {
      await apiTry([{ method: 'POST', url: '/api/admin/logout' }]);
    } catch {}

    state.products = [];
    state.quotes = [];
    state.editingProductId = null;
    renderLogin();
    showMessage('Logout effettuato.', 'success');
  }

  async function loadCatalog() {
    try {
      const data = await apiTry([
        { method: 'GET', url: '/api/admin/catalog' },
        { method: 'GET', url: '/api/catalog' }
      ]);

      const rawProducts = Array.isArray(data)
        ? data
        : Array.isArray(data?.products)
          ? data.products
          : Array.isArray(data?.catalog)
            ? data.catalog
            : [];

      state.products = rawProducts.map(normalizeProduct);
      renderCatalog();
    } catch (error) {
      state.products = [];
      renderCatalog();
      showMessage(error.message || 'Errore nel caricamento del catalogo.', 'error');
    }
  }

  async function loadQuotes() {
    try {
      const data = await apiTry([
        { method: 'GET', url: '/api/admin/quotes' },
        { method: 'GET', url: '/api/quotes' }
      ]);

      const rawQuotes = Array.isArray(data)
        ? data
        : Array.isArray(data?.quotes)
          ? data.quotes
          : [];

      state.quotes = rawQuotes;
      renderQuotes();
    } catch (error) {
      state.quotes = [];
      renderQuotes();
      showMessage(error.message || 'Errore nel caricamento dei preventivi.', 'error');
    }
  }

  function handleQuoteSearchInput() {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(renderQuotes, 180);
  }

  function getFilteredProducts() {
    const search = normalizeString(document.getElementById('catalogSearchInput')?.value || '').toLowerCase();
    if (!search) return [...state.products];

    return state.products.filter((product) => {
      const haystack = [product.id, product.name, product.description, product.price]
        .map((value) => normalizeString(value).toLowerCase())
        .join(' ');
      return haystack.includes(search);
    });
  }

  function renderCatalog() {
    const list = document.getElementById('catalogList');
    const count = document.getElementById('catalogCount');
    if (!list || !count) return;

    const products = getFilteredProducts();
    count.textContent = `${products.length} prodotti`;

    if (!products.length) {
      list.innerHTML = `<div class="empty-state">Nessun prodotto trovato.</div>`;
      return;
    }

    list.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Prodotto</th>
              <th>Descrizione</th>
              <th>Prezzo</th>
              <th>Azioni</th>
            </tr>
          </thead>
          <tbody>
            ${products.map((product) => `
              <tr>
                <td><strong>${escapeHtml(product.name)}</strong></td>
                <td>${escapeHtml(product.description || '-')}</td>
                <td><strong>${escapeHtml(formatCurrency(product.price))}</strong></td>
                <td>
                  <div class="actions">
                    <button class="btn btn-secondary" type="button" data-action="edit-product" data-id="${escapeHtml(product.id)}">Modifica</button>
                    <button class="btn btn-danger" type="button" data-action="delete-product" data-id="${escapeHtml(product.id)}">Elimina</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function handleSaveProduct(event) {
    event.preventDefault();

    const name = normalizeString(document.getElementById('productName')?.value || '');
    const description = normalizeString(document.getElementById('productDescription')?.value || '');
    const priceValue = document.getElementById('productPrice')?.value || '';
    const price = normalizePrice(priceValue);

    if (!name) {
      showMessage('Inserisci il nome del prodotto.', 'error');
      return;
    }

    if (price <= 0) {
      showMessage('Inserisci un prezzo valido maggiore di zero.', 'error');
      return;
    }

    const payload = { name, description, price };

    try {
      if (state.editingProductId) {
        await apiTry([
          { method: 'PUT', url: `/api/admin/catalog/${encodeURIComponent(state.editingProductId)}`, body: payload }
        ]);
        showMessage('Prodotto aggiornato.', 'success');
      } else {
        await apiTry([
          { method: 'POST', url: '/api/admin/catalog', body: payload }
        ]);
        showMessage('Prodotto creato.', 'success');
      }

      resetProductForm();
      await loadCatalog();
    } catch (error) {
      showMessage(error.message || 'Errore nel salvataggio del prodotto.', 'error');
    }
  }

  function fillProductForm(product) {
    document.getElementById('productName').value = product.name || '';
    document.getElementById('productDescription').value = product.description || '';
    document.getElementById('productPrice').value = String(product.price ?? '').replace('.', ',');
    document.getElementById('saveProductBtn').textContent = 'Aggiorna prodotto';
    document.getElementById('cancelEditProductBtn').style.display = 'inline-flex';
    state.editingProductId = product.id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetProductForm() {
    state.editingProductId = null;
    const form = document.getElementById('productForm');
    if (form) form.reset();
    const saveBtn = document.getElementById('saveProductBtn');
    const cancelBtn = document.getElementById('cancelEditProductBtn');
    if (saveBtn) saveBtn.textContent = 'Salva prodotto';
    if (cancelBtn) cancelBtn.style.display = 'none';
  }

  async function deleteProduct(productId) {
    const product = state.products.find((item) => item.id === productId);
    const name = product?.name || 'questo prodotto';

    if (!window.confirm(`Vuoi davvero eliminare ${name}?`)) return;

    try {
      await apiTry([
        { method: 'DELETE', url: `/api/admin/catalog/${encodeURIComponent(productId)}` }
      ]);
      showMessage('Prodotto eliminato.', 'success');
      if (state.editingProductId === productId) resetProductForm();
      await loadCatalog();
    } catch (error) {
      showMessage(error.message || 'Errore nell\'eliminazione del prodotto.', 'error');
    }
  }

  function getFilteredQuotes() {
    const search = normalizeString(document.getElementById('quoteSearchInput')?.value || '').toLowerCase();
    const statusFilter = normalizeString(document.getElementById('quoteStatusFilter')?.value || '').toLowerCase();

    return state.quotes.filter((quote) => {
      const status = getQuoteStatus(quote);
      if (statusFilter && status !== statusFilter) return false;

      if (!search) return true;

      const haystack = [
        getQuoteNumber(quote),
        getQuoteCustomerName(quote),
        getQuoteCompany(quote),
        getQuoteEmail(quote),
        getQuotePhone(quote),
        status,
        ...getQuoteItems(quote).map((item) => `${getItemName(item)} ${getItemUnitPrice(item)} ${getItemTotal(item)}`)
      ].join(' ').toLowerCase();

      return haystack.includes(search);
    });
  }

  function renderQuotes() {
    const list = document.getElementById('quoteList');
    const count = document.getElementById('quoteCount');
    if (!list || !count) return;

    const quotes = getFilteredQuotes().sort((a, b) => {
      const aTime = new Date(a.createdAt || a.updatedAt || 0).getTime();
      const bTime = new Date(b.createdAt || b.updatedAt || 0).getTime();
      return bTime - aTime;
    });

    count.textContent = `${quotes.length} preventivi`;

    if (!quotes.length) {
      list.innerHTML = `<div class="empty-state">Nessun preventivo trovato.</div>`;
      return;
    }

    list.innerHTML = quotes.map((quote) => renderQuoteCard(quote)).join('');
  }

  function renderQuoteCard(quote) {
    const id = getQuoteId(quote);
    const status = getQuoteStatus(quote);
    const quoteNumber = getQuoteNumber(quote);
    const customerName = getQuoteCustomerName(quote);
    const company = getQuoteCompany(quote);
    const email = getQuoteEmail(quote);
    const phone = getQuotePhone(quote);
    const createdAt = formatDate(quote.createdAt || quote.date || quote.created_at);
    const total = getQuoteTotal(quote);
    const items = getQuoteItems(quote);

    const itemsHtml = items.length
      ? `
        <div class="quote-items">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Voce</th>
                  <th>Qtà</th>
                  <th>Prezzo</th>
                  <th>Totale</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((item) => `
                  <tr>
                    <td>${escapeHtml(getItemName(item))}</td>
                    <td>${escapeHtml(String(getItemQuantity(item)))}</td>
                    <td>${escapeHtml(formatCurrency(getItemUnitPrice(item)))}</td>
                    <td>${escapeHtml(formatCurrency(getItemTotal(item)))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `
      : `<div class="muted" style="margin-top:10px;">Nessuna riga prodotto presente nel preventivo.</div>`;

    return `
      <div class="quote-card">
        <div class="quote-head">
          <div>
            <h3 class="quote-title">Preventivo ${escapeHtml(quoteNumber || '-')}</h3>
            <div class="quote-meta">
              <div><strong>Cliente:</strong> ${escapeHtml(customerName)}</div>
              <div><strong>Azienda:</strong> ${escapeHtml(company || '-')}</div>
              <div><strong>Email:</strong> ${escapeHtml(email || '-')}</div>
              <div><strong>Telefono:</strong> ${escapeHtml(phone || '-')}</div>
              <div><strong>Creato:</strong> ${escapeHtml(createdAt)}</div>
            </div>
          </div>

          <div class="inline-status">
            <span class="badge ${escapeHtml(getBadgeClass(status))}">${escapeHtml(status)}</span>
            <select class="select" data-action="change-status" data-id="${escapeHtml(id)}" style="min-width:170px;">
              ${STATUS_OPTIONS.map((option) => `
                <option value="${escapeHtml(option)}" ${option === status ? 'selected' : ''}>
                  ${escapeHtml(capitalize(option))}
                </option>
              `).join('')}
            </select>
          </div>
        </div>

        ${itemsHtml}

        <div class="quote-footer">
          <div class="quote-total">Totale: ${escapeHtml(formatCurrency(total))}</div>

          <div class="actions">
            <button class="btn btn-success" type="button" data-action="send-email" data-id="${escapeHtml(id)}">Invia email</button>
            <button class="btn btn-secondary" type="button" data-action="download-pdf" data-id="${escapeHtml(id)}">PDF</button>
            <button class="btn btn-danger" type="button" data-action="delete-quote" data-id="${escapeHtml(id)}">Elimina</button>
          </div>
        </div>
      </div>
    `;
  }

  async function handleAdminClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === 'edit-product') {
      const product = state.products.find((item) => item.id === id);
      if (product) fillProductForm(product);
      return;
    }

    if (action === 'delete-product') {
      await deleteProduct(id);
      return;
    }

    if (action === 'send-email') {
      await sendQuoteEmail(id);
      return;
    }

    if (action === 'download-pdf') {
      openQuotePdf(id);
      return;
    }

    if (action === 'delete-quote') {
      await deleteQuote(id);
    }
  }

  async function handleAdminChange(event) {
    const select = event.target.closest('[data-action="change-status"]');
    if (!select) return;

    const id = select.dataset.id;
    const status = select.value;
    await updateQuoteStatus(id, status);
  }

  async function updateQuoteStatus(quoteId, status) {
    try {
      await apiTry([
        { method: 'PATCH', url: `/api/admin/quotes/${encodeURIComponent(quoteId)}/status`, body: { status } },
        { method: 'PUT', url: `/api/admin/quotes/${encodeURIComponent(quoteId)}/status`, body: { status } },
        { method: 'PATCH', url: `/api/admin/quotes/${encodeURIComponent(quoteId)}`, body: { status } },
        { method: 'PUT', url: `/api/admin/quotes/${encodeURIComponent(quoteId)}`, body: { status } }
      ]);

      showMessage('Stato preventivo aggiornato.', 'success');
      await loadQuotes();
    } catch (error) {
      showMessage(error.message || 'Errore nell\'aggiornamento dello stato.', 'error');
      await loadQuotes();
    }
  }

  async function sendQuoteEmail(quoteId) {
    try {
      await apiTry([
        { method: 'POST', url: `/api/admin/quotes/${encodeURIComponent(quoteId)}/send-email` },
        { method: 'POST', url: `/api/admin/quotes/${encodeURIComponent(quoteId)}/send` },
        { method: 'POST', url: `/api/admin/quotes/${encodeURIComponent(quoteId)}/email` }
      ]);

      showMessage('Email inviata con successo.', 'success');
      await loadQuotes();
    } catch (error) {
      showMessage(error.message || 'Errore nell\'invio dell\'email.', 'error');
    }
  }

  function openQuotePdf(quoteId) {
    const popup = window.open(`/api/admin/quotes/${encodeURIComponent(quoteId)}/pdf`, '_blank');
    if (!popup) {
      showMessage('Il browser ha bloccato l\'apertura del PDF.', 'error');
    }
  }

  async function deleteQuote(quoteId) {
    if (!window.confirm('Vuoi davvero eliminare questo preventivo?')) return;

    try {
      await apiTry([{ method: 'DELETE', url: `/api/admin/quotes/${encodeURIComponent(quoteId)}` }]);
      showMessage('Preventivo eliminato.', 'success');
      await loadQuotes();
    } catch (error) {
      showMessage(error.message || 'Errore nell\'eliminazione del preventivo.', 'error');
    }
  }
})();