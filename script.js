// DOM elements
const addBtn = document.getElementById("dugme");
const searchInput = document.getElementById("pretraga");
const lokacijeDiv = document.getElementById("lokacije-list");
const infoPanel = document.getElementById("info-panel");

const modalBg = document.getElementById("modal-bg");
const closeModalBtn = document.getElementById("close-modal");
const saveBtn = document.getElementById("save-location");

const nameInput = document.getElementById("m-name");
const addressInput = document.getElementById("m-address");
const cityInput = document.getElementById("m-city");

// In-memory cache of locations (single source of truth for the UI)
let locationsCache = [];
let selectedLocation = null; // currently opened location in info panel

// debounce utility
function debounce(fn, wait = 200) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(null, args), wait);
    };
}

// =====================
// MODAL HANDLING
// =====================

addBtn.addEventListener("click", () => {
    modalBg.classList.remove("hidden");
    modalBg.setAttribute("aria-hidden", "false");
    nameInput.focus();
});

closeModalBtn.addEventListener("click", closeModal);
modalBg.addEventListener("click", e => {
    if (e.target === modalBg) closeModal();
});

function closeModal() {
    modalBg.classList.add("hidden");
    modalBg.setAttribute("aria-hidden", "true");
    nameInput.value = "";
    addressInput.value = "";
    cityInput.value = "";
}

// =====================
// CRUD: Add and Delete (locations)
// =====================

saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const address = addressInput.value.trim();
    const city = cityInput.value.trim();

    if (!name || !city) {
        alert("Naziv i grad su obavezni.");
        return;
    }

    saveBtn.disabled = true;
    try {
        const { data, error } = await db
            .from("locations")
            .insert([{ name, address, city }])
            .select()
            .single();

        if (error) {
            console.error("INSERT ERROR:", error);
            alert("Neuspešno čuvanje lokacije");
            return;
        }

        locationsCache.push(data);
        renderLocations(locationsCache, searchInput.value.trim());
        closeModal();
    } finally {
        saveBtn.disabled = false;
    }
});

async function deleteLocation(id) {
    const { error } = await db
        .from("locations")
        .delete()
        .eq("id", id);

    if (error) {
        console.error("DELETE ERROR:", error);
        alert("Failed to delete location");
        return false;
    }

    locationsCache = locationsCache.filter(l => l.id !== id);
    if (selectedLocation && selectedLocation.id === id) {
        selectedLocation = null;
        renderInfoPanel(null);
    }
    renderLocations(locationsCache, searchInput.value.trim());
    return true;
}

// =====================
// FETCH & RENDER (locations)
// =====================

async function fetchLocations() {
    const { data, error } = await db
        .from("locations")
        .select("*")
        .order("id", { ascending: true });

    if (error) {
        console.error("FETCH ERROR:", error);
        lokacijeDiv.innerHTML = "<p class='empty'>Nije moguće učitati lokacije.</p>";
        return;
    }

    locationsCache = Array.isArray(data) ? data : [];
    renderLocations(locationsCache);
}

function renderLocations(list, filter = "") {
    lokacijeDiv.innerHTML = "";

    const q = (filter || "").trim().toLowerCase();

    const visible = q
        ? list.filter(loc => {
              const name = (loc.name || "").toLowerCase();
              const address = (loc.address || "").toLowerCase();
              const city = (loc.city || "").toLowerCase();
              return name.includes(q) || address.includes(q) || city.includes(q);
          })
        : list;

    if (!visible || visible.length === 0) {
        lokacijeDiv.innerHTML = "<p id='nije' class='empty'>Nije pronađena lokacija</p>";
        return;
    }

    visible.forEach(loc => {
        const block = document.createElement("article");
        block.className = "location-block";
        block.dataset.id = loc.id;

        const title = document.createElement("h3");
        title.className = "loc-title";
        title.textContent = loc.name || "Bez imena";

        const desc = document.createElement("p");
        desc.className = "loc-desc";
        const addressPart = loc.address ? loc.address : "";
        const cityPart = loc.city ? loc.city : "";
        desc.textContent = (addressPart && cityPart) ? `${addressPart} — ${cityPart}` : (addressPart || cityPart || "");

        const actions = document.createElement("div");
        actions.className = "loc-actions";

        const delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.title = `Obriši ${loc.name}`;
        delBtn.innerHTML = "&times;";

        delBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm(`Are you sure you want to delete "${loc.name}"?`)) return;
            delBtn.disabled = true;
            await deleteLocation(loc.id);
            delBtn.disabled = false;
        });

        block.addEventListener("click", () => {
            selectLocation(loc);
        });

        actions.appendChild(delBtn);

        block.appendChild(title);
        if (desc.textContent) block.appendChild(desc);
        block.appendChild(actions);

        lokacijeDiv.appendChild(block);
    });
}

