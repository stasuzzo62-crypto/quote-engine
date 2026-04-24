const state = {
  catalog: [],
  selectedItems: [],
  adminLogged: false,
  quotes: []
};

const elements = {};

document.addEventListener('DOMContentLoaded', () => {
  elements.catalog = document.getElementById('catalog');
  elements.selectedItems = document.getElementById('selected-items');
  elements.total = document.getElementById('total');
  elements.message = document.getElementById('message');
  elements.createQuoteBtn = document.getElementById('create-quote-btn');

  elements.name = document.getElementById('name');
  elements.surname = document.getElementById('surname');
  elements.email = document.getElementById('email');
  elements.phone = document.getElementById('phone');
  elements.company = document.getElementById('company');
  elements.notes = document.getElementById('notes');

  elements.adminPassword = document.getElementById('admin-password');
  elements.adminLoginBtn = document.getElementById('admin-login-btn');
  elements.adminLogoutBtn = document.getElementById('admin-logout-btn');
  elements.adminPanel = document.getElementById('admin-panel');
  elements.adminStatus = document.getElementById('admin-status');
  elements.refreshQuotesBtn = document.getElementById('refresh-quotes-btn');
  elements.searchQuotesBtn = document.getElementById('search-quotes-btn');
  elements.quoteSearch = document.getElementById('quote-search');
  elements.quotesList = document.getElementById('quotes-list');

  if (elements.catalog) {
    elements.catalog.addEventListener('click', onCatalogClick);
  }

  if (elements.selectedItems) {
    elements.selectedItems.addEventListener('click', onSelectedItemsClick);
  }

  if (elements.createQuoteBtn) {
    elements.createQuoteBtn.addEventListener('click', createQuote);
  }

  if (elements.adminLoginBtn) {
    elements.adminLoginBtn.addEventListener('click', adminLogin);
  }

  if (elements.adminLogoutBtn) {
    elements.adminLogoutBtn.addEventListener('click', adminLogout);
  }

  if (elements.refreshQuotesBtn) {
    elements.refreshQuotesBtn.addEventListener('click', () => loadQuotes());
  }

  if (elements.searchQuotesBtn) {
    elements.searchQuotesBtn.addEventListener('click', () => {
      loadQuotes(elements.quoteSearch.value.trim());
    });
  }

  if (elements.quoteSearch) {
    elements.quoteSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        loadQuotes(elements.quoteSearch.value.trim());
      }
    });
  }

  if (elements.quotesList) {
    elements.quotesList.addEventListener('click', onQuotesListClick);
  }

  loadCatalog();
  renderSelectedItems();
  updateAdminUi();
});

async function loadCatalog() {
  try {
    const response = await fetch('/api/catalog');
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      state.catalog = [];
      renderCatalog();
      showMessage('Catalogo vuoto o non trovato.', 'error');
      return;
    }

    state.catalog = data;
    renderCatalog();
  } catch (error) {
    console.error('Errore caricamento catalogo:', error);
    showMessage('Errore nel caricamento del catalogo.', 'error');
  }
}

function renderCatalog() {
  if (!elements.catalog) return;

  if (!state.catalog.length) {
    elements.catalog.innerHTML = `
      <div class="empty-box">Nessun prodotto nel catalogo.</div>
    `;
    return;
  }

  elements.catalog.innerHTML = state.catalog
    .map((product) => {
      return `
        <div class="product-card">
          <div class="product-name">${escapeHtml(product.name)}</div>
          <div class="product-price">€ ${Number(product.price).toFixed(2)}</div>
          <button
            type="button"
            class="add-product-btn"
            data-id="${product.id}"
          >
            Aggiungi
          </button>
        </div>
      `;
    })
    .join('');
}

function onCatalogClick(event) {
  const button = event.target.closest('.add-product-btn');
  if (!button) return;

  const productId = Number(button.dataset.id);
  addProduct(productId);
}

function addProduct(productId) {
  const product = state.catalog.find((item) => Number(item.id) === productId);
  if (!product) return;

  const existing = state.selectedItems.find((item) => Number(item.productId) === productId);

  if (existing) {
    existing.quantity += 1;
  } else {
    state.selectedItems.push({
      productId: Number(product.id),
      name: product.name,
      price: Number(product.price),
      quantity: 1
    });
  }

  renderSelectedItems();
}

function onSelectedItemsClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const productId = Number(button.dataset.id);

  const item = state.selectedItems.find((row) => Number(row.productId) === productId);
  if (!item) return;

  if (action === 'inc') {
    item.quantity += 1;
  }

  if (action === 'dec') {
    item.quantity -= 1;
    if (item.quantity <= 0) {
      state.selectedItems = state.selectedItems.filter(
        (row) => Number(row.productId) !== productId
      );
    }
  }

  if (action === 'remove') {
    state.selectedItems = state.selectedItems.filter(
      (row) => Number(row.productId) !== productId
    );
  }

  renderSelectedItems();
}

