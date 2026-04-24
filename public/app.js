let catalog = [];
let selectedItems = [];

async function loadCatalog() {
  try {
    const response = await fetch("/api/catalog");
    const data = await response.json();

    console.log("Catalogo ricevuto da /api/catalog:", data);

    if (Array.isArray(data)) {
      catalog = data;
    } else if (data && Array.isArray(data.items)) {
      catalog = data.items;
    } else if (data && Array.isArray(data.catalog)) {
      catalog = data.catalog;
    } else if (data && Array.isArray(data.products)) {
      catalog = data.products;
    } else if (data && typeof data === "object" && data.id && data.name) {
      catalog = [data];
    } else {
      catalog = [];
    }

    renderCatalog();
  } catch (error) {
    console.error("Errore caricamento catalogo:", error);
    document.getElementById("catalogContainer").innerHTML =
      "<p>Errore nel caricamento del catalogo.</p>";
  }
}

function renderCatalog() {
  const container = document.getElementById("catalogContainer");

  console.log("Catalogo usato dal frontend:", catalog);

  if (!Array.isArray(catalog) || catalog.length === 0) {
    container.innerHTML = "<p class='empty'>Catalogo vuoto.</p>";
    return;
  }

  container.innerHTML = catalog
    .map(
      (item) => `
        <div class="catalog-item">
          <h3>${item.name || "Prodotto senza nome"}</h3>
          <p><strong>Prezzo:</strong> € ${Number(item.price || 0).toFixed(2)}</p>

          <label>Quantità</label>
          <input type="number" id="qty-${item.id}" min="1" value="1" />

          <button type="button" onclick="addItem('${item.id}')">
            Aggiungi
          </button>
        </div>
      `
    )
    .join("");
}

function addItem(id) {
  const catalogItem = catalog.find((item) => item.id === id);
  if (!catalogItem) return;

  const qtyInput = document.getElementById(`qty-${id}`);
  const quantity = Math.max(1, Number(qtyInput.value) || 1);

  const existing = selectedItems.find((item) => item.id === id);

  if (existing) {
    existing.quantity += quantity;
  } else {
    selectedItems.push({
      id: catalogItem.id,
      name: catalogItem.name,
      unitPrice: Number(catalogItem.price),
      quantity
    });
  }

  renderSelectedItems();
}

function removeItem(id) {
  selectedItems = selectedItems.filter((item) => item.id !== id);
  renderSelectedItems();
}

function renderSelectedItems() {
  const container = document.getElementById("selectedItems");
  const totalElement = document.getElementById("total");

  if (!selectedItems.length) {
    container.innerHTML = "<p class='empty'>Nessun item selezionato.</p>";
    totalElement.textContent = "0.00";
    return;
  }

  let total = 0;

  const rows = selectedItems
    .map((item) => {
      const lineTotal = item.unitPrice * item.quantity;
      total += lineTotal;

      return `
        <tr>
          <td>${item.name}</td>
          <td>${item.quantity}</td>
          <td>€ ${item.unitPrice.toFixed(2)}</td>
          <td>€ ${lineTotal.toFixed(2)}</td>
          <td>
            <button type="button" onclick="removeItem('${item.id}')">Rimuovi</button>
          </td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Quantità</th>
          <th>Prezzo unitario</th>
          <th>Totale</th>
          <th>Azione</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  totalElement.textContent = total.toFixed(2);
}

document.getElementById("quoteForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!selectedItems.length) {
    alert("Aggiungi almeno un prodotto o servizio.");
    return;
  }

  const payload = {
    name: document.getElementById("name").value.trim(),
    surname: document.getElementById("surname").value.trim(),
    email: document.getElementById("email").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    company: document.getElementById("company").value.trim(),
    items: selectedItems.map((item) => ({
      id: item.id,
      quantity: item.quantity
    }))
  };

  console.log("Payload inviato:", payload);

  try {
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    console.log("Risposta grezza server:", text);

    let result = {};
    try {
      result = JSON.parse(text);
    } catch (parseError) {
      result = { error: text || "Risposta non valida del server" };
    }

    if (!response.ok) {
      alert(result.error || "Errore nel salvataggio del preventivo.");
      return;
    }

    alert("Preventivo salvato con successo!");

    document.getElementById("quoteForm").reset();
    selectedItems = [];
    renderSelectedItems();
  } catch (error) {
    console.error("Errore invio preventivo:", error);
    alert("Errore di connessione al server.");
  }
});

loadCatalog();
renderSelectedItems();