// =====================
// SELECT LOCATION & INFO PANEL (deliveries)
// =====================

function selectLocation(loc) {
    selectedLocation = loc;
    renderInfoPanel(loc);
    loadDeliveriesForLocation(loc.id);
}

function renderInfoPanel(loc) {
    if (!loc) {
        infoPanel.innerHTML = `
            <div class="info-empty">
                <h3>Unesi Podatke</h3>
                <p>Odaberite lokaciju sa leve strane da biste uneli dostave i videli audit log.</p>
            </div>
        `;
        return;
    }

    // Build HTML for deliveries form, filters and audit logs
    infoPanel.innerHTML = `
        <div class="info-header">
            <h2>${escapeHtml(loc.name)}</h2>
            <p class="small">${escapeHtml(loc.address || "")} ${loc.address && loc.city ? "—" : ""} ${escapeHtml(loc.city || "")}</p>
        </div>

        <section class="delivery-form">
            <h3>Dodaj Dostavu</h3>
            <div class="form-row two-cols">
                <div class="col">
                    <label>Kg delivered</label>
                    <input id="d-kg" type="number" min="0" step="0.01" placeholder="kg" />
                </div>
                <div class="col">
                    <label>Cena (RSD)</label>
                    <input id="d-price" type="number" min="0" step="0.01" placeholder="cena" />
                </div>
            </div>
            <div class="form-row">
                <label>Datum</label>
                <input id="d-date" type="date" />
            </div>
            <div class="form-row actions-row">
                <button id="add-delivery-btn">Dodaj</button>
            </div>
            <p class="hint">Cena se automatski popunjava: 5 kg = 1 džak, profit po džaku = 250. Možete ručno promeniti cenu pre dodavanja.</p>
        </section>

        <section class="delivery-filter">
            <h3>Filter</h3>
            <div class="filter-row two-cols">
                <div class="col">
                    <label>Početni datum</label>
                    <input id="filter-start" type="date" />
                </div>
                <div class="col">
                    <label>Krajnji datum</label>
                    <input id="filter-end" type="date" />
                </div>
            </div>
            <div class="filter-row actions-row">
                <button id="apply-filter-btn">Prikaži</button>
                <button id="reset-filter-btn">Resetuj</button>
            </div>

            <div class="totals">
                <div><strong>Ukupno kg (period):</strong> <span id="total-kg">0</span></div>
                <div><strong>Ukupno kg (sve):</strong> <span id="total-kg-all">0</span></div>
            </div>
        </section>

        <section class="audit-logs">
            <h3>Audit Logs</h3>
            <div id="deliveries-list" class="deliveries-list">
                <!-- deliveries will render here -->
            </div>
        </section>
    `;

    // set default date in d-date input to today
    const dDate = document.getElementById("d-date");
    dDate.value = toLocalDateValue(new Date());

    // references to new inputs
    const kgInput = document.getElementById("d-kg");
    const priceInput = document.getElementById("d-price");

    // initialize dataset flag
    priceInput.dataset.userEdited = "false";

    // auto-fill price based on kg: price = (kg / 5) * 250
    kgInput.addEventListener("input", () => {
        const raw = parseFloat(kgInput.value);
        if (Number.isNaN(raw) || raw <= 0) {
            if (priceInput.dataset.userEdited !== "true") priceInput.value = "";
            return;
        }
        const computed = +(raw / 5) * 250;
        const rounded = Number.isFinite(computed) ? computed.toFixed(2) : "";
        // IMPORTANT: input[type=number] must receive plain numeric string (no thousands separators).
        if (priceInput.dataset.userEdited !== "true") {
            priceInput.value = rounded;
        }
    });

    // when user edits price manually mark it so auto-fill won't override
    priceInput.addEventListener("input", () => {
        // consider it user edited as soon as the user changes value
        priceInput.dataset.userEdited = "true";
    });

    // wire up events
    document.getElementById("add-delivery-btn").addEventListener("click", handleAddDelivery);
    document.getElementById("apply-filter-btn").addEventListener("click", handleApplyFilter);
    document.getElementById("reset-filter-btn").addEventListener("click", handleResetFilter);
}