function renderSelectedItems() {
  if (!elements.selectedItems || !elements.total) return;

  if (!state.selectedItems.length) {
    elements.selectedItems.innerHTML = `
      <div class="empty-box">Non hai ancora aggiunto prodotti.</div>
    `;
    updateTotal();
    return;
  }

  elements.selectedItems.innerHTML = state.selectedItems
    .map((item) => {
      const rowTotal = Number(item.price) * Number(item.quantity);

      return `
        <div class="selected-row">
          <div>
            <strong>${escapeHtml(item.name)}</strong><br />
            <span class="muted">Prezzo: € ${Number(item.price).toFixed(2)}</span>
          </div>

          <div class="qty-box">
            <button type="button" class="btn-secondary btn-small" data-action="dec" data-id="${item.productId}">-</button>
            <span class="qty-number">${item.quantity}</span>
            <button type="button" class="btn-secondary btn-small" data-action="inc" data-id="${item.productId}">+</button>
          </div>

          <div><strong>€ ${Number(rowTotal).toFixed(2)}</strong></div>

          <div>
            <button type="button" class="btn-danger btn-small" data-action="remove" data-id="${item.productId}">
              Rimuovi
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  updateTotal();
}

function updateTotal() {
  if (!elements.total) return;

  const total = state.selectedItems.reduce((sum, item) => {
    return sum + Number(item.price) * Number(item.quantity);
  }, 0);

  elements.total.textContent = total.toFixed(2);
}

async function createQuote() {
  try {
    showMessage('', '');

    const customer = {
      name: elements.name ? elements.name.value.trim() : '',
      surname: elements.surname ? elements.surname.value.trim() : '',
      email: elements.email ? elements.email.value.trim() : '',
      phone: elements.phone ? elements.phone.value.trim() : '',
      company: elements.company ? elements.company.value.trim() : ''
    };

    if (!customer.name || !customer.surname) {
      showMessage('Inserisci almeno nome e cognome del cliente.', 'error');
      return;
    }

    if (!state.selectedItems.length) {
      showMessage('Aggiungi almeno un prodotto al preventivo.', 'error');
      return;
    }

    const payload = {
      customer,
      notes: elements.notes ? elements.notes.value.trim() : '',
      items: state.selectedItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity
      }))
    };

    if (elements.createQuoteBtn) {
      elements.createQuoteBtn.disabled = true;
      elements.createQuoteBtn.textContent = 'Creazione in corso...';
    }

    const response = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      showMessage(data.message || 'Errore durante la creazione del preventivo.', 'error');
      return;
    }

    const emailInfo = data.email?.message
      ? `<br>Email: ${escapeHtml(data.email.message)}`
      : '';

    const pdfInfo = data.pdfUrl
      ? `<br><a href="${data.pdfUrl}" target="_blank">Apri / scarica PDF</a>`
      : '';

    showMessage(
      `Preventivo creato con successo: ${escapeHtml(data.quote.number)}${emailInfo}${pdfInfo}`,
      'success'
    );

    state.selectedItems = [];
    renderSelectedItems();

    if (elements.notes) {
      elements.notes.value = '';
    }

    if (state.adminLogged) {
      loadQuotes(elements.quoteSearch ? elements.quoteSearch.value.trim() : '');
    }
  } catch (error) {
    console.error('Errore creazione preventivo:', error);
    showMessage('Errore interno durante la creazione del preventivo.', 'error');
  } finally {
    if (elements.createQuoteBtn) {
      elements.createQuoteBtn.disabled = false;
      elements.createQuoteBtn.textContent = 'Crea preventivo';
    }
  }
}

async function adminLogin() {
  try {
    const password = elements.adminPassword ? elements.adminPassword.value.trim() : '';

    if (!password) {
      alert('Inserisci la password admin.');
      return;
    }

    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      alert(data.message || 'Password admin non corretta.');
      return;
    }

    state.adminLogged = true;
    updateAdminUi();
    loadQuotes();
  } catch (error) {
    console.error('Errore login admin:', error);
    alert('Errore durante il login admin.');
  }
}

function adminLogout() {
  state.adminLogged = false;
  state.quotes = [];

  if (elements.adminPassword) {
    elements.adminPassword.value = '';
  }

  updateAdminUi();
  renderQuotes();
}

function updateAdminUi() {
  if (!elements.adminPanel || !elements.adminLoginBtn || !elements.adminLogoutBtn || !elements.adminStatus) {
    return;
  }

  if (state.adminLogged) {
    elements.adminPanel.classList.add('active');
    elements.adminLoginBtn.style.display = 'none';
    elements.adminLogoutBtn.style.display = 'inline-block';
    elements.adminStatus.textContent = 'Admin connesso';
  } else {
    elements.adminPanel.classList.remove('active');
    elements.adminLoginBtn.style.display = 'inline-block';
    elements.adminLogoutBtn.style.display = 'none';
    elements.adminStatus.textContent = 'Admin non connesso';
  }
}

async function loadQuotes(search = '') {
  if (!state.adminLogged) return;

  try {
    const url = search
      ? `/api/quotes?q=${encodeURIComponent(search)}`
      : '/api/quotes';

    const response = await fetch(url);
    const data = await response.json();

    state.quotes = Array.isArray(data) ? data : [];
    renderQuotes();
  } catch (error) {
    console.error('Errore caricamento preventivi:', error);

    if (elements.quotesList) {
      elements.quotesList.innerHTML = `
        <div class="empty-box">Errore nel caricamento dell'archivio preventivi.</div>
      `;
    }
  }
}

function renderQuotes() {
  if (!elements.quotesList) return;

  if (!state.adminLogged) {
    elements.quotesList.innerHTML = '';
    return;
  }

  if (!state.quotes.length) {
    elements.quotesList.innerHTML = `
      <div class="empty-box">Nessun preventivo trovato.</div>
    `;
    return;
  }

  elements.quotesList.innerHTML = state.quotes
    .map((quote) => {
      const customerName = `${quote.customer?.name || ''} ${quote.customer?.surname || ''}`.trim();
      const customerEmail = quote.customer?.email || '-';
      const company = quote.customer?.company || '-';
      const phone = quote.customer?.phone || '-';
      const status = normalizeStatus(quote.status);
      const createdAt = formatDate(quote.createdAt);

      const itemsHtml = Array.isArray(quote.items)
        ? quote.items
            .map((item) => {
              return `<li>${escapeHtml(item.name)} — Qta: ${item.quantity} — € ${Number(item.total).toFixed(2)}</li>`;
            })
            .join('')
        : '';

      return `
        <div class="quote-card">
          <div class="quote-head">
            <div>
              <div class="quote-number">${escapeHtml(quote.number || 'Preventivo')}</div>
              <div class="quote-meta">
                Cliente: ${escapeHtml(customerName || '-')}<br>
                Email: ${escapeHtml(customerEmail)}<br>
                Telefono: ${escapeHtml(phone)}<br>
                Azienda: ${escapeHtml(company)}<br>
                Data: ${escapeHtml(createdAt)}
              </div>
            </div>

            <div class="quote-right">
              <span class="status-badge ${getStatusClass(status)}">${escapeHtml(status)}</span>
              <div style="margin-top: 10px;">
                <strong>Totale: € ${Number(quote.total || 0).toFixed(2)}</strong>
              </div>
            </div>
          </div>

          <ul class="quote-items">
            ${itemsHtml || '<li>Nessun prodotto</li>'}
          </ul>

          ${quote.notes ? `<div class="quote-meta">Note: ${escapeHtml(quote.notes)}</div>` : ''}

          <div class="quote-actions">
            <select class="status-select" data-role="status-select" data-id="${quote.id}">
              <option value="nuovo" ${status === 'nuovo' ? 'selected' : ''}>Nuovo</option>
              <option value="in lavorazione" ${status === 'in lavorazione' ? 'selected' : ''}>In lavorazione</option>
              <option value="accettato" ${status === 'accettato' ? 'selected' : ''}>Accettato</option>
              <option value="rifiutato" ${status === 'rifiutato' ? 'selected' : ''}>Rifiutato</option>
            </select>

            <button class="btn-secondary btn-small" data-action="save-status" data-id="${quote.id}">
              Salva stato
            </button>

            <a href="/api/quotes/${quote.id}/pdf" target="_blank" style="text-decoration:none;">
              <button type="button" class="btn-small">PDF</button>
            </a>
          </div>
        </div>
      `;
    })
    .join('');
}

async function onQuotesListClick(event) {
  const button = event.target.closest('[data-action="save-status"]');
  if (!button) return;

  const quoteId = button.dataset.id;
  const select = elements.quotesList.querySelector(
    `[data-role="status-select"][data-id="${quoteId}"]`
  );

  if (!select) return;

  await updateQuoteStatus(quoteId, select.value);
}

async function updateQuoteStatus(quoteId, status) {
  try {
    const response = await fetch(`/api/quotes/${quoteId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      alert(data.message || 'Errore aggiornamento stato.');
      return;
    }

    loadQuotes(elements.quoteSearch ? elements.quoteSearch.value.trim() : '');
  } catch (error) {
    console.error('Errore aggiornamento stato:', error);
    alert('Errore durante l’aggiornamento dello stato.');
  }
}

function showMessage(text, type) {
  if (!elements.message) return;

  if (!text) {
    elements.message.className = 'message';
    elements.message.innerHTML = '';
    return;
  }

  elements.message.className = `message ${type}`;
  elements.message.innerHTML = text;
}

function formatDate(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleString('it-IT');
  } catch {
    return value;
  }
}

function normalizeStatus(status) {
  const value = String(status || 'nuovo').trim().toLowerCase();

  if (value === 'accettato') return 'accettato';
  if (value === 'rifiutato') return 'rifiutato';
  if (value === 'in lavorazione') return 'in lavorazione';
  return 'nuovo';
}

function getStatusClass(status) {
  const value = String(status || '').toLowerCase().trim();

  if (value === 'accettato') return 'status-accettato';
  if (value === 'rifiutato') return 'status-rifiutato';
  if (value === 'in lavorazione') return 'status-in-lavorazione';
  return 'status-nuovo';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}