// =====================
// DELIVERIES: add, fetch, render, delete
// =====================

async function handleAddDelivery() {
    if (!selectedLocation) {
        alert("Odaberite lokaciju prvo.");
        return;
    }

    const kgInput = document.getElementById("d-kg");
    const priceInput = document.getElementById("d-price");
    const dateInput = document.getElementById("d-date");

    const kg = parseFloat(String(kgInput.value).replace(/,/g, ''));
    let price = parseFloat(String(priceInput.value).replace(/,/g, ''));
    const dateVal = dateInput.value; // format YYYY-MM-DD

    if (Number.isNaN(kg) || kg <= 0) {
        alert("Unesite validnu količinu (kg).");
        return;
    }

    // If price is not set or NaN or zero, compute default
    if (Number.isNaN(price) || price === 0) {
        price = (kg / 5) * 250;
    }

    if (!dateVal) {
        alert("Unesite datum dostave.");
        return;
    }

    // Standardize delivered_at to start of day (no time component required by UI)
    const deliveredAtISO = new Date(dateVal + "T00:00:00").toISOString();

    const btn = document.getElementById("add-delivery-btn");
    btn.disabled = true;
    try {
        const { data, error } = await db
            .from("deliveries")
            .insert([{
                location_id: selectedLocation.id,
                kg_delivered: kg,
                price: price,
                delivered_at: deliveredAtISO
            }])
            .select()
            .single();

        if (error) {
            console.error("DELIVERY INSERT ERROR:", error);
            handleSupabaseAuthError(error);
            alert("Neuspešno dodavanje dostave. Pogledajte konzolu za detalje.");
            return;
        }

        // clear inputs and reset price edit flag
        kgInput.value = "";
        priceInput.value = "";
        priceInput.dataset.userEdited = "false";
        dateInput.value = toLocalDateValue(new Date());

        // reload deliveries and totals (respecting current filters)
        const start = document.getElementById("filter-start").value || null;
        const end = document.getElementById("filter-end").value || null;
        await loadDeliveriesForLocation(selectedLocation.id, start, end);
    } finally {
        btn.disabled = false;
    }
}

async function loadDeliveriesForLocation(locationId, startDate = null, endDate = null) {
    if (!locationId) return;

    try {
        let query = db
            .from("deliveries")
            .select("*")
            .eq("location_id", locationId)
            .order("delivered_at", { ascending: false });

        if (startDate) {
            const startISO = new Date(startDate + "T00:00:00").toISOString();
            query = query.gte("delivered_at", startISO);
        }
        if (endDate) {
            const endISO = new Date(endDate + "T23:59:59.999").toISOString();
            query = query.lte("delivered_at", endISO);
        }

        const { data, error } = await query;

        if (error) {
            console.error("LOAD DELIVERIES ERROR:", error);
            handleSupabaseAuthError(error);
            document.getElementById("deliveries-list").innerHTML = "<p class='empty'>Nije moguće učitati dostave.</p>";
            return;
        }

        const deliveries = Array.isArray(data) ? data : [];
        renderDeliveriesList(deliveries);

        // compute totals for the selected period
        const totalKg = deliveries.reduce((s, d) => s + parseFloat(d.kg_delivered || 0), 0);
        document.getElementById("total-kg").textContent = formatNumber(totalKg);

        // compute total for all time (no filter)
        const { data: allData, error: allErr } = await db
            .from("deliveries")
            .select("kg_delivered")
            .eq("location_id", locationId);

        if (!allErr && Array.isArray(allData)) {
            const totalAll = allData.reduce((s, d) => s + parseFloat(d.kg_delivered || 0), 0);
            document.getElementById("total-kg-all").textContent = formatNumber(totalAll);
        } else {
            document.getElementById("total-kg-all").textContent = "—";
            if (allErr) handleSupabaseAuthError(allErr);
        }
    } catch (err) {
        console.error("Unexpected error loading deliveries:", err);
        document.getElementById("deliveries-list").innerHTML = "<p class='empty'>Došlo je do greške pri učitavanju dostava.</p>";
    }
}

function renderDeliveriesList(deliveries) {
    const container = document.getElementById("deliveries-list");
    container.innerHTML = "";

    if (!deliveries || deliveries.length === 0) {
        container.innerHTML = "<p class='empty'>Nema zabeleženih dostava za ovaj period.</p>";
        return;
    }

    deliveries.forEach(d => {
        const block = document.createElement("div");
        block.className = "delivery-block";

        const date = new Date(d.delivered_at);
        const dateStr = date.toLocaleDateString();

        block.innerHTML = `
            <div class="delivery-main">
                <div class="delivery-meta">
                    <strong>${formatNumber(d.kg_delivered)} kg</strong>
                    <span class="small">• ${dateStr}</span>
                </div>
                <div class="delivery-price small">Cena: ${formatNumber(d.price)}</div>
            </div>
            <div class="delivery-actions">
                <button class="delete-delivery-btn" data-id="${d.id}" title="Obriši dostavu">Obriši</button>
            </div>
        `;

        const delBtn = block.querySelector(".delete-delivery-btn");
        delBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm("Da li ste sigurni da želite da obrišete ovu dostavu?")) return;
            delBtn.disabled = true;
            const id = parseInt(delBtn.dataset.id, 10);
            const { error } = await db.from("deliveries").delete().eq("id", id);
            if (error) {
                console.error("DELETE DELIVERY ERROR:", error);
                handleSupabaseAuthError(error);
                alert("Neuspesno brisanje dostave.");
                delBtn.disabled = false;
                return;
            }
            const start = document.getElementById("filter-start").value || null;
            const end = document.getElementById("filter-end").value || null;
            await loadDeliveriesForLocation(selectedLocation.id, start, end);
        });

        container.appendChild(block);
    });
}

// =====================
// FILTER HANDLERS
// =====================

function handleApplyFilter() {
    if (!selectedLocation) {
        alert("Odaberite lokaciju prvo.");
        return;
    }
    const start = document.getElementById("filter-start").value || null;
    const end = document.getElementById("filter-end").value || null;
    loadDeliveriesForLocation(selectedLocation.id, start, end);
}

function handleResetFilter() {
    if (!selectedLocation) return;
    document.getElementById("filter-start").value = "";
    document.getElementById("filter-end").value = "";
    loadDeliveriesForLocation(selectedLocation.id, null, null);
}

// =====================
// HELPERS
// =====================

function formatNumber(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "0";
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function toLocalDateValue(d) {
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    return `${yyyy}-${mm}-${dd}`;
}

function escapeHtml(text) {
    if (!text) return "";
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/**
 * Handle common Supabase auth / permission errors.
 * If we get a 401 or a permission error, show a clear message in console and optionally alert user.
 */
function handleSupabaseAuthError(error) {
    if (!error) return;
    // supabase-js error shape: { message, details, hint, code, status }
    const status = error.status || (error.response && error.response.status) || null;
    if (status === 401 || /jwt|authorization/i.test(error.message || "") || /not authenticated/i.test(error.message || "")) {
        console.error("Supabase authorization error detected. Check your anon key and RLS policies.");
        // keep it non-intrusive in UI, but developer should see console
    }
}

// =====================
// SEARCH
// =====================

const handleSearch = debounce(() => {
    const q = searchInput.value;
    renderLocations(locationsCache, q);
}, 180);

searchInput.addEventListener("input", handleSearch);

// =====================
// INITIAL LOAD
// =====================

fetchLocations();