const state = {
  clientes: [],
  operaciones: [],
  cuenta: null,
  vista: "tablero",
  selectedClientId: "",
  showAllClients: false,
  selectedOperationId: "",
  categorias: [],
  tabRules: [],
  currentOperation: null,
  operationStep: "operation",
  usuario: null
};
let currentPaymentInstruments = [];

const currency = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2
});

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `No se pudo leer ${path}`);
  }
  return response.json();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setClientMessage(message, type = "") {
  const node = $("#client-message");
  node.textContent = message || "";
  node.className = `form-message ${type}`.trim();
}

function setRenspaMessage(message, type = "") {
  const node = $("#renspa-message");
  node.textContent = message || "";
  node.className = `form-message ${type}`.trim();
}

function setOperationMessage(message, type = "") {
  const node = $("#operation-message");
  node.textContent = message || "";
  node.className = `form-message ${type}`.trim();
}

function setSaleMessage(message, type = "") {
  const node = $("#sale-message");
  node.textContent = message || "";
  node.className = `form-message ${type}`.trim();
}

function setLiquidationMessage(message, type = "") {
  const node = $("#liquidation-message");
  node.textContent = message || "";
  node.className = `form-message ${type}`.trim();
}

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function setView(view) {
  state.vista = view;
  $all(".view").forEach((section) => section.classList.toggle("active", section.id === view));
  $all("nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const titles = {
    tablero: "Tablero",
    clientes: "Clientes",
    operaciones: "Operaciones",
    cuenta: "Cuenta corriente"
  };
  $("#view-title").textContent = titles[view] || "Sistema";
}

function applyUserRole(user) {
  state.usuario = user;
  const readonly = user && user.rol === "CONSULTA";
  const restricted = [
    "#client-form",
    "#operation-start-new",
    "#operation-new",
    "#sale-form",
    "#liquidation-form",
    "#cc-open-payment",
    "#cc-open-external",
    "#tab-save",
    "#category-admin-toggle"
  ];
  restricted.forEach((selector) => {
    const node = $(selector);
    if (node) node.hidden = Boolean(readonly);
  });
  $("#logout-button").hidden = !user || user.nombre === "Modo local";
}

async function login(event) {
  event.preventDefault();
  const message = $("#login-message");
  message.textContent = "Ingresando...";
  message.className = "form-message";
  try {
    await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#login-email").value, password: $("#login-password").value })
    });
    window.location.reload();
  } catch (error) {
    message.textContent = error.message;
    message.className = "form-message error";
  }
}

async function logout() {
  await fetchJson("/api/auth/logout", { method: "POST" });
  window.location.reload();
}

function renderMetrics() {
  $("#metric-clientes").textContent = state.clientes.length;
  $("#metric-operaciones").textContent = state.operaciones.length;
  $("#metric-movimientos").textContent = state.cuenta ? state.cuenta.movimientosExternos : "-";
  $("#metric-pagos").textContent = state.cuenta ? state.cuenta.pagosCobros : "-";
  $("#cc-total-movimientos").textContent = state.cuenta ? currency.format(state.cuenta.totalMovimientos) : "-";
  $("#cc-total-pagos").textContent = state.cuenta ? currency.format(state.cuenta.totalPagos) : "-";
  renderDashboardDueLists();
}

function amountClass(value) {
  return Number(value || 0) < 0 ? "amount-negative" : "amount-positive";
}

function dayDiffFromToday(value) {
  const due = parseDisplayDate(value);
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function dashboardDueRow(movement, mode) {
  const amount = Math.sign(Number(movement.importe || 0)) * Number(movement.importePendiente ?? Math.abs(Number(movement.importe || 0)));
  if (mode === "today") {
    return `<tr><td>${escapeHtml(movement.cliente || "-")}</td><td>${escapeHtml(movement.concepto || "-")}</td><td class="${amountClass(amount)}">${moneyValue(amount)}</td></tr>`;
  }
  return `<tr><td>${escapeHtml(movement.vencimiento || "-")}</td><td>${escapeHtml(movement.cliente || "-")}</td><td class="${amountClass(amount)}">${moneyValue(amount)}</td></tr>`;
}

function renderDashboardDueLists() {
  if (!state.cuenta) return;
  const due = (state.cuenta.vencimientos || [])
    .filter((movement) => !["IMPUTADO", "ANULADO"].includes(String(movement.estado || "").toUpperCase()))
    .map((movement) => ({ ...movement, days: dayDiffFromToday(movement.vencimiento) }))
    .filter((movement) => movement.days !== null)
    .sort((a, b) => a.days - b.days || String(a.cliente || "").localeCompare(String(b.cliente || ""), "es"));
  const today = due.filter((movement) => movement.days === 0);
  const week = due.filter((movement) => movement.days >= 0 && movement.days <= 7);
  $("#dashboard-due-today-count").textContent = `${today.length} pendiente/s`;
  $("#dashboard-due-week-count").textContent = `${week.length} pendiente/s`;
  $("#dashboard-due-today-body").innerHTML = today.length
    ? today.slice(0, 8).map((movement) => dashboardDueRow(movement, "today")).join("")
    : `<tr><td colspan="3">Sin vencimientos para hoy.</td></tr>`;
  $("#dashboard-due-week-body").innerHTML = week.length
    ? week.slice(0, 10).map((movement) => dashboardDueRow(movement, "week")).join("")
    : `<tr><td colspan="3">Sin vencimientos esta semana.</td></tr>`;
}

function movementAccountEntities(movement) {
  const entities = [movement.cliente];
  const isConsigneeOwnMovement = String(movement.origen || "").toUpperCase() === "CONSIGNATARIA";
  if (movement.consignatariaCuenta || isConsigneeOwnMovement) {
    entities.push(movement.consignataria || movement.cliente);
  }
  return entities.map(normalizeSearch).filter(Boolean);
}

function getExactCurrentAccountClient(query) {
  if (!query) return "";
  return (state.cuenta.movimientos || []).some((movement) => movementAccountEntities(movement).includes(query)) ? query : "";
}

function getExactCurrentAccountConsignee(query) {
  if (!query) return "";
  return (state.cuenta.movimientos || []).some((movement) => movementConsigneeKey(movement) === query) ? query : "";
}

function movementConsigneeKey(movement) {
  const isConsigneeOwnMovement = String(movement.origen || "").toUpperCase() === "CONSIGNATARIA";
  if (!movement.consignatariaCuenta && !isConsigneeOwnMovement) return "";
  return normalizeSearch(movement.consignataria || movement.cliente);
}

function matchesCurrentAccountClientSearch(movement, words, exactClient = "") {
  if (exactClient) return movementAccountEntities(movement).includes(exactClient);
  if (!words.length) return true;
  const haystack = normalizeSearch(`${movement.cliente} ${movement.contraparte || ""} ${movement.consignataria || ""} ${movement.comprobante} ${movement.concepto}`);
  return words.every((word) => haystack.includes(word));
}

function matchesCurrentAccountConsigneeSearch(movement, words, exactConsignee = "") {
  const consignee = movementConsigneeKey(movement);
  if (exactConsignee) return consignee === exactConsignee;
  if (!words.length) return true;
  const haystack = normalizeSearch(`${movement.consignataria || ""} ${movement.cliente || ""} ${movement.contraparte || ""} ${movement.comprobante || ""} ${movement.concepto || ""}`);
  return words.every((word) => haystack.includes(word));
}

function renderCuentaCorriente() {
  if (!state.cuenta) return;
  const query = normalizeSearch($("#cc-client-search").value);
  const viewMode = $("#cc-view-mode").value;
  const statusFilter = $("#cc-status-filter").value;
  const conceptFilter = $("#cc-concept-filter").value;
  const dueFilter = $("#cc-due-filter").value;
  const words = query.split(" ").filter(Boolean);
  const exactClient = viewMode === "CONSIGNATARIA" ? "" : getExactCurrentAccountClient(query);
  const exactConsignee = viewMode === "CONSIGNATARIA" ? getExactCurrentAccountConsignee(query) : "";
  const allMovements = state.cuenta.movimientos || [];
  const movements = allMovements.filter((movement) => {
    const matchesEntity = viewMode === "CONSIGNATARIA"
      ? matchesCurrentAccountConsigneeSearch(movement, words, exactConsignee)
      : matchesCurrentAccountClientSearch(movement, words, exactClient);
    if (!matchesEntity) return false;
    if (statusFilter !== "TODOS" && String(movement.estado || "").toUpperCase() !== statusFilter) return false;
    if (conceptFilter === "COMISION" && (String(movement.origen || "").toUpperCase() !== "COMISION" || String(movement.estado || "").toUpperCase() === "IMPUTADO")) return false;
    return matchesCurrentAccountDueFilter(movement, dueFilter);
  });
  const balance = movements.reduce((sum, movement) => sum + Number(movement.importe || 0), 0);
  const selectedClient = words.length ? $("#cc-client-search").value.trim() : (viewMode === "CONSIGNATARIA" ? "Todas las consignatarias" : "Todos");

  $("#cc-selected-client").textContent = selectedClient || "Todos";
  $("#cc-selected-balance").textContent = moneyValue(balance);
  $("#cc-selected-balance").className = amountClass(balance);
  $("#cc-selected-count").textContent = movements.length;

  $("#cc-movements-body").innerHTML = movements.length
    ? movements.slice(0, 200).map((movement) => `
        <tr class="${normalizeSearch(movement.concepto).includes("efectivo") ? "movement-cash" : ""} ${movement.estado === "ANULADO" ? "movement-cancelled" : ""}">
          <td>${escapeHtml(movement.fecha || "-")}</td>
          <td>${escapeHtml(movement.vencimiento || "-")}</td>
          <td>${escapeHtml(movement.cliente || "-")}</td>
          <td>${escapeHtml(viewMode === "CONSIGNATARIA" && movement.consignataria ? `${movement.concepto || "-"} | Consignataria: ${movement.consignataria}` : movement.concepto || "-")}</td>
          <td>${escapeHtml(movement.comprobante || "-")}</td>
          <td>${escapeHtml(movement.operacion || "-")}</td>
          <td class="${amountClass(movement.importe)}">${moneyValue(Math.sign(movement.importe) * Number(movement.importePendiente ?? Math.abs(movement.importe)))}</td>
          <td>${escapeHtml(movement.estado || "-")}</td>
          <td>${movement.paymentId ? `<button type="button" class="small-button" data-cc-payment-receipt="${escapeHtml(movement.paymentId)}">Ver comprobante</button>${movement.estado === "ANULADO" ? "" : ` <button type="button" class="small-button danger-button" data-cc-payment-cancel="${escapeHtml(movement.paymentId)}">Anular</button>`}` : movement.operacion ? `<button type="button" class="small-button" data-cc-operation-report="${escapeHtml(movement.operacion)}">Ver comprobante</button>` : ""}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="9">Sin movimientos para esta busqueda.</td></tr>`;

  const due = (state.cuenta.vencimientos || []).filter((movement) => {
    const matchesEntity = viewMode === "CONSIGNATARIA"
      ? matchesCurrentAccountConsigneeSearch(movement, words, exactConsignee)
      : matchesCurrentAccountClientSearch(movement, words, exactClient);
    if (!matchesEntity) return false;
    if (conceptFilter === "COMISION" && String(movement.origen || "").toUpperCase() !== "COMISION") return false;
    return matchesCurrentAccountDueFilter(movement, dueFilter);
  });
  $("#cc-due-body").innerHTML = due.length
    ? due.slice(0, 80).map((movement) => `
        <tr class="${normalizeSearch(movement.concepto).includes("efectivo") ? "movement-cash" : ""}">
          <td>${escapeHtml(movement.vencimiento || "-")}</td>
          <td>${escapeHtml(movement.cliente || "-")}</td>
          <td>${escapeHtml(movement.concepto || "-")}</td>
          <td>${escapeHtml(movement.comprobante || "-")}</td>
          <td class="${amountClass(movement.importe)}">${moneyValue(movement.importe)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="5">Sin vencimientos pendientes para esta busqueda.</td></tr>`;
}

function matchesCurrentAccountDueFilter(movement, filter) {
  if (!filter || filter === "TODOS") return true;
  if (String(movement.estado || "").toUpperCase() === "IMPUTADO") return false;
  const due = parseDisplayDate(movement.vencimiento);
  if (!due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (filter === "VENCIDOS") return days < 0;
  return days >= 0 && days <= Number(filter);
}

function populateCurrentAccountClients() {
  const consignees = Array.from(new Set((state.cuenta?.movimientos || [])
    .map((movement) => {
      const isConsigneeOwnMovement = String(movement.origen || "").toUpperCase() === "CONSIGNATARIA";
      return movement.consignatariaCuenta || isConsigneeOwnMovement ? movement.consignataria || movement.cliente : "";
    })
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "es"));
  const names = Array.from(new Set([
    ...state.clientes.map((client) => client.nombre),
    ...consignees
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
  $("#cc-client-list").innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
}

async function reloadCurrentAccount() {
  state.cuenta = await fetchJson("/api/cuenta-corriente/resumen");
  renderMetrics();
  renderCuentaCorriente();
}

function openCurrentAccountPanel(panelId) {
  $("#cc-external-panel").hidden = panelId !== "#cc-external-panel";
  $("#cc-payment-panel").hidden = panelId !== "#cc-payment-panel";
  const today = new Date().toISOString().slice(0, 10);
  if (panelId === "#cc-external-panel") {
    $("#cc-external-client").value = $("#cc-client-search").value;
    $("#cc-external-date").value = today;
    $("#cc-external-due").value = today;
    setMoneyInput("#cc-external-amount", 0);
  } else {
    $("#cc-payment-client").value = $("#cc-client-search").value;
    $("#cc-payment-date").value = today;
    setMoneyInput("#cc-payment-amount", 0);
    currentPaymentInstruments = [];
    $("#cc-instrument-date").value = today;
    setMoneyInput("#cc-instrument-amount", 0);
    $("#cc-counterparty-enabled").checked = false;
    $("#cc-counterparty-panel").hidden = true;
    $("#cc-counterparty-client").value = "";
    $("#cc-counterparty-type").value = $("#cc-payment-type").value === "PAGO" ? "COBRO" : "PAGO";
    renderCurrentAccountInstruments();
    renderCurrentAccountImputations();
    renderCurrentAccountCounterpartyImputations();
  }
}

function getPaymentPendingMovements(clientSelector = "#cc-payment-client", typeSelector = "#cc-payment-type") {
  const client = normalizeSearch($(clientSelector).value);
  const type = $(typeSelector).value;
  return (state.cuenta.movimientos || []).filter((movement) => {
    if (normalizeSearch(movement.cliente) !== client || String(movement.estado || "").toUpperCase() === "IMPUTADO") return false;
    return type === "PAGO" ? Number(movement.importe) < 0 : Number(movement.importe) > 0;
  });
}

function renderCurrentAccountCounterpartyImputations() {
  const movements = getPaymentPendingMovements("#cc-counterparty-client", "#cc-counterparty-type");
  $("#cc-counterparty-summary").textContent = movements.length ? `${movements.length} pendiente/s disponibles` : "Sin pendientes para imputar";
  $("#cc-counterparty-body").innerHTML = movements.length
    ? movements.map((movement) => `<tr><td><input type="checkbox" data-cc-counterparty-impute="${escapeHtml(movement.id)}" data-cc-pending="${Number(movement.importePendiente ?? Math.abs(movement.importe))}"></td><td>${escapeHtml(movement.vencimiento || "-")}</td><td>${escapeHtml(movement.concepto || "-")}</td><td>${escapeHtml(movement.comprobante || "-")}</td><td>${moneyValue(movement.importePendiente ?? Math.abs(movement.importe))}</td></tr>`).join("")
    : `<tr><td colspan="5">Sin pendientes para imputar.</td></tr>`;
}

function renderCurrentAccountImputations() {
  const movements = getPaymentPendingMovements();
  $("#cc-imputation-summary").textContent = movements.length ? `${movements.length} pendiente/s disponibles` : "Sin pendientes para imputar";
  $("#cc-imputation-body").innerHTML = movements.length
    ? movements.map((movement) => `<tr><td><input type="checkbox" data-cc-impute="${escapeHtml(movement.id)}" data-cc-pending="${Number(movement.importePendiente ?? Math.abs(movement.importe))}"></td><td>${escapeHtml(movement.vencimiento || "-")}</td><td>${escapeHtml(movement.concepto || "-")}</td><td>${escapeHtml(movement.comprobante || "-")}</td><td>${moneyValue(movement.importePendiente ?? Math.abs(movement.importe))}</td></tr>`).join("")
    : `<tr><td colspan="5">Sin pendientes para imputar.</td></tr>`;
}

function updateCurrentAccountImputationSummary({ selector, summarySelector, availableText, updatePaymentAmount = false }) {
  const selected = $all(selector);
  const total = selected.reduce((sum, checkbox) => sum + Number(checkbox.dataset.ccPending || 0), 0);
  $(summarySelector).textContent = selected.length
    ? `${selected.length} seleccionado/s - ${moneyValue(total)}`
    : availableText;
  if (updatePaymentAmount && selected.length && !currentPaymentInstruments.length) {
    setMoneyInput("#cc-payment-amount", total);
  }
}

function refreshPrimaryImputationSummary() {
  const available = getPaymentPendingMovements().length;
  updateCurrentAccountImputationSummary({
    selector: "[data-cc-impute]:checked",
    summarySelector: "#cc-imputation-summary",
    availableText: available ? `${available} pendiente/s disponibles` : "Sin pendientes para imputar",
    updatePaymentAmount: true
  });
}

function refreshCounterpartyImputationSummary() {
  const available = getPaymentPendingMovements("#cc-counterparty-client", "#cc-counterparty-type").length;
  updateCurrentAccountImputationSummary({
    selector: "[data-cc-counterparty-impute]:checked",
    summarySelector: "#cc-counterparty-summary",
    availableText: available ? `${available} pendiente/s disponibles` : "Sin pendientes para imputar"
  });
}

function addCurrentAccountInstrument() {
  const importe = numberValue("#cc-instrument-amount");
  if (!importe) return;
  currentPaymentInstruments.push({
    id: `INST-${Date.now()}`,
    medio: $("#cc-instrument-method").value,
    fecha: $("#cc-instrument-date").value,
    referencia: $("#cc-instrument-reference").value,
    importe
  });
  setMoneyInput("#cc-instrument-amount", 0);
  $("#cc-instrument-reference").value = "";
  renderCurrentAccountInstruments();
}

function renderCurrentAccountInstruments() {
  const total = currentPaymentInstruments.reduce((sum, item) => sum + Number(item.importe || 0), 0);
  $("#cc-instrument-summary").textContent = currentPaymentInstruments.length ? `${currentPaymentInstruments.length} instrumento/s - ${moneyValue(total)}` : "Sin instrumentos cargados";
  if (total) setMoneyInput("#cc-payment-amount", total);
  $("#cc-instrument-body").innerHTML = currentPaymentInstruments.length
    ? currentPaymentInstruments.map((item) => `<tr><td>${escapeHtml(item.medio)}</td><td>${escapeHtml(item.fecha)}</td><td>${escapeHtml(item.referencia || "-")}</td><td>${moneyValue(item.importe)}</td><td><button type="button" class="small-button danger-button" data-cc-remove-instrument="${escapeHtml(item.id)}">Quitar</button></td></tr>`).join("")
    : `<tr><td colspan="5">Sin instrumentos cargados.</td></tr>`;
}

async function saveExternalCurrentAccountMovement() {
  try {
    await fetchJson("/api/cuenta-corriente/movimientos-externos", {
      method: "POST",
      body: JSON.stringify({
        cliente: $("#cc-external-client").value,
        direccion: $("#cc-external-direction").value,
        concepto: $("#cc-external-concept").value,
        comprobante: $("#cc-external-receipt").value,
        fechaVenta: $("#cc-external-date").value,
        vencimiento: $("#cc-external-due").value,
        importe: numberValue("#cc-external-amount"),
        observacion: $("#cc-external-notes").value
      })
    });
    $("#cc-external-panel").hidden = true;
    await reloadCurrentAccount();
  } catch (error) {
    $("#cc-external-message").textContent = error.message;
    $("#cc-external-message").className = "form-message error";
  }
}

function printCurrentAccountReceipt(payment) {
  const popup = window.open("", "_blank", "width=900,height=800");
  if (!popup) return;
  const instruments = payment.instrumentos?.length ? payment.instrumentos : [{ medio: payment.medio, fecha: payment.fecha, referencia: payment.referencia, importe: payment.importe }];
  const imputations = payment.imputaciones || [];
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(payment.id)}</title><style>
    body{font-family:Arial,sans-serif;margin:18mm;color:#173632} header{display:flex;align-items:center;gap:18px;border-bottom:2px solid #173632;padding-bottom:12px} img{width:92px;height:92px;object-fit:contain;background:#173632;padding:8px} h1{font-size:20px;margin:0} h2{font-size:15px;margin-top:22px} p{margin:5px 0} table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #cbd7d4;padding:7px;text-align:left} th{background:#edf3f1} .amount{text-align:right;font-weight:700} button{margin-top:18px;padding:9px 14px}@media print{button{display:none}}
  </style></head><body>
  <header><img src="${window.location.origin}/logo-espinosa-blanco.png"><div><h1>${payment.tipo === "PAGO" ? "Comprobante de pago" : "Comprobante de cobro"}</h1><p><strong>${escapeHtml(payment.id)}</strong></p><p>Gonzalo Espinosa - Hacienda y Liquidaciones</p></div></header>
  ${payment.anulado ? `<p><strong>COMPROBANTE ANULADO</strong></p>` : ""}
  <p><strong>Cliente:</strong> ${escapeHtml(payment.cliente)}</p><p><strong>Fecha:</strong> ${escapeHtml(payment.fecha)}</p><p><strong>Importe:</strong> ${moneyValue(payment.importe)}</p><p><strong>Referencia:</strong> ${escapeHtml(payment.referencia || "-")}</p>
  <h2>Detalle de instrumentos</h2><table><thead><tr><th>Medio</th><th>Fecha</th><th>Referencia</th><th>Importe</th></tr></thead><tbody>${instruments.map((item) => `<tr><td>${escapeHtml(item.medio)}</td><td>${escapeHtml(item.fecha)}</td><td>${escapeHtml(item.referencia || "-")}</td><td class="amount">${moneyValue(item.importe)}</td></tr>`).join("")}</tbody></table>
  <h2>Imputaciones</h2><table><thead><tr><th>Vencimiento</th><th>Comprobante</th><th>Concepto</th><th>Importe aplicado</th><th>Saldo pendiente</th></tr></thead><tbody>${imputations.length ? imputations.map((item) => `<tr><td>${escapeHtml(item.vencimiento || "-")}</td><td>${escapeHtml(item.comprobante || "-")}</td><td>${escapeHtml(item.concepto || item.movementId)}</td><td class="amount">${moneyValue(item.importe)}</td><td class="amount">${moneyValue(item.saldoPendiente)}</td></tr>`).join("") : `<tr><td colspan="5">Sin imputacion puntual</td></tr>`}</tbody></table>
  <button onclick="window.print()">Imprimir / guardar PDF</button></body></html>`);
  popup.document.close();
}

function getCurrentAccountReportFilters() {
  const query = normalizeSearch($("#cc-client-search").value);
  return {
    query,
    words: query.split(" ").filter(Boolean),
    exactClient: getExactCurrentAccountClient(query),
    statusFilter: $("#cc-status-filter").value,
    dueFilter: $("#cc-due-filter").value,
    conceptFilter: $("#cc-concept-filter").value
  };
}

function matchesCurrentAccountReportFilters(movement, filters, includeDueFilter = false, includeStatusFilter = false) {
  return matchesCurrentAccountClientSearch(movement, filters.words, filters.exactClient)
    && (filters.conceptFilter !== "COMISION" || String(movement.origen || "").toUpperCase() === "COMISION")
    && (!includeStatusFilter || filters.statusFilter === "TODOS" || String(movement.estado || "").toUpperCase() === filters.statusFilter)
    && (!includeDueFilter || matchesCurrentAccountDueFilter(movement, filters.dueFilter));
}

function currentAccountReportStyles() {
  return `body{font-family:Arial,sans-serif;margin:12mm;color:#173632} header{display:flex;align-items:center;gap:16px;border-bottom:2px solid #173632;padding-bottom:10px} img{width:84px;height:84px;object-fit:contain;background:#173632;padding:6px} h1{font-size:20px;margin:0} h2{font-size:14px;margin:18px 0 0} p{margin:4px 0}.summary{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.summary div{border:1px solid #cbd7d4;padding:7px 9px;min-width:150px}.summary span{display:block;color:#52706b;font-size:10px}.summary strong{font-size:14px}table{width:100%;border-collapse:collapse;font-size:9px;margin-top:9px}th,td{border:1px solid #cbd7d4;padding:5px;text-align:left;vertical-align:top}th{background:#edf3f1}.amount{text-align:right;font-weight:700;white-space:nowrap}.negative{color:#9b1c1c}.positive{color:#0f6b43}.allocation-row td{background:#f8fbfa;color:#52706b;font-size:8.5px}.allocation-label{padding-left:16px!important}.status{font-weight:700}.compact{max-width:720px}button{margin-top:18px;padding:9px 14px}@media print{@page{size:A4 portrait;margin:8mm}button{display:none}}`;
}

function currentAccountImputationsByMovement() {
  const result = new Map();
  (state.cuenta.pagos || []).filter((payment) => !payment.anulado).forEach((payment) => {
    (payment.imputaciones || []).forEach((imputation) => {
      const key = String(imputation.movementId || "");
      if (!key) return;
      if (!result.has(key)) result.set(key, []);
      result.get(key).push({
        ...imputation,
        paymentId: payment.id,
        fecha: payment.fecha,
        tipo: payment.tipo,
        medio: payment.medio,
        referencia: payment.referencia
      });
    });
  });
  return result;
}

function currentAccountReportMovementRows(rows, imputationsByMovement) {
  if (!rows.length) return `<tr><td colspan="10">Sin movimientos para los filtros aplicados.</td></tr>`;
  return rows.map((movement) => {
    const isPayment = Boolean(movement.paymentId);
    const original = Number(movement.importe || 0);
    const imputed = isPayment ? null : Math.sign(original) * Number(movement.importeImputado || 0);
    const pending = isPayment ? null : Math.sign(original) * Number(movement.importePendiente ?? Math.abs(original));
    const imputations = imputationsByMovement.get(String(movement.id)) || [];
    const allocationRows = imputations.map((item) => `
      <tr class="allocation-row">
        <td>${escapeHtml(item.fecha || "-")}</td>
        <td></td>
        <td colspan="4" class="allocation-label">Imputacion ${escapeHtml(item.paymentId)} - ${escapeHtml(item.tipo || "")} ${escapeHtml(item.medio || "")}${item.referencia ? ` - ${escapeHtml(item.referencia)}` : ""}</td>
        <td></td>
        <td class="amount">${moneyValue(item.importe)}</td>
        <td></td>
        <td></td>
      </tr>`).join("");
    return `<tr>
      <td>${escapeHtml(movement.fecha || "-")}</td>
      <td>${escapeHtml(movement.vencimiento || "-")}</td>
      <td>${escapeHtml(movement.cliente || "-")}</td>
      <td>${escapeHtml(movement.concepto || "-")}</td>
      <td>${escapeHtml(movement.comprobante || "-")}</td>
      <td>${escapeHtml(movement.operacion || "-")}</td>
      <td class="amount ${original < 0 ? "negative" : "positive"}">${moneyValue(original)}</td>
      <td class="amount">${imputed === null ? "-" : moneyValue(imputed)}</td>
      <td class="amount ${pending !== null && pending < 0 ? "negative" : "positive"}">${pending === null ? "-" : moneyValue(pending)}</td>
      <td class="status">${escapeHtml(movement.estado || "-")}</td>
    </tr>${allocationRows}`;
  }).join("");
}

function pendingSignedAmount(movement) {
  return Math.sign(Number(movement.importe || 0)) * Number(movement.importePendiente ?? Math.abs(Number(movement.importe || 0)));
}

function printCurrentAccountReport(forcedType = "") {
  const type = forcedType || $("#cc-report-type").value;
  const filters = getCurrentAccountReportFilters();
  const popup = window.open("", "_blank", "width=1100,height=850");
  if (!popup) return;
  const title = type === "SALDOS" ? "Estado de cuenta completo" : type === "VENCIMIENTOS" ? "Estado de cuenta - vencimientos pendientes" : "Estado de cuenta - movimientos pendientes";
  const allMovements = state.cuenta.movimientos || [];
  const rows = allMovements
    .filter((movement) => filters.statusFilter === "ANULADO" ? movement.estado === "ANULADO" : movement.estado !== "ANULADO")
    .filter((movement) => type === "SALDOS" || (!movement.paymentId && movement.estado !== "IMPUTADO"))
    .filter((movement) => matchesCurrentAccountReportFilters(movement, filters, type === "VENCIMIENTOS" || filters.dueFilter !== "TODOS", filters.statusFilter !== "TODOS"))
    .sort((a, b) => {
      const dateA = parseDisplayDate(type === "SALDOS" ? a.fecha : a.vencimiento)?.getTime() || 0;
      const dateB = parseDisplayDate(type === "SALDOS" ? b.fecha : b.vencimiento)?.getTime() || 0;
      return dateA - dateB;
    });
  const accountBalance = rows.reduce((sum, movement) => sum + Number(movement.importe || 0), 0);
  const pendingBalance = rows.filter((movement) => !movement.paymentId)
    .reduce((sum, movement) => sum + Math.sign(movement.importe) * Number(movement.importePendiente ?? Math.abs(movement.importe)), 0);
  const applied = rows.filter((movement) => !movement.paymentId)
    .reduce((sum, movement) => sum + Number(movement.importeImputado || 0), 0);
  const imputationsByMovement = currentAccountImputationsByMovement();
  const balances = new Map();
  const commissionBalances = new Map();
  rows.forEach((movement) => {
    balances.set(movement.cliente, (balances.get(movement.cliente) || 0) + Number(movement.importe || 0));
    if (String(movement.origen || "").toUpperCase() === "COMISION" && String(movement.estado || "").toUpperCase() !== "IMPUTADO") {
      commissionBalances.set(movement.cliente, (commissionBalances.get(movement.cliente) || 0) + pendingSignedAmount(movement));
    }
  });
  const commissionTotal = [...commissionBalances.values()].reduce((sum, amount) => sum + Number(amount || 0), 0);
  const balanceRows = [...balances.entries()]
    .map(([cliente, saldo]) => ({ cliente, saldo, comision: commissionBalances.get(cliente) || 0 }))
    .filter((item) => Math.abs(item.saldo) > 0.01 || Math.abs(item.comision) > 0.01)
    .sort((a, b) => Math.abs(b.comision || 0) - Math.abs(a.comision || 0) || Math.abs(b.saldo) - Math.abs(a.saldo));
  const commissionRows = [...commissionBalances.entries()]
    .map(([cliente, saldo]) => ({ cliente, saldo }))
    .filter((item) => Math.abs(item.saldo) > 0.01)
    .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));
  const balancesTable = type === "SALDOS" ? `<h2>Saldo por cliente</h2><table class="compact"><thead><tr><th>Cliente</th><th>Saldo</th><th>Comision pendiente</th></tr></thead><tbody>${balanceRows.length ? balanceRows.map((item) => `<tr><td>${escapeHtml(item.cliente)}</td><td class="amount ${item.saldo < 0 ? "negative" : "positive"}">${moneyValue(item.saldo)}</td><td class="amount ${item.comision < 0 ? "negative" : "positive"}">${Math.abs(item.comision) > 0.01 ? moneyValue(item.comision) : "-"}</td></tr>`).join("") : `<tr><td colspan="3">Sin saldos para los filtros aplicados.</td></tr>`}</tbody></table>` : "";
  const commissionsTable = commissionRows.length ? `<h2>Comisiones pendientes</h2><table class="compact"><thead><tr><th>Cliente / productor</th><th>Comision pendiente</th></tr></thead><tbody>${commissionRows.map((item) => `<tr><td>${escapeHtml(item.cliente)}</td><td class="amount ${item.saldo < 0 ? "negative" : "positive"}">${moneyValue(item.saldo)}</td></tr>`).join("")}<tr><th>Total comisiones</th><td class="amount ${commissionTotal < 0 ? "negative" : "positive"}">${moneyValue(commissionTotal)}</td></tr></tbody></table>` : "";

  const filterLabel = $("#cc-client-search").value.trim() || "Todos los clientes";
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${currentAccountReportStyles()}</style></head><body>
  <header><img src="${window.location.origin}/logo-espinosa-blanco.png"><div><h1>${escapeHtml(title)}</h1><p>Gonzalo Espinosa - Hacienda y Liquidaciones</p><p>Emitido: ${escapeHtml(new Date().toLocaleDateString("es-AR"))}</p></div></header>
  <div class="summary"><div><span>Filtro de cliente</span><strong>${escapeHtml(filterLabel)}</strong></div><div><span>Saldo de los movimientos</span><strong>${moneyValue(accountBalance)}</strong></div><div><span>Total imputado</span><strong>${moneyValue(applied)}</strong></div><div><span>Saldo pendiente</span><strong>${moneyValue(pendingBalance)}</strong></div><div><span>Comisiones pendientes</span><strong>${moneyValue(commissionTotal)}</strong></div></div>
  ${balancesTable}
  ${commissionsTable}
  <h2>Detalle de movimientos e imputaciones</h2>
  <table><thead><tr><th>Fecha</th><th>Vencimiento</th><th>Cliente</th><th>Concepto</th><th>Comprobante</th><th>Operacion</th><th>Importe original</th><th>Imputado</th><th>Saldo pendiente</th><th>Estado</th></tr></thead><tbody>${currentAccountReportMovementRows(rows, imputationsByMovement)}</tbody></table><button onclick="window.print()">Imprimir / guardar PDF</button></body></html>`);
  popup.document.close();
}

function printCurrentAccountDueReport() {
  $("#cc-report-type").value = "VENCIMIENTOS";
  printCurrentAccountReport("VENCIMIENTOS");
}

async function saveCurrentAccountPayment(printReceipt = false) {
  try {
    const amount = numberValue("#cc-payment-amount");
    const response = await fetchJson("/api/cuenta-corriente/pagos-cobros", {
      method: "POST",
      body: JSON.stringify({
        tipo: $("#cc-payment-type").value,
        cliente: $("#cc-payment-client").value,
        fecha: $("#cc-payment-date").value,
        importe: amount,
        medio: $("#cc-payment-method").value,
        referencia: $("#cc-payment-reference").value,
        observacion: $("#cc-payment-notes").value,
        instrumentos: currentPaymentInstruments,
        imputaciones: collectSelectedCurrentAccountImputations("[data-cc-impute]:checked", amount),
        contrapartida: $("#cc-counterparty-enabled").checked ? {
          tipo: $("#cc-counterparty-type").value,
          cliente: $("#cc-counterparty-client").value,
          imputaciones: collectSelectedCurrentAccountImputations("[data-cc-counterparty-impute]:checked", amount)
        } : null
      })
    });
    $("#cc-payment-panel").hidden = true;
    await reloadCurrentAccount();
    if (printReceipt) printCurrentAccountReceipt(response.item);
  } catch (error) {
    $("#cc-payment-message").textContent = error.message;
    $("#cc-payment-message").className = "form-message error";
  }
}

function collectSelectedCurrentAccountImputations(selector, availableAmount) {
  let remaining = Math.abs(Number(availableAmount || 0));
  return $all(selector).map((checkbox) => {
    const importe = Math.min(Number(checkbox.dataset.ccPending || 0), remaining);
    remaining -= importe;
    return { movementId: checkbox.dataset.ccImpute || checkbox.dataset.ccCounterpartyImpute, importe };
  }).filter((item) => item.movementId && item.importe > 0);
}

function renderClientes() {
  const query = $("#client-search").value.trim().toLowerCase();
  const hasFilter = Boolean(query);
  $("#client-list-hint").textContent = hasFilter
    ? "Resultados de la busqueda."
    : state.showAllClients ? "Listado completo visible." : "Escriba para buscar un cliente o use Ver todos.";
  $("#client-show-all").textContent = state.showAllClients ? "Ocultar listado" : "Ver todos";
  if (!hasFilter && !state.showAllClients) {
    $("#clientes-body").innerHTML = `<tr><td colspan="4">La lista se mostrara cuando busque un cliente.</td></tr>`;
    return;
  }
  const rows = state.clientes.filter((client) => {
    const haystack = `${client.nombre} ${client.cuit} ${client.tipo}`.toLowerCase();
    return haystack.includes(query);
  });

  $("#clientes-body").innerHTML = rows
    .map((client) => `
      <tr data-client-id="${escapeHtml(client.id)}">
        <td>${escapeHtml(client.nombre)}</td>
        <td>${escapeHtml(client.cuit || "-")}</td>
        <td>${escapeHtml(client.tipo || "-")}</td>
        <td><button type="button" class="small-button" data-edit-client="${escapeHtml(client.id)}">Editar</button></td>
      </tr>
    `)
    .join("");
}

function closeSuggestions(except = null) {
  $all(".suggestions").forEach((node) => {
    if (node === except) return;
    node.hidden = true;
    node.innerHTML = "";
  });
}

function renderClientNameSuggestions() {
  const node = $("#client-name-suggestions");
  const query = normalizeSearch($("#client-name").value);
  const currentId = $("#client-id").value;

  if (query.length < 3) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }

  const words = query.split(" ").filter(Boolean);
  const matches = state.clientes
    .filter((client) => String(client.id) !== String(currentId))
    .filter((client) => {
      const haystack = normalizeSearch(`${client.nombre} ${client.cuit}`);
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, 6);

  node.hidden = false;
  node.innerHTML = matches.length
    ? matches.map((client) => `
        <div class="suggestion-row">
          <div>
            <strong>${escapeHtml(client.nombre)}</strong>
            <span>${escapeHtml(client.cuit || "Sin CUIT")} - ${escapeHtml(client.tipo || "Cliente")}</span>
          </div>
          <button type="button" class="small-button" data-suggest-client="${escapeHtml(client.id)}">Abrir</button>
        </div>
      `).join("")
    : `<div class="suggestion-empty">No aparece un cliente existente con ese nombre.</div>`;
}

function renderOperaciones() {
  $("#operaciones-body").innerHTML = state.operaciones
    .map((operation) => `
      <tr>
        <td>${escapeHtml(operation.id)}</td>
        <td>${escapeHtml(operation.fecha || "-")}</td>
        <td>${escapeHtml(operationTypeLabel(operation))}</td>
        <td>${escapeHtml(operation.vendedor || "-")}</td>
        <td>${escapeHtml(operation.comprador || operation.consignataria || "-")}</td>
        <td>${escapeHtml(operation.total || "-")}</td>
        <td><button type="button" class="small-button" data-open-sale="${escapeHtml(operation.id)}">Continuar</button></td>
      </tr>
    `)
    .join("");
}

function renderCategories() {
  renderCategorySuggestions();
  renderCategoryAdmin();
}

function renderCategoryAdmin() {
  const node = $("#category-admin-body");
  if (!node) return;
  const query = normalizeSearch($("#category-admin-search").value);
  const matches = state.categorias
    .filter((category) => !query || normalizeSearch(category).includes(query))
    .slice(0, 100);
  node.innerHTML = matches.length
    ? matches.map((category) => `
        <tr>
          <td><input value="${escapeHtml(category)}" data-category-original="${escapeHtml(category)}"></td>
          <td>
            <button type="button" class="small-button" data-save-category="${escapeHtml(category)}">Guardar</button>
            <button type="button" class="small-button danger-button" data-delete-category="${escapeHtml(category)}">Quitar</button>
          </td>
        </tr>
      `).join("")
    : `<tr><td colspan="2">No hay categorias que coincidan con la busqueda.</td></tr>`;
}

async function reloadCategories() {
  const categorias = await fetchJson("/api/categorias");
  state.categorias = categorias.items || [];
  renderCategories();
}

async function saveCategory(original, value) {
  try {
    await fetchJson(`/api/categorias/${encodeURIComponent(original)}`, {
      method: "PUT",
      body: JSON.stringify({ nombre: value })
    });
    await reloadCategories();
    setCategoryAdminMessage("Categoria actualizada correctamente.", "ok");
  } catch (error) {
    setCategoryAdminMessage(error.message, "error");
  }
}

async function deleteCategory(category) {
  try {
    await fetchJson(`/api/categorias/${encodeURIComponent(category)}`, { method: "DELETE" });
    await reloadCategories();
    setCategoryAdminMessage("Categoria retirada de la lista.", "ok");
  } catch (error) {
    setCategoryAdminMessage(error.message, "error");
  }
}

function setCategoryAdminMessage(message, type = "") {
  $("#category-admin-message").textContent = message;
  $("#category-admin-message").className = `form-message ${type}`.trim();
}

function renderTabRules() {
  $("#sale-tab-rules-list").innerHTML = state.tabRules
    .map((rule) => `<option value="${escapeHtml(rule.codigo || "")}"></option>`)
    .join("");
}

async function saveTabRule() {
  const payload = {
    codigo: $("#tab-code").value,
    promMin: parseMoneyInput($("#tab-min").value),
    promMax: $("#tab-max").value ? parseMoneyInput($("#tab-max").value) : "",
    ajustePorPaso: parseMoneyInput($("#tab-adjustment").value),
    pasoKg: parseMoneyInput($("#tab-step").value) || 1,
    modoCalculo: $("#tab-mode").value
  };
  try {
    const saved = await fetchJson("/api/tabs", { method: "POST", body: JSON.stringify(payload) });
    const tabs = await fetchJson("/api/tabs");
    state.tabRules = tabs.items || [];
    renderTabRules();
    if (!$("#sale-tab-vend").value) $("#sale-tab-vend").value = saved.item.codigo;
    if (!$("#sale-tab-comp").value) $("#sale-tab-comp").value = saved.item.codigo;
    $("#tab-message").textContent = `TAB ${saved.item.codigo} guardada.`;
    $("#tab-message").className = "form-message ok";
    renderSalePreview();
  } catch (error) {
    $("#tab-message").textContent = error.message;
    $("#tab-message").className = "form-message error";
  }
}

function renderCategorySuggestions() {
  const node = $("#sale-category-suggestions");
  const query = normalizeSearch($("#sale-category").value);
  if (!query) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }

  const words = query.split(" ").filter(Boolean);
  const matches = state.categorias
    .filter((category) => words.every((word) => normalizeSearch(category).includes(word)))
    .slice(0, 8);
  const exact = matches.some((category) => normalizeSearch(category) === query);

  node.hidden = false;
  node.innerHTML = [
    ...matches.map((category) => `
      <div class="suggestion-row">
        <div>
          <strong>${escapeHtml(category)}</strong>
          <span>Categoria existente</span>
        </div>
        <button type="button" class="small-button" data-pick-category="${escapeHtml(category)}">Elegir</button>
      </div>
    `),
    !exact ? `<div class="suggestion-empty">No existe exactamente. Se agregara al guardar la linea.</div>` : ""
  ].join("");
}

function renderSaleLines(lines) {
  const totalCabezas = lines.reduce((sum, line) => sum + Number(line.cabezas || 0), 0);
  const totalImporte = lines.reduce((sum, line) => sum + Number(line.importeVend || 0), 0);
  $("#sale-lines-summary").textContent = lines.length
    ? `${lines.length} linea${lines.length === 1 ? "" : "s"} - ${totalCabezas} cab. - ${currency.format(totalImporte)}`
    : "Sin lineas";
  $("#sale-lines-body").innerHTML = lines.length
    ? lines.map((line) => `
        <tr>
          <td>${escapeHtml(line.categoria)}</td>
          <td>${escapeHtml(line.cabezas || 0)}</td>
          <td>${escapeHtml(line.kgNetoVend || 0)}</td>
          <td>${currency.format(Number(line.precioVend || 0))}</td>
          <td>${currency.format(Number(line.importeVend || 0))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="5">Sin lineas cargadas todavia.</td></tr>`;
}

function moneyValue(value) {
  return currency.format(Number(value || 0));
}

function parseMoneyInput(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value || "");
  let text = raw
    .replace(/\$/g, "")
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .trim();
  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (hasComma && hasDot) {
    const decimalSeparator = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    text = text.replace(new RegExp(`\\${thousandsSeparator}`, "g"), "").replace(decimalSeparator, ".");
  } else if (hasComma || hasDot) {
    const separator = hasComma ? "," : ".";
    const parts = text.split(separator);
    const formattedThousands = raw.includes("$") && separator === "." && parts.length > 1 && parts.slice(1).every((part) => part.length === 3);
    const repeatedThousands = parts.length > 2 && parts.slice(1).every((part) => part.length === 3);
    text = formattedThousands || repeatedThousands ? parts.join("") : `${parts.slice(0, -1).join("")}.${parts.at(-1)}`;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function numberValue(selector) {
  return parseMoneyInput($(selector).value);
}

function setMoneyInput(selector, value) {
  $(selector).value = moneyValue(parseMoneyInput(value));
}

function sumSaleLines(lines, field) {
  return (lines || []).reduce((sum, line) => sum + Number(line[field] || 0), 0);
}

function commercialRound(value) {
  const number = Number(value || 0);
  return number >= 0 ? Math.floor(number + 0.5) : -Math.floor(Math.abs(number) + 0.5);
}

function tabDelta(code, average) {
  const key = normalizeSearch(code).toUpperCase();
  const rule = state.tabRules.find((item) => normalizeSearch(item.codigo).toUpperCase() === key);
  const prom = commercialRound(average);
  if (!rule || prom <= 0 || prom < Number(rule.promMin || 0)) return 0;
  const applicable = Number(rule.promMax || 0) > 0 ? Math.min(prom, Number(rule.promMax)) : prom;
  const baseUnits = (applicable - Number(rule.promMin || 0)) / Number(rule.pasoKg || 1);
  if (baseUnits <= 0) return 0;
  const mode = String(rule.modoCalculo || "").toUpperCase();
  const units = mode === "DECIMAL" ? baseUnits : mode === "ENTERO_ARRIBA" ? Math.ceil(baseUnits) : Math.floor(baseUnits);
  return Math.round(Number(rule.ajustePorPaso || 0) * units);
}

function optionalInputNumber(selector, fallback) {
  const value = optionalElementValue(selector);
  return String(value || "").trim() ? parseMoneyInput(value) : fallback;
}

function calculateSalePreview() {
  syncFaenaSaleInputs();
  const heads = Number($("#sale-heads").value || 0);
  const grossKg = Number($("#sale-kg-bruto").value || 0);
  const vendWaste = Number($("#sale-desbaste-vend").value || 0);
  const netVend = optionalInputNumber("#sale-kg-neto-vend", commercialRound(grossKg * (1 - vendWaste / 100)));
  const usedKgVend = optionalInputNumber("#sale-kg-calc-vend", $("#sale-use-real-kg-vend").checked ? grossKg * (1 - vendWaste / 100) : netVend);
  const averageVend = optionalInputNumber("#sale-prom-used-vend", heads ? usedKgVend / heads : 0);
  const vendBasePrice = parseMoneyInput($("#sale-precio-vend").value);
  const vendFinalPrice = optionalInputNumber("#sale-final-price-manual-vend", Math.max(vendBasePrice + ($("#sale-tipo-precio-vend").value === "CAB" ? 0 : tabDelta($("#sale-tab-vend").value, averageVend)), 0));
  const vendAmount = optionalInputNumber("#sale-amount-manual-vend", $("#sale-tipo-precio-vend").value === "CAB" ? heads * vendFinalPrice : usedKgVend * vendFinalPrice);
  const buyerDifferent = $("#sale-buyer-different").checked;
  const compWaste = buyerDifferent ? Number($("#sale-desbaste-comp").value || 0) : vendWaste;
  const compKg = buyerDifferent ? optionalInputNumber("#sale-kg-comp", commercialRound(grossKg * (1 - compWaste / 100))) : netVend;
  const usedKgComp = buyerDifferent ? optionalInputNumber("#sale-kg-calc-comp", $("#sale-use-real-kg-comp").checked ? grossKg * (1 - compWaste / 100) : compKg) : usedKgVend;
  const averageComp = buyerDifferent ? optionalInputNumber("#sale-prom-used-comp", heads ? usedKgComp / heads : 0) : averageVend;
  const compType = buyerDifferent ? $("#sale-tipo-precio-comp").value : $("#sale-tipo-precio-vend").value;
  const compBasePrice = buyerDifferent ? parseMoneyInput($("#sale-precio-comp").value) : vendBasePrice;
  const compFinalPrice = buyerDifferent ? optionalInputNumber("#sale-final-price-manual-comp", Math.max(compBasePrice + (compType === "CAB" ? 0 : tabDelta($("#sale-tab-comp").value, averageComp)), 0)) : vendFinalPrice;
  const compAmount = buyerDifferent ? optionalInputNumber("#sale-amount-manual-comp", compType === "CAB" ? heads * compFinalPrice : usedKgComp * compFinalPrice) : vendAmount;
  return { averageVend, averageComp, vendFinalPrice, compFinalPrice, vendAmount, compAmount };
}

function renderSalePreview() {
  syncSaleMode();
  const calc = calculateSalePreview();
  $("#sale-prom-vend").value = `${calc.averageVend.toFixed(2).replace(".", ",")} kgs/cab`;
  $("#sale-prom-comp").value = `${calc.averageComp.toFixed(2).replace(".", ",")} kgs/cab`;
  $("#sale-precio-final-vend").value = moneyValue(calc.vendFinalPrice);
  $("#sale-precio-final-comp").value = moneyValue(calc.compFinalPrice);
  $("#sale-importe-vend").value = moneyValue(calc.vendAmount);
  $("#sale-importe-comp").value = moneyValue(calc.compAmount);
}

function isFaenaSaleOperation() {
  const operation = state.currentOperation || {};
  const draft = operation.draftData || {};
  const formDestination = $("#operation-destination") ? $("#operation-destination").value : "";
  return normalizeSearch(formDestination || operation.destino || draft.destino).includes("faena");
}

function syncFaenaSaleInputs() {
  if (!isFaenaSaleOperation()) return;
  $("#sale-desbaste-vend").value = "0";
  $("#sale-desbaste-comp").value = "0";
  $("#sale-kg-neto-vend").value = "";
  $("#sale-kg-comp").value = "";
  $("#sale-tipo-precio-vend").value = "KG";
  $("#sale-tipo-precio-comp").value = "KG";
  $("#sale-tab-vend").value = "";
  $("#sale-tab-comp").value = "";
  $("#sale-buyer-different").checked = false;
  $("#sale-use-real-kg-vend").checked = false;
  $("#sale-use-real-kg-comp").checked = false;
  $("#sale-kg-calc-vend").value = "";
  $("#sale-kg-calc-comp").value = "";
  $("#sale-prom-used-vend").value = "";
  $("#sale-prom-used-comp").value = "";
}

function syncSaleMode() {
  const faena = isFaenaSaleOperation();
  $all(".sale-not-faena").forEach((element) => { element.hidden = faena; });
  $("#sale-tipo-precio-vend").disabled = faena;
  $("#sale-tipo-precio-comp").disabled = faena;
  $("#sale-buyer-different").disabled = faena;
  if (faena) {
    syncFaenaSaleInputs();
    $("#sale-buyer-diff").hidden = true;
    $("#sale-buyer-correction").hidden = true;
  }
}

function formatMoneyInput(input) {
  input.value = moneyValue(parseMoneyInput(input.value));
}

function unformatMoneyInput(input) {
  const value = parseMoneyInput(input.value);
  input.value = value ? String(value).replace(".", ",") : "";
}

function dateToInput(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return text;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function findClientByName(name) {
  const key = normalizeSearch(name);
  return state.clientes.find((client) => normalizeSearch(client.nombre) === key);
}

function optionalElementValue(selector, fallback = "") {
  const element = $(selector);
  return element ? element.value : fallback;
}

function percentValue(selector) {
  return parseMoneyInput(optionalElementValue(selector).replace("%", ""));
}

function draftValue(key, fallback = "") {
  const draft = state.currentOperation && state.currentOperation.draftData ? state.currentOperation.draftData : {};
  return draft[key] !== undefined && draft[key] !== null ? draft[key] : fallback;
}

function parseDisplayDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function formatDisplayDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function addDisplayDays(value, days) {
  const date = parseDisplayDate(value);
  if (!date) return value || "-";
  date.setDate(date.getDate() + Number(days || 0));
  return formatDisplayDate(date);
}

function parseDuePlan(plan, base) {
  const amount = Math.abs(Number(base || 0));
  if (!amount) return [];
  const parts = String(plan || "0").split("-").map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return [{ days: 0, pct: 100, amount }];
  if (!parts.some((part) => part.includes("@"))) {
    return parts.map((days) => ({ days: parseMoneyInput(days), pct: 100 / parts.length, amount: amount / parts.length }));
  }
  const parsed = parts.map((part) => {
    const [rawValue, rawDays] = part.split("@");
    return { rawValue, days: parseMoneyInput(rawDays), value: parseMoneyInput(rawValue) };
  });
  const manual = parsed.some((item) => String(item.rawValue).includes("$")) || parsed.reduce((sum, item) => sum + item.value, 0) > 100.001;
  return parsed.map((item) => ({
    days: item.days,
    pct: manual ? item.value / amount * 100 : item.value,
    amount: manual ? item.value : amount * item.value / 100,
    manual
  }));
}

function renderDueGrid(calc) {
  const draft = state.currentOperation && state.currentOperation.draftData ? state.currentOperation.draftData : {};
  const date = draft.fechaCarga || (state.currentOperation ? state.currentOperation.fecha : "");
  const groups = [
    { title: "Facturado vendedor", plan: $("#liq-plan-fact-prod").value, base: calc.netoLiquidacionProd },
    { title: "Facturado comprador", plan: $("#liq-plan-fact-comp").value, base: calc.netoLiquidacionComp },
    { title: "Efectivo vendedor", plan: $("#liq-plan-cash-prod").value, base: calc.cashWithIvaProd - calc.cashExpenseProd },
    { title: "Efectivo comprador", plan: $("#liq-plan-cash-comp").value, base: calc.efectivoComp }
  ];
  $("#liq-operation-date").value = date || "";
  $("#liq-due-grid").innerHTML = groups.map((group) => {
    const items = parseDuePlan(group.plan, group.base);
    return `
      <div>
        <span>${escapeHtml(group.title)}</span>
        ${items.length ? items.map((item) => `<strong>${escapeHtml(addDisplayDays(date, item.days))} - ${item.manual ? "manual" : `${String(Number(item.pct.toFixed(2))).replace(".", ",")}%`} - ${moneyValue(item.amount)}</strong>`).join("") : "<strong>Sin importe</strong>"}
      </div>
    `;
  }).join("");
}

function isDirectOperation(operation = state.currentOperation) {
  return !isConsignedOperation(operation);
}

function isConsignedOperation(operation = state.currentOperation) {
  const type = String((operation && operation.tipo) || "").toUpperCase();
  const draft = operation && operation.draftData ? operation.draftData : {};
  return type === "CONSIGNADA" || (type.includes("ANTICIPADA") && Boolean((operation && operation.consignataria) || draft.consignataria));
}

function syncLiquidationPanels() {
  const direct = isDirectOperation();
  const consigned = isConsignedOperation();
  const frigo = isFrigorificoIvaOperation();
  $all(".direct-only").forEach((element) => { element.hidden = !direct; });
  $all(".consigned-only").forEach((element) => { element.hidden = !consigned; });
  $all(".frigo-only").forEach((element) => { element.hidden = !frigo; });
  $("#liq-buyer-expenses").hidden = !buyerExpensesApply();
  syncLiquidationReceipts();
}

function syncLiquidationReceipts(changedParty = "") {
  const direct = isDirectOperation();
  const settledParty = $("#liq-consignee-settled-party").value;
  const differentDirectReceipt = $("#liq-different-buyer-receipt").checked;
  const syncFromSeller = (direct && !differentDirectReceipt) || (isConsignedOperation() && settledParty === "VENDEDOR");
  const syncFromBuyer = isConsignedOperation() && settledParty === "COMPRADOR";
  $("#liq-comprobante-prod").disabled = syncFromBuyer;
  $("#liq-comprobante-comp").disabled = syncFromSeller;
  if (syncFromBuyer) $("#liq-comprobante-prod").value = $("#liq-comprobante-comp").value;
  if (syncFromSeller) $("#liq-comprobante-comp").value = $("#liq-comprobante-prod").value;
  if (changedParty === "prod" && syncFromSeller) $("#liq-comprobante-comp").value = $("#liq-comprobante-prod").value;
  if (changedParty === "comp" && syncFromBuyer) $("#liq-comprobante-prod").value = $("#liq-comprobante-comp").value;
}

function getSellerExpenses() {
  return {
    comision: numberValue("#liq-exp-comision-prod"),
    fondoGarantia: numberValue("#liq-exp-fondo-gtia-prod"),
    controlEntrega: numberValue("#liq-exp-control-prod"),
    fondoCompGastos: numberValue("#liq-exp-fondo-comp-prod"),
    retIibb: numberValue("#liq-exp-iibb-prod"),
    retGanancias: numberValue("#liq-exp-ganancias-prod"),
    otrosGastos: numberValue("#liq-exp-otros-prod"),
    ivaGastos: numberValue("#liq-exp-iva-gastos-prod")
  };
}

function buyerExpensesApply() {
  const consigned = isConsignedOperation();
  const settledParty = $("#liq-consignee-settled-party").value;
  return consigned && (settledParty === "COMPRADOR" || settledParty === "AMBAS");
}

function getBuyerExpenses() {
  if (!buyerExpensesApply()) {
    return { procesamiento: 0, otros1: 0, otros2: 0, total: 0 };
  }
  const expenses = {
    procesamiento: numberValue("#liq-exp-procesamiento-comp"),
    otros1: numberValue("#liq-exp-otros-1-comp"),
    otros2: numberValue("#liq-exp-otros-2-comp")
  };
  expenses.total = expenses.procesamiento + expenses.otros1 + expenses.otros2;
  return expenses;
}

function calculateLiquidationPreview() {
  const facturado = numberValue("#liq-facturado");
  const ivaProd = numberValue("#liq-iva-prod");
  const ivaComp = numberValue("#liq-iva-comp");
  const efectivoProd = numberValue("#liq-efectivo-prod");
  const efectivoComp = numberValue("#liq-efectivo-comp");
  const cashExpenseProd = numberValue("#liq-cash-exp-prod");
  const expenses = getSellerExpenses();
  const buyerExpenses = getBuyerExpenses();
  const consigned = isConsignedOperation();
  const frigo = isFrigorificoIvaOperation();
  const comFactProd = facturado * percentValue("#liq-comision-fact-prod-pct") / 100;
  const comFactComp = facturado * percentValue("#liq-comision-fact-comp-pct") / 100;
  const consigneeCommission = facturado * percentValue("#liq-consignee-commission-pct") / 100;
  const consigneeAdjustment = numberValue("#liq-consignee-adjustment");
  const cashWithIvaProd = efectivoProd + (frigo ? efectivoProd * 0.105 : 0);
  const comEfProd = cashWithIvaProd * percentValue("#liq-comision-efect-prod-pct") / 100;
  const comEfComp = efectivoComp * percentValue("#liq-comision-efect-comp-pct") / 100;
  const expenseBase = expenses.comision + expenses.fondoGarantia + expenses.controlEntrega + expenses.fondoCompGastos + expenses.otrosGastos;
  const netoGravadoProd = consigned ? Math.max(facturado - expenseBase, 0) : facturado;
  const netoLiquidacionProd = consigned
    ? netoGravadoProd + ivaProd - expenses.retIibb - expenses.retGanancias - expenses.ivaGastos
    : facturado + ivaProd;
  const netoLiquidacionComp = facturado + ivaComp + buyerExpenses.total;
  return {
    facturado,
    ivaProd,
    ivaComp,
    efectivoProd,
    efectivoComp,
    cashWithIvaProd,
    cashExpenseProd,
    comFactProd,
    comFactComp,
    consigneeCommission,
    consigneeAdjustment,
    consigneeTotal: consigneeCommission + consigneeAdjustment,
    comEfProd,
    comEfComp,
    netoGravadoProd,
    buyerExpenses,
    netoLiquidacionProd,
    netoLiquidacionComp,
    netoTotalProd: netoLiquidacionProd + cashWithIvaProd - cashExpenseProd - comEfProd,
    netoTotalComp: netoLiquidacionComp + efectivoComp
  };
}

function syncLiquidationCashFromFacturado() {
  const facturado = numberValue("#liq-facturado");
  const brutoVend = numberValue("#liq-bruto-vend");
  const brutoComp = numberValue("#liq-bruto-comp");
  const brutoBaseProd = isFrigorificoIvaOperation() ? getFrigorificoCalc().brutoSinIva : brutoVend;
  setMoneyInput("#liq-efectivo-prod", Math.max(brutoBaseProd - facturado, 0));
  setMoneyInput("#liq-efectivo-comp", Math.max(brutoComp - facturado, 0));
}

function renderLiquidationTotals() {
  const calc = calculateLiquidationPreview();
  setMoneyInput("#liq-comision-fact-prod", calc.comFactProd);
  setMoneyInput("#liq-comision-fact-comp", calc.comFactComp);
  setMoneyInput("#liq-comision-efect-prod", calc.comEfProd);
  setMoneyInput("#liq-comision-efect-comp", calc.comEfComp);
  $("#liq-cash-iva-prod").value = moneyValue(calc.cashWithIvaProd - calc.efectivoProd);
  $("#liq-cash-with-iva-prod").value = moneyValue(calc.cashWithIvaProd);
  $("#liq-consignee-commission").value = moneyValue(calc.consigneeCommission);
  $("#liq-consignee-total").value = moneyValue(calc.consigneeTotal);
  $("#liq-neto-liq-prod").textContent = moneyValue(calc.netoLiquidacionProd);
  $("#liq-neto-total-prod").textContent = moneyValue(calc.netoTotalProd);
  $("#liq-neto-liq-comp").textContent = moneyValue(calc.netoLiquidacionComp);
  $("#liq-neto-total-comp").textContent = moneyValue(calc.netoTotalComp);
  renderDueGrid(calc);
  syncLiquidationPanels();
  renderSpecialOperationPanels();
  renderReport();
}

function fillLiquidationForm(liquidacion) {
  const draft = state.currentOperation && state.currentOperation.draftData ? state.currentOperation.draftData : {};
  $("#liq-bruto-vend").value = moneyValue(liquidacion.brutoVend);
  $("#liq-bruto-comp").value = moneyValue(liquidacion.brutoComp);
  setMoneyInput("#liq-facturado", liquidacion.importeFacturado);
  $("#liq-comprobante-prod").value = liquidacion.comprobanteProd || "";
  $("#liq-comprobante-comp").value = liquidacion.comprobanteComp || "";
  setMoneyInput("#liq-iva-prod", liquidacion.ivaProd);
  setMoneyInput("#liq-iva-comp", liquidacion.ivaComp);
  setMoneyInput("#liq-efectivo-prod", liquidacion.efectivoProd);
  setMoneyInput("#liq-efectivo-comp", liquidacion.efectivoComp);
  setMoneyInput("#liq-comision-fact-prod", liquidacion.comisionFacturadoProd);
  setMoneyInput("#liq-comision-fact-comp", liquidacion.comisionFacturadoComp);
  setMoneyInput("#liq-comision-efect-prod", liquidacion.comisionEfectivoProd);
  setMoneyInput("#liq-comision-efect-comp", liquidacion.comisionEfectivoComp);
  $("#liq-consignee-settled-party").value = liquidacion.liquidacionConsignatariaA || draft.liquidacionConsignatariaA || "VENDEDOR";
  $("#liq-cash-mode").value = liquidacion.efectivoModo || draft.efectivoModo || "MONTO";
  $("#liq-cash-percent").value = liquidacion.efectivoPorc || draft.efectivoPorc || "";
  $("#liq-plan-fact-prod").value = liquidacion.planFacturadoProd || draft.planFacturadoProd || "30";
  $("#liq-plan-fact-comp").value = liquidacion.planFacturadoComp || draft.planFacturadoComp || "30";
  $("#liq-plan-cash-prod").value = liquidacion.planEfectivoProd || draft.planEfectivoProd || "0";
  $("#liq-plan-cash-comp").value = liquidacion.planEfectivoComp || draft.planEfectivoComp || "0";
  $("#liq-direct-no-iva").checked = Boolean(liquidacion.ivaDirectaSinIva || draft.ivaDirectaSinIva);
  $("#liq-comision-fact-prod-pct").value = liquidacion.comisionFacturadoProdPct ?? draft.comisionProd ?? 0;
  $("#liq-comision-fact-comp-pct").value = liquidacion.comisionFacturadoCompPct ?? draft.comisionComp ?? 0;
  $("#liq-comision-efect-prod-pct").value = liquidacion.comisionEfectivoProdPct ?? draft.comisionEfectivoProd ?? 0;
  $("#liq-comision-efect-comp-pct").value = liquidacion.comisionEfectivoCompPct ?? draft.comisionEfectivoComp ?? 0;
  setMoneyInput("#liq-exp-comision-prod", liquidacion.comisionDetalleProd ?? draft.comisionDetalleProd);
  setMoneyInput("#liq-exp-fondo-gtia-prod", liquidacion.fondoGarantiaProd ?? draft.fondoGarantiaProd);
  setMoneyInput("#liq-exp-control-prod", liquidacion.controlEntregaProd ?? draft.controlEntregaProd);
  setMoneyInput("#liq-exp-fondo-comp-prod", liquidacion.fondoCompGastosProd ?? draft.fondoCompGastosProd);
  setMoneyInput("#liq-exp-iibb-prod", liquidacion.retIibbProd ?? draft.retIibbProd);
  setMoneyInput("#liq-exp-ganancias-prod", liquidacion.retGananciasProd ?? draft.retGananciasProd);
  setMoneyInput("#liq-exp-otros-prod", liquidacion.otrosGastosProd ?? draft.otrosGastosProd);
  setMoneyInput("#liq-exp-iva-gastos-prod", liquidacion.ivaGastosProd ?? draft.ivaGastosProd);
  $("#liq-exp-observ-prod").value = liquidacion.observGastosProd || draft.observGastosProd || "";
  setMoneyInput("#liq-exp-procesamiento-comp", liquidacion.gastoProcesamientoComp ?? draft.gastoProcesamientoComp ?? liquidacion.gastoGuiasDteComp ?? draft.gastoGuiasDteComp);
  setMoneyInput("#liq-exp-otros-1-comp", liquidacion.otrosGastosComp1 ?? draft.otrosGastosComp1 ?? liquidacion.gastoFleteComp ?? draft.gastoFleteComp);
  setMoneyInput("#liq-exp-otros-2-comp", liquidacion.otrosGastosComp2 ?? draft.otrosGastosComp2 ?? liquidacion.gastoPesadaComp ?? draft.gastoPesadaComp);
  $("#liq-exp-observ-comp").value = liquidacion.observGastosComp || draft.observGastosComp || "";
  $("#liq-cash-exp-concept-prod").value = liquidacion.conceptoGastoEfectivoProd || draft.conceptoGastoEfectivoProd || "";
  setMoneyInput("#liq-cash-exp-prod", liquidacion.gastoEfectivoProd ?? draft.gastoEfectivoProd);
  $("#liq-consignee-commission-pct").value = liquidacion.porcComisionConsignataria ?? draft.porcComisionConsignataria ?? 0;
  $("#liq-consignee-adjustment-concept").value = liquidacion.conceptoAjusteConsignataria || draft.conceptoAjusteConsignataria || "";
  setMoneyInput("#liq-consignee-adjustment", liquidacion.ajusteConsignataria ?? draft.ajusteConsignataria);
  $("#liq-direct-notes").value = liquidacion.detalleLiquidacionDirectaProd || draft.detalleLiquidacionDirectaProd || "";
  $("#liq-different-buyer-receipt").checked = Boolean(liquidacion.comprobanteCompDiferente || draft.comprobanteCompDiferente);
  setMoneyInput("#frigo-neto-final", liquidacion.netoFinalFrigorificoComp || draft.netoFinalFrigorificoComp || liquidacion.brutoVend);
  $("#liq-observaciones").value = liquidacion.observaciones || "";
  renderLiquidationDetail(liquidacion.detalleLiquidar || []);
  renderLiquidationTotals();
  renderReport();
}

function isFrigorificoIvaOperation(operation = state.currentOperation) {
  const draft = operation && operation.draftData ? operation.draftData : {};
  const liquidation = operation && operation.liquidacion ? operation.liquidacion : {};
  return String(draft.calculoFrigorificoComp || liquidation.calculoFrigorificoComp || "").toUpperCase() === "SI";
}

function isAnticipatedOperation(operation = state.currentOperation) {
  const type = String((operation && operation.tipo) || "").toUpperCase();
  const draft = operation && operation.draftData ? operation.draftData : {};
  const liquidation = operation && operation.liquidacion ? operation.liquidacion : {};
  return Boolean((operation && operation.ventaAnticipada) || draft.ventaAnticipada)
    || type.includes("ANTICIPADA")
    || String(liquidation.tipoLiquidacion || "").toUpperCase().includes("ANTICIPADA");
}

function operationTypeLabel(operation) {
  const type = String((operation && operation.tipo) || "DIRECTA").toUpperCase();
  const intervention = type.includes("ANTICIPADA")
    ? ((operation && operation.consignataria) || (operation && operation.draftData && operation.draftData.consignataria) ? "CONSIGNADA" : "DIRECTA")
    : type;
  return `${intervention}${isAnticipatedOperation(operation) ? " - ANTICIPADA" : ""}`;
}

function getFrigorificoCalc(operation = state.currentOperation) {
  const draft = operation && operation.draftData ? operation.draftData : {};
  const liquidation = operation && operation.liquidacion ? operation.liquidacion : {};
  const brutoVend = Number(liquidation.brutoVend || sumSaleLines(operation && operation.saleLines, "importeVend"));
  const facturado = numberValue("#liq-facturado") || Number(liquidation.importeFacturado || 0);
  const netoFinal = optionalInputNumber("#frigo-neto-final", parseMoneyInput(draft.netoFinalFrigorificoComp || liquidation.netoFinalFrigorifico || brutoVend));
  const brutoSinIva = netoFinal > 0 ? netoFinal / 1.105 : 0;
  const efectivoSinIva = Math.max(brutoSinIva - facturado, 0);
  const ivaLiquidacion = facturado * 0.105;
  const ivaEfectivo = efectivoSinIva * 0.105;
  const efectivoConIva = efectivoSinIva + ivaEfectivo;

  return {
    netoFinal,
    brutoSinIva,
    facturado,
    ivaLiquidacion,
    efectivoSinIva,
    ivaEfectivo,
    efectivoConIva,
    totalControl: netoFinal
  };
}

function renderSpecialOperationPanels() {
  const operation = state.currentOperation;
  const frigoBox = $("#frigo-special-box");
  const anticipatedBox = $("#anticipada-special-box");
  if (!operation) {
    frigoBox.hidden = true;
    anticipatedBox.hidden = true;
    return;
  }

  const isFrigo = isFrigorificoIvaOperation(operation);
  frigoBox.hidden = !isFrigo;
  if (isFrigo) {
    const calc = getFrigorificoCalc(operation);
    if (document.activeElement !== $("#frigo-neto-final")) setMoneyInput("#frigo-neto-final", calc.netoFinal);
    $("#frigo-bruto-sin-iva").textContent = moneyValue(calc.brutoSinIva);
    $("#frigo-bruto-liquidado").textContent = moneyValue(calc.facturado);
    $("#frigo-iva-liquidacion").textContent = moneyValue(calc.ivaLiquidacion);
    $("#frigo-efectivo-sin-iva").textContent = moneyValue(calc.efectivoSinIva);
    $("#frigo-iva-efectivo").textContent = moneyValue(calc.ivaEfectivo);
    $("#frigo-efectivo-con-iva").textContent = moneyValue(calc.efectivoConIva);
    $("#frigo-total-control").textContent = moneyValue(calc.totalControl);
  }

  anticipatedBox.hidden = !isAnticipatedOperation(operation);
}

function buildDetailFromSaleLines() {
  const operation = state.currentOperation || {};
  const lines = operation.saleLines || [];
  const facturado = numberValue("#liq-facturado");
  const total = lines.reduce((sum, line) => sum + Number(line.importeVend || 0), 0);
  return lines.map((line) => {
    const cantidad = Number(line.cabezas || 0);
    const factor = total > 0 ? Number(line.importeVend || 0) / total : 0;
    const importeNeto = facturado > 0 ? facturado * factor : Number(line.importeVend || 0);
    const precioCabeza = cantidad > 0 ? importeNeto / cantidad : 0;
    return {
      cantidad,
      categoria: line.categoria,
      precioCabeza,
      importeNeto,
      iva: $("#liq-direct-no-iva").checked ? 0 : importeNeto * 0.105,
      importeBruto: $("#liq-direct-no-iva").checked ? importeNeto : importeNeto * 1.105
    };
  });
}

function renderLiquidationDetail(detail) {
  const rows = detail.length ? detail : buildDetailFromSaleLines();
  $("#liq-detail-body").innerHTML = rows.length
    ? rows.map((item) => `
        <tr>
          <td><input class="liq-detail-input" data-detail-field="cantidad" type="number" step="1" value="${Number(item.cantidad || 0)}"></td>
          <td><input class="liq-detail-input" data-detail-field="categoria" value="${escapeHtml(item.categoria || "")}"></td>
          <td><input class="liq-detail-input money-input" data-detail-field="precioCabeza" inputmode="decimal" value="${escapeHtml(moneyValue(item.precioCabeza || 0))}"></td>
          <td><input class="liq-detail-input money-input" data-detail-field="importeNeto" inputmode="decimal" value="${escapeHtml(moneyValue(item.importeNeto || 0))}"></td>
          <td><input class="liq-detail-input money-input" data-detail-field="iva" inputmode="decimal" value="${escapeHtml(moneyValue(item.iva || 0))}"></td>
          <td data-detail-total>${moneyValue(item.importeBruto || Number(item.importeNeto || 0) + Number(item.iva || 0))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="6">Sin detalle para liquidar.</td></tr>`;
}

function recalculateLiquidationDetailRow(input) {
  const row = input.closest("tr");
  if (!row) return;
  const getInput = (field) => row.querySelector(`[data-detail-field="${field}"]`);
  const cantidadInput = getInput("cantidad");
  const precioInput = getInput("precioCabeza");
  const netoInput = getInput("importeNeto");
  const ivaInput = getInput("iva");
  const cantidad = Number(cantidadInput.value || 0);
  let precioCabeza = parseMoneyInput(precioInput.value);
  let importeNeto = parseMoneyInput(netoInput.value);
  let iva = parseMoneyInput(ivaInput.value);
  const field = input.dataset.detailField;

  if (field === "cantidad" || field === "precioCabeza") {
    importeNeto = cantidad * precioCabeza;
    iva = $("#liq-direct-no-iva").checked ? 0 : importeNeto * 0.105;
  } else if (field === "importeNeto") {
    precioCabeza = cantidad ? importeNeto / cantidad : 0;
    iva = $("#liq-direct-no-iva").checked ? 0 : importeNeto * 0.105;
  }

  setMoneyInputValue(precioInput, precioCabeza);
  setMoneyInputValue(netoInput, importeNeto);
  setMoneyInputValue(ivaInput, iva);
  row.querySelector("[data-detail-total]").textContent = moneyValue(importeNeto + iva);
  renderReport();
}

function setMoneyInputValue(input, value) {
  input.value = moneyValue(parseMoneyInput(value));
}

function collectLiquidationDetail() {
  return Array.from($("#liq-detail-body").querySelectorAll("tr")).map((row) => {
    const get = (field) => {
      const input = row.querySelector(`[data-detail-field="${field}"]`);
      return input ? input.value : "";
    };
    const importeNeto = parseMoneyInput(get("importeNeto"));
    const iva = parseMoneyInput(get("iva"));
    return {
      cantidad: Number(get("cantidad") || 0),
      categoria: get("categoria"),
      precioCabeza: parseMoneyInput(get("precioCabeza")),
      importeNeto,
      iva,
      importeBruto: importeNeto + iva
    };
  }).filter((item) => item.categoria || item.cantidad || item.importeNeto);
}

function setOperationModeNew() {
  $("#operation-form-title").textContent = "Cargar nueva operacion";
  $("#operation-form-subtitle").textContent = "Use este formulario para iniciar una operacion nueva.";
  $("#operation-new").hidden = true;
}

function showOperationWorkspace() {
  $("#operation-layout").classList.remove("history-mode");
  $("#operation-layout").classList.add("workspace-mode");
  $("#operation-history-wrap").hidden = true;
}

function showOperationHistory() {
  closeSuggestions();
  $("#operation-layout").classList.remove("workspace-mode");
  $("#operation-layout").classList.add("history-mode");
  $("#operation-history-wrap").hidden = false;
}

function setOperationModeExisting(operation) {
  $("#operation-form-title").textContent = `Operacion ${operation.id}`;
  $("#operation-form-subtitle").textContent = "Operacion cargada o pendiente. Puede revisar datos y continuar venta, liquidacion o reporte.";
  $("#operation-new").hidden = false;
}

function setOperationStep(step) {
  const selected = Boolean(state.selectedOperationId);
  const nextStep = selected ? step : "operation";
  state.operationStep = nextStep;
  $("#operation-workflow-empty").hidden = selected;
  $("#operation-workflow-steps").hidden = !selected;
  $("#sale-panel").hidden = !selected || nextStep !== "sale";
  $("#liquidation-panel").hidden = !selected || nextStep !== "liquidation";
  $("#report-panel").hidden = !selected || nextStep !== "report";
  $all("[data-operation-step]").forEach((button) => {
    button.classList.toggle("active", button.dataset.operationStep === nextStep);
  });
  if (selected && nextStep === "report") renderReport();
}

async function openSale(operationId, step = "sale") {
  showOperationWorkspace();
  const response = await fetchJson(`/api/operaciones/${encodeURIComponent(operationId)}`);
  const operation = response.item;
  state.currentOperation = operation;
  state.selectedOperationId = operationId;
  await fillOperationForm(operation);
  setOperationModeExisting(operation);
  $("#sale-operation-label").textContent = `${operation.id} - ${operation.vendedor || ""} / ${operation.comprador || operation.consignataria || ""}`;
  renderSaleLines(operation.saleLines || []);
  fillLiquidationForm(operation.liquidacion || {});
  renderReport();
  setOperationStep(step);
  syncSaleMode();
  renderSalePreview();
  setSaleMessage("");
  setLiquidationMessage("");
}

async function fillOperationForm(operation) {
  $("#operation-id").value = operation.id || "";
  $("#operation-date").value = dateToInput(operation.fecha);
  $("#operation-load-date").value = dateToInput((operation.draftData && operation.draftData.fechaCarga) || operation.fecha);
  const storedType = String(operation.tipo || "DIRECTA").toUpperCase();
  $("#operation-type").value = storedType.includes("ANTICIPADA")
    ? (operation.consignataria ? "CONSIGNADA" : "DIRECTA")
    : storedType;
  $("#operation-anticipated").checked = isAnticipatedOperation(operation);
  $("#operation-destination").value = operation.destino || "INVERNADA";
  $("#operation-frigo-mode").value = operation.draftData && operation.draftData.calculoFrigorificoComp === "SI" ? "SI" : "NO";
  $("#operation-dte").value = operation.dte || "";
  $("#operation-conditions").value = operation.condiciones || (operation.draftData && operation.draftData.condicionesOperacion) || "";

  const vendedor = findClientByName(operation.vendedor);
  const comprador = findClientByName(operation.comprador);
  const consignataria = findClientByName(operation.consignataria);

  $("#operation-seller-name").value = operation.vendedor || "";
  $("#operation-seller-id").value = vendedor ? vendedor.id : "";
  $("#operation-buyer-name").value = operation.comprador || "";
  $("#operation-buyer-id").value = comprador ? comprador.id : "";
  $("#operation-consignee-name").value = operation.consignataria || "";
  $("#operation-consignee-id").value = consignataria ? consignataria.id : "";

  if (vendedor) {
    const est = await fetchJson(`/api/clientes/${encodeURIComponent(vendedor.id)}/establecimientos`);
    setSelectOptions("#operation-renspa-origin-select", est.items || [], "Elegir RENSPA origen");
  }
  if (comprador) {
    const est = await fetchJson(`/api/clientes/${encodeURIComponent(comprador.id)}/establecimientos`);
    setSelectOptions("#operation-renspa-destination-select", est.items || [], "Elegir RENSPA destino");
  }
  $("#operation-renspa-origin-select").value = operation.renspaOrigen || "";
  $("#operation-renspa-destination-select").value = operation.renspaDestino || "";
  $("#operation-renspa-origin-manual").value = operation.renspaOrigen && $("#operation-renspa-origin-select").value !== operation.renspaOrigen ? operation.renspaOrigen : "";
  $("#operation-renspa-destination-manual").value = operation.renspaDestino && $("#operation-renspa-destination-select").value !== operation.renspaDestino ? operation.renspaDestino : "";
  $("#operation-save-renspa-origin").checked = false;
  $("#operation-save-renspa-destination").checked = false;
  syncOperationType();
  setOperationMessage(`Operacion ${operation.id} abierta.`);
}

function resetOperationForm() {
  showOperationWorkspace();
  closeSuggestions();
  $("#operation-form").reset();
  $("#sale-form").reset();
  $("#liquidation-form").reset();
  $("#operation-id").value = "";
  state.selectedOperationId = "";
  state.currentOperation = null;
  $("#sale-panel").hidden = true;
  $("#liquidation-panel").hidden = true;
  $("#report-panel").hidden = true;
  $("#sale-operation-label").textContent = "";
  $("#sale-category-suggestions").hidden = true;
  $("#sale-category-suggestions").innerHTML = "";
  $("#report-sheet").innerHTML = "";
  $("#sale-desbaste-vend").value = "0";
  $("#sale-desbaste-comp").value = "0";
  syncSaleMode();
  setSelectOptions("#operation-renspa-origin-select", [], "Elegir RENSPA origen");
  setSelectOptions("#operation-renspa-destination-select", [], "Elegir RENSPA destino");
  renderSaleLines([]);
  renderLiquidationDetail([]);
  renderLiquidationTotals();
  $("#operation-date").value = new Date().toISOString().slice(0, 10);
  $("#operation-load-date").value = $("#operation-date").value;
  syncOperationType();
  syncBuyerDiff();
  setOperationModeNew();
  setOperationStep("operation");
  setOperationMessage("");
  setSaleMessage("");
  setLiquidationMessage("");
}

function renderPartySuggestions(inputId, suggestionsId, hiddenId) {
  const node = $(suggestionsId);
  const query = normalizeSearch($(inputId).value);
  if (query.length < 3) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  const words = query.split(" ").filter(Boolean);
  const matches = state.clientes
    .filter((client) => {
      const haystack = normalizeSearch(`${client.nombre} ${client.cuit}`);
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, 6);

  node.hidden = false;
  node.innerHTML = matches.length
    ? matches.map((client) => `
        <div class="suggestion-row">
          <div>
            <strong>${escapeHtml(client.nombre)}</strong>
            <span>${escapeHtml(client.cuit || "Sin CUIT")} - ${escapeHtml(client.tipo || "Cliente")}</span>
          </div>
          <button type="button" class="small-button" data-pick-client="${escapeHtml(client.id)}" data-input="${escapeHtml(inputId)}" data-hidden="${escapeHtml(hiddenId)}">Elegir</button>
        </div>
      `).join("")
    : `<div class="suggestion-empty">No aparece un cliente existente con ese nombre.</div>`;
}

function setSelectOptions(selectId, items, placeholder) {
  const select = $(selectId);
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + items
    .map((item) => `<option value="${escapeHtml(item.renspa)}">${escapeHtml(item.renspa)} - ${escapeHtml(item.nombre || "Establecimiento")}</option>`)
    .join("");
}

async function pickOperationClient(clientId, inputSelector, hiddenSelector) {
  const client = state.clientes.find((item) => String(item.id) === String(clientId));
  if (!client) return;
  $(inputSelector).value = client.nombre;
  $(hiddenSelector).value = client.id;
  closeSuggestions();

  const establishments = await fetchJson(`/api/clientes/${encodeURIComponent(client.id)}/establecimientos`);
  if (hiddenSelector === "#operation-seller-id") {
    setSelectOptions("#operation-renspa-origin-select", establishments.items || [], "Elegir RENSPA origen");
  }
  if (hiddenSelector === "#operation-buyer-id") {
    setSelectOptions("#operation-renspa-destination-select", establishments.items || [], "Elegir RENSPA destino");
  }
}

function syncOperationType() {
  const type = $("#operation-type").value;
  const isDirect = type === "DIRECTA";
  $("#operation-consignee-block").hidden = isDirect;
  $("#operation-consignee-name").disabled = isDirect;
  if (isDirect) {
    $("#operation-consignee-id").value = "";
    $("#operation-consignee-name").value = "";
    $("#operation-consignee-suggestions").hidden = true;
  }
}

async function saveOperation(event) {
  event.preventDefault();
  setOperationMessage("Guardando borrador...");
  const originManual = $("#operation-renspa-origin-manual").value.trim();
  const destinationManual = $("#operation-renspa-destination-manual").value.trim();
  const payload = {
    id: $("#operation-id").value,
    fecha: $("#operation-date").value,
    fechaCarga: $("#operation-load-date").value,
    tipo: $("#operation-type").value,
    ventaAnticipada: $("#operation-anticipated").checked,
    destino: $("#operation-destination").value,
    vendedorId: $("#operation-seller-id").value,
    compradorId: $("#operation-buyer-id").value,
    consignatariaId: $("#operation-consignee-id").value,
    calculoFrigorificoComp: $("#operation-frigo-mode").value,
    renspaOrigen: originManual || $("#operation-renspa-origin-select").value,
    renspaDestino: destinationManual || $("#operation-renspa-destination-select").value,
    establecimientoOrigen: "Carga manual",
    establecimientoDestino: "Carga manual",
    guardarRenspaOrigen: $("#operation-save-renspa-origin").checked && Boolean(originManual),
    guardarRenspaDestino: $("#operation-save-renspa-destination").checked && Boolean(destinationManual),
    dte: $("#operation-dte").value,
    condiciones: $("#operation-conditions").value
  };

  try {
    const saved = await fetchJson("/api/operaciones", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const operaciones = await fetchJson("/api/operaciones");
    state.operaciones = operaciones.items || [];
    renderOperaciones();
    renderMetrics();
    await openSale(saved.item.id, "sale");
    setOperationMessage(`Borrador ${saved.item.id} guardado correctamente.`, "ok");
  } catch (error) {
    setOperationMessage(error.message, "error");
  }
}

function syncBuyerDiff() {
  if (isFaenaSaleOperation()) {
    syncSaleMode();
    renderSalePreview();
    return;
  }
  const enabled = $("#sale-buyer-different").checked;
  $("#sale-buyer-diff").hidden = !enabled;
  $("#sale-buyer-correction").hidden = !enabled;
  renderSalePreview();
}

async function saveSaleLine(event) {
  event.preventDefault();
  if (!state.selectedOperationId) {
    setSaleMessage("Primero hay que abrir una operacion.", "error");
    return;
  }
  setSaleMessage("Guardando linea...");
  syncSaleMode();
  const faena = isFaenaSaleOperation();
  const buyerDifferent = faena ? false : $("#sale-buyer-different").checked;
  const payload = {
    categoria: $("#sale-category").value,
    cabezas: $("#sale-heads").value,
    kgBruto: $("#sale-kg-bruto").value,
    desbasteVend: faena ? "0" : $("#sale-desbaste-vend").value,
    kgNetoVend: $("#sale-kg-neto-vend").value,
    tipoPrecioVend: faena ? "KG" : $("#sale-tipo-precio-vend").value,
    precioVend: parseMoneyInput($("#sale-precio-vend").value),
    compradorDiferente: buyerDifferent,
    tabVend: faena ? "" : $("#sale-tab-vend").value,
    usarKgRealVend: faena ? false : $("#sale-use-real-kg-vend").checked,
    kgCalculoVend: faena ? "" : $("#sale-kg-calc-vend").value,
    promUsadoVend: faena ? "" : $("#sale-prom-used-vend").value,
    precioFinalManualVend: parseMoneyInput($("#sale-final-price-manual-vend").value) || "",
    importeManualVend: parseMoneyInput($("#sale-amount-manual-vend").value) || "",
    desbasteComp: faena ? "0" : $("#sale-desbaste-comp").value,
    kgComp: faena ? "" : $("#sale-kg-comp").value,
    tipoPrecioComp: faena ? "KG" : $("#sale-tipo-precio-comp").value,
    precioComp: parseMoneyInput($("#sale-precio-comp").value),
    tabComp: faena ? "" : $("#sale-tab-comp").value,
    usarKgRealComp: faena ? false : $("#sale-use-real-kg-comp").checked,
    kgCalculoComp: faena ? "" : $("#sale-kg-calc-comp").value,
    promUsadoComp: faena ? "" : $("#sale-prom-used-comp").value,
    precioFinalManualComp: parseMoneyInput($("#sale-final-price-manual-comp").value) || "",
    importeManualComp: parseMoneyInput($("#sale-amount-manual-comp").value) || ""
  };

  try {
    await fetchJson(`/api/operaciones/${encodeURIComponent(state.selectedOperationId)}/venta-lineas`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const [operaciones, categorias] = await Promise.all([
      fetchJson("/api/operaciones"),
      fetchJson("/api/categorias")
    ]);
    state.operaciones = operaciones.items || [];
    state.categorias = categorias.items || [];
    renderOperaciones();
    renderMetrics();
    renderCategories();
    await openSale(state.selectedOperationId);
    $("#sale-form").reset();
    $("#sale-category-suggestions").hidden = true;
    $("#sale-category-suggestions").innerHTML = "";
    $("#sale-desbaste-vend").value = "0";
    $("#sale-desbaste-comp").value = "0";
    syncSaleMode();
    syncBuyerDiff();
    setSaleMessage("Linea agregada correctamente.", "ok");
  } catch (error) {
    setSaleMessage(error.message, "error");
  }
}

async function saveLiquidation(event) {
  event.preventDefault();
  if (!state.selectedOperationId) {
    setLiquidationMessage("Primero hay que abrir una operacion.", "error");
    return;
  }
  setLiquidationMessage("Guardando liquidacion...");
  const payload = {
    importeFacturado: parseMoneyInput($("#liq-facturado").value),
    comprobanteProd: $("#liq-comprobante-prod").value,
    comprobanteComp: $("#liq-comprobante-comp").value,
    ivaProd: parseMoneyInput($("#liq-iva-prod").value),
    ivaComp: parseMoneyInput($("#liq-iva-comp").value),
    efectivoProd: parseMoneyInput($("#liq-efectivo-prod").value),
    efectivoComp: parseMoneyInput($("#liq-efectivo-comp").value),
    comisionFacturadoProd: parseMoneyInput($("#liq-comision-fact-prod").value),
    comisionFacturadoComp: parseMoneyInput($("#liq-comision-fact-comp").value),
    comisionEfectivoProd: parseMoneyInput($("#liq-comision-efect-prod").value),
    comisionEfectivoComp: parseMoneyInput($("#liq-comision-efect-comp").value),
    comisionFacturadoProdPct: percentValue("#liq-comision-fact-prod-pct"),
    comisionFacturadoCompPct: percentValue("#liq-comision-fact-comp-pct"),
    comisionEfectivoProdPct: percentValue("#liq-comision-efect-prod-pct"),
    comisionEfectivoCompPct: percentValue("#liq-comision-efect-comp-pct"),
    liquidacionConsignatariaA: $("#liq-consignee-settled-party").value,
    efectivoModo: $("#liq-cash-mode").value,
    efectivoPorc: $("#liq-cash-percent").value,
    planFacturadoProd: $("#liq-plan-fact-prod").value,
    planFacturadoComp: $("#liq-plan-fact-comp").value,
    planEfectivoProd: $("#liq-plan-cash-prod").value,
    planEfectivoComp: $("#liq-plan-cash-comp").value,
    ivaDirectaSinIva: $("#liq-direct-no-iva").checked,
    comisionDetalleProd: numberValue("#liq-exp-comision-prod"),
    fondoGarantiaProd: numberValue("#liq-exp-fondo-gtia-prod"),
    controlEntregaProd: numberValue("#liq-exp-control-prod"),
    fondoCompGastosProd: numberValue("#liq-exp-fondo-comp-prod"),
    retIibbProd: numberValue("#liq-exp-iibb-prod"),
    retGananciasProd: numberValue("#liq-exp-ganancias-prod"),
    otrosGastosProd: numberValue("#liq-exp-otros-prod"),
    ivaGastosProd: numberValue("#liq-exp-iva-gastos-prod"),
    observGastosProd: $("#liq-exp-observ-prod").value,
    gastoProcesamientoComp: numberValue("#liq-exp-procesamiento-comp"),
    otrosGastosComp1: numberValue("#liq-exp-otros-1-comp"),
    otrosGastosComp2: numberValue("#liq-exp-otros-2-comp"),
    observGastosComp: $("#liq-exp-observ-comp").value,
    conceptoGastoEfectivoProd: $("#liq-cash-exp-concept-prod").value,
    gastoEfectivoProd: numberValue("#liq-cash-exp-prod"),
    porcComisionConsignataria: percentValue("#liq-consignee-commission-pct"),
    conceptoAjusteConsignataria: $("#liq-consignee-adjustment-concept").value,
    ajusteConsignataria: numberValue("#liq-consignee-adjustment"),
    detalleLiquidacionDirectaProd: $("#liq-direct-notes").value,
    comprobanteCompDiferente: $("#liq-different-buyer-receipt").checked,
    netoFinalFrigorificoComp: parseMoneyInput($("#frigo-neto-final").value),
    observaciones: $("#liq-observaciones").value,
    detalleLiquidar: collectLiquidationDetail()
  };
  try {
  const saved = await fetchJson(`/api/operaciones/${encodeURIComponent(state.selectedOperationId)}/liquidacion`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    fillLiquidationForm(saved.item);
    setLiquidationMessage("Liquidacion guardada correctamente.", "ok");
  } catch (error) {
    setLiquidationMessage(error.message, "error");
  }
}

function renderReport() {
  const operation = state.currentOperation;
  if (!operation) return;
  $("#report-panel").hidden = state.operationStep !== "report";
  const draft = operation.draftData || {};
  const detail = collectLiquidationDetail();
  const calc = calculateLiquidationPreview();
  const expenses = getSellerExpenses();
  const buyerExpenses = getBuyerExpenses();
  const frigoCalc = isFrigorificoIvaOperation(operation) ? getFrigorificoCalc(operation) : null;
  const dueBaseDate = draft.fechaCarga || operation.fecha || "";
  const conditions = operation.condiciones || draft.condicionesOperacion || "";
  const sellerCuit = operation.vendedorCuit || draft.vendedorCuit || "";
  const buyerCuit = operation.compradorCuit || draft.compradorCuit || "";
  const consignee = operation.consignataria || draft.consignataria || "";
  const sellerExpensesTotal = Object.values(expenses).reduce((sum, value) => sum + Number(value || 0), 0);

  const detailRows = detail.map((item) => `
    <tr>
      <td>${escapeHtml(item.cantidad)}</td>
      <td>${escapeHtml(item.categoria)}</td>
      <td>${moneyValue(item.precioCabeza)}</td>
      <td>${moneyValue(item.importeNeto)}</td>
      <td>${moneyValue(item.iva)}</td>
      <td>${moneyValue(item.importeBruto)}</td>
    </tr>
  `).join("");
  const totalDetail = detail.reduce((sum, item) => sum + Number(item.importeBruto || 0), 0);

  const dueRows = (groups) => groups
    .filter((group) => Number(group.base || 0) !== 0)
    .flatMap((group) => parseDuePlan(group.plan, group.base).map((item) => `
    <tr><td>${escapeHtml(group.title)}</td><td>${escapeHtml(addDisplayDays(dueBaseDate, item.days))}</td><td>${item.manual ? "-" : `${String(Number(item.pct.toFixed(2))).replace(".", ",")}%`}</td><td>${moneyValue(item.amount)}</td></tr>
  `)).join("");

  const sellerDueRows = dueRows([
    { title: "Liquidacion / facturado", plan: $("#liq-plan-fact-prod").value, base: calc.netoLiquidacionProd },
    { title: "Efectivo", plan: $("#liq-plan-cash-prod").value, base: calc.cashWithIvaProd - calc.cashExpenseProd }
  ]);
  const buyerDueRows = dueRows([
    { title: "Liquidacion / facturado", plan: $("#liq-plan-fact-comp").value, base: calc.netoLiquidacionComp },
    { title: "Efectivo", plan: $("#liq-plan-cash-comp").value, base: calc.efectivoComp }
  ]);
  const sellerLines = (operation.saleLines || []).map((line) => `
    <tr><td>${escapeHtml(line.categoria)}</td><td>${escapeHtml(line.cabezas || "")}</td><td>${escapeHtml(line.kgNetoVend || "")}</td><td>${escapeHtml(line.promVend || line.promNeto || "")}</td><td>${moneyValue(line.precioFinalVend || line.precioVend)}</td><td>${moneyValue(line.importeVend)}</td></tr>
  `).join("");
  const buyerLines = (operation.saleLines || []).map((line) => `
    <tr><td>${escapeHtml(line.categoria)}</td><td>${escapeHtml(line.cabezas || "")}</td><td>${escapeHtml(line.kgComp || line.kgNetoVend || "")}</td><td>${escapeHtml(line.promComp || line.promVend || line.promNeto || "")}</td><td>${moneyValue(line.precioFinalComp || line.precioComp || line.precioFinalVend || line.precioVend)}</td><td>${moneyValue(line.importeComp || line.importeVend)}</td></tr>
  `).join("");
  const operationData = (party, name, cuit, counterpartName, counterpartCuit) => `
    <div class="report-kv">
      <span>${party}</span><strong>${escapeHtml(name || "-")}</strong>
      <span>CUIT</span><strong>${escapeHtml(cuit || "-")}</strong>
      <span>DTE</span><strong>${escapeHtml(operation.dte || "-")}</strong>
      <span>RENSPA origen</span><strong>${escapeHtml(operation.renspaOrigen || "-")}</strong>
      <span>RENSPA destino</span><strong>${escapeHtml(operation.renspaDestino || "-")}</strong>
      <span>Fecha carga</span><strong>${escapeHtml(dueBaseDate || "-")}</strong>
    </div>
    <div class="report-kv">
      <span>${isConsignedOperation(operation) ? "Consignataria" : "Contraparte"}</span><strong>${escapeHtml(isConsignedOperation(operation) ? consignee : counterpartName || "-")}</strong>
      ${isConsignedOperation(operation) ? "" : `<span>CUIT contraparte</span><strong>${escapeHtml(counterpartCuit || "-")}</strong>`}
    </div>
  `;
  const reportHeader = (title) => `
    <div class="report-header">
      <div>
        <h2>Gonzalo Espinosa Hacienda y Liquidaciones</h2>
        <p class="subtle">${escapeHtml(title)} - Operacion ${escapeHtml(operation.id)}</p>
      </div>
      <img class="report-logo" src="/logo-espinosa-blanco.png" alt="">
    </div>
    <div class="report-title"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(operationTypeLabel(operation))} - ${escapeHtml(operation.destino || "")}</span></div>
  `;
  const operationNote = conditions ? `<div class="report-note"><span>Minuta / condiciones de la operacion</span><strong>${escapeHtml(conditions)}</strong></div>` : "";
  const detailReport = `
    <div class="report-section">
      <h3>Detalle para liquidar</h3>
      <table class="report-table">
        <thead><tr><th>Cant.</th><th>Categoria</th><th>Precio/cab.</th><th>Neto</th><th>IVA</th><th>Bruto</th></tr></thead>
        <tbody>${detailRows}<tr class="report-total"><td colspan="5">Total detalle</td><td>${moneyValue(totalDetail)}</td></tr></tbody>
      </table>
    </div>
  `;
  const sellerExpensesReport = sellerExpensesTotal ? `
    <div class="report-section">
      <h3>Gastos y descuentos liquidacion vendedor</h3>
      <table class="report-table">
        <tbody>
          <tr><th>Comision</th><td>${moneyValue(expenses.comision)}</td><th>Fondo de garantia</th><td>${moneyValue(expenses.fondoGarantia)}</td></tr>
          <tr><th>Control y entrega</th><td>${moneyValue(expenses.controlEntrega)}</td><th>Fondo comp. gastos</th><td>${moneyValue(expenses.fondoCompGastos)}</td></tr>
          <tr><th>Neto gravado</th><td>${moneyValue(calc.netoGravadoProd)}</td><th>Ingresos Brutos</th><td>${moneyValue(expenses.retIibb)}</td></tr>
          <tr><th>Retencion Ganancias</th><td>${moneyValue(expenses.retGanancias)}</td><th>Otros gastos</th><td>${moneyValue(expenses.otrosGastos)}</td></tr>
          <tr><th>IVA s/gastos</th><td>${moneyValue(expenses.ivaGastos)}</td><th>Detalle</th><td>${escapeHtml($("#liq-exp-observ-prod").value || "-")}</td></tr>
        </tbody>
      </table>
    </div>
  ` : "";
  const buyerExpensesReport = buyerExpenses.total ? `
    <div class="report-section">
      <h3>Gastos liquidacion comprador</h3>
      <table class="report-table">
        <tbody>
          <tr><th>Gastos de procesamiento</th><td>${moneyValue(buyerExpenses.procesamiento)}</td><th>Otros gastos 1</th><td>${moneyValue(buyerExpenses.otros1)}</td></tr>
          <tr><th>Otros gastos 2</th><td>${moneyValue(buyerExpenses.otros2)}</td><th>Detalle</th><td>${escapeHtml($("#liq-exp-observ-comp").value || "-")}</td></tr>
        </tbody>
      </table>
    </div>
  ` : "";
  const frigoReport = frigoCalc ? `
    <div class="report-section">
      <h3>Calculo vendedor por frigorifico con IVA incluido</h3>
      <table class="report-table">
        <tbody>
          <tr><th>Imp. neto final con IVA</th><td>${moneyValue(frigoCalc.netoFinal)}</td><th>Imp. bruto OP sin IVA</th><td>${moneyValue(frigoCalc.brutoSinIva)}</td></tr>
          <tr><th>Imp. bruto liquidado</th><td>${moneyValue(frigoCalc.facturado)}</td><th>IVA s/bruto 10,5%</th><td>${moneyValue(frigoCalc.ivaLiquidacion)}</td></tr>
          <tr><th>Efectivo sin IVA</th><td>${moneyValue(frigoCalc.efectivoSinIva)}</td><th>IVA sobre efectivo</th><td>${moneyValue(frigoCalc.ivaEfectivo)}</td></tr>
          <tr><th>Efectivo + IVA</th><td>${moneyValue(frigoCalc.efectivoConIva)}</td><th>Total control</th><td>${moneyValue(frigoCalc.totalControl)}</td></tr>
        </tbody>
      </table>
    </div>
  ` : "";
  const dueReport = (rows) => `
    <div class="report-section">
      <h3>Vencimientos</h3>
      <table class="report-table">
        <thead><tr><th>Concepto</th><th>Fecha</th><th>%</th><th>Importe</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4">Sin vencimientos informados.</td></tr>`}</tbody>
      </table>
    </div>
  `;
  $("#report-sheet").innerHTML = `
    <div class="report-pages">
      <section class="report-page-block seller-report">
        ${reportHeader("REPORTE FINAL PARA PRODUCTOR")}
        ${operationData("Productor", operation.vendedor, sellerCuit, operation.comprador, buyerCuit)}
        ${operationNote}
        <div class="report-section"><h3>Carga real</h3><table class="report-table"><thead><tr><th>Categoria</th><th>Cant.</th><th>Kg neto</th><th>Prom.</th><th>Precio final</th><th>Importe</th></tr></thead><tbody>${sellerLines}</tbody></table></div>
        ${isDirectOperation(operation) ? detailReport : ""}
        ${frigoReport}
        ${dueReport(sellerDueRows)}
        <div class="report-section"><h3>Liquidacion / facturado</h3><table class="report-table"><tbody>
          <tr><th>Comprobante</th><td>${escapeHtml($("#liq-comprobante-prod").value || "-")}</td><th>Importe bruto operacion</th><td>${moneyValue(calc.brutoVend || numberValue("#liq-bruto-vend"))}</td></tr>
          <tr><th>Importe facturado</th><td>${moneyValue(calc.facturado)}</td><th>IVA liquidacion</th><td>${moneyValue(calc.ivaProd)}</td></tr>
        </tbody></table></div>
        ${sellerExpensesReport}
        ${calc.comFactProd ? `<div class="report-line"><span>Comision sobre facturado</span><strong>${moneyValue(calc.comFactProd)}</strong></div>` : ""}
        <div class="report-net seller-net"><span>NETO LIQUIDACION</span><strong>${moneyValue(calc.netoLiquidacionProd)}</strong></div>
        ${calc.efectivoProd || calc.cashExpenseProd || calc.comEfProd ? `<div class="report-section"><h3>Efectivo</h3><table class="report-table"><tbody>
          <tr><th>Efectivo</th><td>${moneyValue(calc.efectivoProd)}</td>${frigoCalc ? `<th>IVA sobre efectivo</th><td>${moneyValue(calc.cashWithIvaProd - calc.efectivoProd)}</td>` : "<th></th><td></td>"}</tr>
          ${frigoCalc ? `<tr><th>Efectivo + IVA</th><td>${moneyValue(calc.cashWithIvaProd)}</td><th></th><td></td></tr>` : ""}
          ${calc.cashExpenseProd ? `<tr><th>Gasto descontado efectivo</th><td>${moneyValue(calc.cashExpenseProd)}</td><th>Concepto</th><td>${escapeHtml($("#liq-cash-exp-concept-prod").value || "-")}</td></tr>` : ""}
          ${calc.comEfProd ? `<tr><th>Comision sobre efectivo</th><td>${moneyValue(calc.comEfProd)}</td><th></th><td></td></tr>` : ""}
        </tbody></table></div>` : ""}
        <div class="report-net seller-net total"><span>NETO TOTAL OPERACION</span><strong>${moneyValue(calc.netoTotalProd)}</strong></div>
      </section>
      <section class="report-page-block buyer-report">
        ${reportHeader("REPORTE FINAL PARA COMPRADOR")}
        ${operationData("Comprador", operation.comprador, buyerCuit, operation.vendedor, sellerCuit)}
        ${operationNote}
        <div class="report-section"><h3>Carga real</h3><table class="report-table"><thead><tr><th>Categoria</th><th>Cant.</th><th>Kg comp.</th><th>Prom.</th><th>Precio final</th><th>Importe</th></tr></thead><tbody>${buyerLines}</tbody></table></div>
        ${detailReport}
        ${dueReport(buyerDueRows)}
        <div class="report-section"><h3>Liquidacion / facturado</h3><table class="report-table"><tbody>
          <tr><th>Comprobante</th><td>${escapeHtml($("#liq-comprobante-comp").value || "-")}</td><th>Importe bruto operacion</th><td>${moneyValue(calc.brutoComp || numberValue("#liq-bruto-comp"))}</td></tr>
          <tr><th>Importe facturado</th><td>${moneyValue(calc.facturado)}</td><th>IVA liquidacion</th><td>${moneyValue(calc.ivaComp)}</td></tr>
        </tbody></table></div>
        ${buyerExpensesReport}
        ${calc.comFactComp ? `<div class="report-line"><span>Comision sobre facturado</span><strong>${moneyValue(calc.comFactComp)}</strong></div>` : ""}
        <div class="report-net buyer-net"><span>NETO LIQUIDACION</span><strong>${moneyValue(calc.netoLiquidacionComp)}</strong></div>
        ${calc.efectivoComp || calc.comEfComp ? `<div class="report-section"><h3>Efectivo</h3><table class="report-table"><tbody>
          <tr><th>Efectivo</th><td>${moneyValue(calc.efectivoComp)}</td><th>Comision sobre efectivo</th><td>${moneyValue(calc.comEfComp)}</td></tr>
        </tbody></table></div>` : ""}
        <div class="report-net buyer-net total"><span>NETO TOTAL OPERACION</span><strong>${moneyValue(calc.netoTotalComp)}</strong></div>
      </section>
    </div>
  `;
}

function resetClientForm() {
  $("#client-form").reset();
  $("#client-id").value = "";
  state.selectedClientId = "";
  $("#client-form-title").textContent = "Nuevo cliente";
  $("#client-cancel").hidden = true;
  $("#renspa-panel").hidden = true;
  $("#renspa-list").innerHTML = "";
  $("#client-name-suggestions").hidden = true;
  $("#client-name-suggestions").innerHTML = "";
  setClientMessage("");
  setRenspaMessage("");
}

async function loadRenspas(clientId) {
  if (!clientId) return;
  const response = await fetchJson(`/api/clientes/${encodeURIComponent(clientId)}/establecimientos`);
  const items = response.items || [];
  $("#renspa-list").innerHTML = items.length
    ? items.map((item) => `
        <div class="renspa-item">
          <strong>${escapeHtml(item.renspa)}</strong>
          <span>${escapeHtml(item.nombre || "Establecimiento")}</span>
          ${item.observaciones ? `<span>${escapeHtml(item.observaciones)}</span>` : ""}
        </div>
      `).join("")
    : `<div class="renspa-item"><span>Sin RENSPA asociados todavia.</span></div>`;
}

async function editClient(clientId) {
  const client = state.clientes.find((item) => String(item.id) === String(clientId));
  if (!client) return;
  state.selectedClientId = client.id;
  $("#client-id").value = client.id;
  $("#client-name").value = client.nombre || "";
  $("#client-cuit").value = client.cuit || "";
  $("#client-type").value = client.tipo || "Cliente";
  $("#client-notes").value = client.observaciones || "";
  $("#client-name-suggestions").hidden = true;
  $("#client-name-suggestions").innerHTML = "";
  $("#client-form-title").textContent = "Editar cliente";
  $("#client-cancel").hidden = false;
  $("#renspa-panel").hidden = false;
  setClientMessage("Editando cliente existente.");
  setRenspaMessage("");
  await loadRenspas(client.id);
}

async function saveClient(event) {
  event.preventDefault();
  setClientMessage("Guardando...");

  const id = $("#client-id").value;
  const payload = {
    nombre: $("#client-name").value,
    cuit: $("#client-cuit").value,
    tipo: $("#client-type").value,
    observaciones: $("#client-notes").value
  };

  try {
    const saved = await fetchJson(id ? `/api/clientes/${encodeURIComponent(id)}` : "/api/clientes", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    const clientes = await fetchJson("/api/clientes");
    state.clientes = clientes.items || [];
    renderMetrics();
    renderClientes();
    await editClient(saved.item.id);
    setClientMessage("Cliente guardado correctamente.", "ok");
  } catch (error) {
    setClientMessage(error.message, "error");
  }
}

async function addRenspa() {
  if (!state.selectedClientId) {
    setRenspaMessage("Primero hay que guardar o seleccionar el cliente.", "error");
    return;
  }
  setRenspaMessage("Guardando...");
  try {
    await fetchJson(`/api/clientes/${encodeURIComponent(state.selectedClientId)}/establecimientos`, {
      method: "POST",
      body: JSON.stringify({
        nombre: $("#renspa-name").value,
        renspa: $("#renspa-value").value,
        observaciones: $("#renspa-notes").value
      })
    });
    $("#renspa-name").value = "";
    $("#renspa-value").value = "";
    $("#renspa-notes").value = "";
    await loadRenspas(state.selectedClientId);
    setRenspaMessage("RENSPA agregado correctamente.", "ok");
  } catch (error) {
    setRenspaMessage(error.message, "error");
  }
}

async function init() {
  $all("nav button").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  $("#client-search").addEventListener("input", renderClientes);
  $("#client-show-all").addEventListener("click", () => {
    state.showAllClients = !state.showAllClients;
    renderClientes();
  });
  $("#client-name").addEventListener("input", renderClientNameSuggestions);
  $("#operation-seller-name").addEventListener("input", () => renderPartySuggestions("#operation-seller-name", "#operation-seller-suggestions", "#operation-seller-id"));
  $("#operation-buyer-name").addEventListener("input", () => renderPartySuggestions("#operation-buyer-name", "#operation-buyer-suggestions", "#operation-buyer-id"));
  $("#operation-consignee-name").addEventListener("input", () => renderPartySuggestions("#operation-consignee-name", "#operation-consignee-suggestions", "#operation-consignee-id"));
  $("#cc-client-search").addEventListener("input", renderCuentaCorriente);
  $("#cc-view-mode").addEventListener("change", () => {
    const label = document.querySelector("label:has(#cc-client-search)");
    if (label) label.childNodes[0].nodeValue = $("#cc-view-mode").value === "CONSIGNATARIA" ? "Buscar consignataria" : "Buscar cliente";
    renderCuentaCorriente();
  });
  $("#cc-status-filter").addEventListener("change", renderCuentaCorriente);
  $("#cc-concept-filter").addEventListener("change", renderCuentaCorriente);
  $("#cc-due-filter").addEventListener("change", renderCuentaCorriente);
  $("#cc-print-report").addEventListener("click", () => printCurrentAccountReport());
  $("#cc-print-due-report").addEventListener("click", printCurrentAccountDueReport);
  $("#cc-open-external").addEventListener("click", () => openCurrentAccountPanel("#cc-external-panel"));
  $("#cc-close-external").addEventListener("click", () => { $("#cc-external-panel").hidden = true; });
  $("#cc-save-external").addEventListener("click", saveExternalCurrentAccountMovement);
  $("#cc-open-payment").addEventListener("click", () => openCurrentAccountPanel("#cc-payment-panel"));
  $("#cc-close-payment").addEventListener("click", () => { $("#cc-payment-panel").hidden = true; });
  $("#cc-save-payment").addEventListener("click", () => saveCurrentAccountPayment());
  $("#cc-save-payment-receipt").addEventListener("click", () => saveCurrentAccountPayment(true));
  $("#cc-payment-client").addEventListener("input", renderCurrentAccountImputations);
  $("#cc-payment-type").addEventListener("change", () => {
    $("#cc-counterparty-type").value = $("#cc-payment-type").value === "PAGO" ? "COBRO" : "PAGO";
    renderCurrentAccountImputations();
    renderCurrentAccountCounterpartyImputations();
  });
  $("#cc-counterparty-enabled").addEventListener("change", () => {
    $("#cc-counterparty-panel").hidden = !$("#cc-counterparty-enabled").checked;
    renderCurrentAccountCounterpartyImputations();
  });
  $("#cc-counterparty-client").addEventListener("input", renderCurrentAccountCounterpartyImputations);
  $("#cc-counterparty-type").addEventListener("change", renderCurrentAccountCounterpartyImputations);
  $("#cc-add-instrument").addEventListener("click", addCurrentAccountInstrument);
  $("#cc-instrument-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cc-remove-instrument]");
    if (!button) return;
    currentPaymentInstruments = currentPaymentInstruments.filter((item) => item.id !== button.dataset.ccRemoveInstrument);
    renderCurrentAccountInstruments();
  });
  $("#cc-imputation-body").addEventListener("change", (event) => {
    if (event.target.matches("[data-cc-impute]")) refreshPrimaryImputationSummary();
  });
  $("#cc-counterparty-body").addEventListener("change", (event) => {
    if (event.target.matches("[data-cc-counterparty-impute]")) refreshCounterpartyImputationSummary();
  });
  $("#cc-movements-body").addEventListener("click", async (event) => {
    const receiptButton = event.target.closest("[data-cc-payment-receipt]");
    if (receiptButton) {
      const payment = (state.cuenta.pagos || []).find((item) => item.id === receiptButton.dataset.ccPaymentReceipt);
      if (payment) printCurrentAccountReceipt(payment);
      return;
    }
    const cancelButton = event.target.closest("[data-cc-payment-cancel]");
    if (cancelButton) {
      const confirmed = window.confirm("Se anulara el comprobante y su contrapartida, si existe. Los movimientos imputados volveran a quedar pendientes. ¿Continuar?");
      if (!confirmed) return;
      await fetchJson(`/api/cuenta-corriente/pagos-cobros/${encodeURIComponent(cancelButton.dataset.ccPaymentCancel)}/anular`, { method: "POST" });
      await reloadCurrentAccount();
      return;
    }
    const reportButton = event.target.closest("[data-cc-operation-report]");
    if (!reportButton) return;
    setView("operaciones");
    await openSale(reportButton.dataset.ccOperationReport, "report");
  });
  $("#operation-type").addEventListener("change", syncOperationType);
  $("#operation-destination").addEventListener("change", () => {
    syncSaleMode();
    renderSalePreview();
  });
  $("#operation-form").addEventListener("submit", saveOperation);
  $("#operation-new").addEventListener("click", resetOperationForm);
  $("#operation-start-new").addEventListener("click", resetOperationForm);
  $("#operation-show-history").addEventListener("click", showOperationHistory);
  $all("[data-operation-step]").forEach((button) => {
    button.addEventListener("click", () => setOperationStep(button.dataset.operationStep));
  });
  $("#sale-form").addEventListener("submit", saveSaleLine);
  $("#liquidation-form").addEventListener("submit", saveLiquidation);
  $("#sale-buyer-different").addEventListener("change", syncBuyerDiff);
  $("#tab-save").addEventListener("click", saveTabRule);
  $("#sale-category").addEventListener("input", renderCategorySuggestions);
  $("#category-admin-toggle").addEventListener("click", () => {
    const panel = $("#category-admin-panel");
    panel.hidden = !panel.hidden;
    $("#category-admin-toggle").textContent = panel.hidden ? "Abrir listado" : "Cerrar listado";
    if (!panel.hidden) renderCategoryAdmin();
  });
  $("#category-admin-search").addEventListener("input", renderCategoryAdmin);
  $("#category-admin-body").addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-category]");
    if (saveButton) {
      const row = saveButton.closest("tr");
      const input = row.querySelector("[data-category-original]");
      saveCategory(saveButton.dataset.saveCategory, input.value);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-category]");
    if (deleteButton) deleteCategory(deleteButton.dataset.deleteCategory);
  });
  $all("#sale-form input, #sale-form select").forEach((input) => {
    input.addEventListener("input", renderSalePreview);
    input.addEventListener("change", renderSalePreview);
  });
  $all("#liquidation-form input").forEach((input) => {
    input.addEventListener("input", renderLiquidationTotals);
  });
  $("#liq-facturado").addEventListener("input", () => {
    syncLiquidationCashFromFacturado();
    renderLiquidationDetail(buildDetailFromSaleLines());
    renderLiquidationTotals();
  });
  $all("#liquidation-form select").forEach((select) => {
    select.addEventListener("change", renderLiquidationTotals);
  });
  $("#liq-direct-no-iva").addEventListener("change", () => {
    const iva = $("#liq-direct-no-iva").checked ? 0 : numberValue("#liq-facturado") * 0.105;
    setMoneyInput("#liq-iva-prod", iva);
    setMoneyInput("#liq-iva-comp", iva);
    renderLiquidationDetail(buildDetailFromSaleLines());
    renderLiquidationTotals();
  });
  $("#liq-different-buyer-receipt").addEventListener("change", () => {
    syncLiquidationReceipts();
  });
  $("#liq-comprobante-prod").addEventListener("input", () => {
    syncLiquidationReceipts("prod");
  });
  $("#liq-comprobante-comp").addEventListener("input", () => syncLiquidationReceipts("comp"));
  $("#liq-consignee-settled-party").addEventListener("change", () => syncLiquidationReceipts());
  $("#liq-iva-prod").addEventListener("input", () => {
    if (isDirectOperation()) setMoneyInput("#liq-iva-comp", numberValue("#liq-iva-prod"));
  });
  document.addEventListener("focusin", (event) => {
    if (!event.target.classList || !event.target.classList.contains("money-input")) return;
    unformatMoneyInput(event.target);
  });
  document.addEventListener("focusout", (event) => {
    if (!event.target.classList || !event.target.classList.contains("money-input")) return;
    formatMoneyInput(event.target);
    renderLiquidationTotals();
    renderReport();
  });
  $("#client-form").addEventListener("submit", saveClient);
  $("#client-cancel").addEventListener("click", resetClientForm);
  $("#renspa-add").addEventListener("click", addRenspa);
  $("#clientes-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-client]");
    if (!button) return;
    editClient(button.dataset.editClient);
  });
  $("#operaciones-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-sale]");
    if (!button) return;
    openSale(button.dataset.openSale);
  });
  $("#client-name-suggestions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-suggest-client]");
    if (!button) return;
    editClient(button.dataset.suggestClient);
  });
  $all("#operation-seller-suggestions, #operation-buyer-suggestions, #operation-consignee-suggestions").forEach((node) => {
    node.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pick-client]");
      if (!button) return;
      pickOperationClient(button.dataset.pickClient, button.dataset.input, button.dataset.hidden);
    });
  });
  $("#sale-category-suggestions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-pick-category]");
    if (!button) return;
    $("#sale-category").value = button.dataset.pickCategory;
    $("#sale-category-suggestions").hidden = true;
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".suggestions") || event.target.closest("#operation-seller-name, #operation-buyer-name, #operation-consignee-name, #client-name, #sale-category")) return;
    closeSuggestions();
  });
  $("#liq-rebuild-detail").addEventListener("click", () => {
    renderLiquidationDetail(buildDetailFromSaleLines());
    renderReport();
  });
  $("#liq-detail-body").addEventListener("input", renderReport);
  $("#liq-detail-body").addEventListener("change", (event) => {
    if (!event.target.matches("[data-detail-field]")) return;
    recalculateLiquidationDetailRow(event.target);
  });
  $("#print-report").addEventListener("click", () => window.print());

  const health = await fetchJson("/api/health");
  $("#status").textContent = health.modo === "postgres" ? "PostgreSQL conectado" : "Backup local";

  const [clientes, operaciones, cuenta, categorias, tabs] = await Promise.all([
    fetchJson("/api/clientes"),
    fetchJson("/api/operaciones"),
    fetchJson("/api/cuenta-corriente/resumen"),
    fetchJson("/api/categorias"),
    fetchJson("/api/tabs")
  ]);

  state.clientes = clientes.items || [];
  state.operaciones = operaciones.items || [];
  state.cuenta = cuenta;
  state.categorias = categorias.items || [];
  state.tabRules = tabs.items || [];

  renderMetrics();
  renderClientes();
  renderOperaciones();
  renderCategories();
  renderTabRules();
  renderCuentaCorriente();
  populateCurrentAccountClients();
  setSelectOptions("#operation-renspa-origin-select", [], "Elegir RENSPA origen");
  setSelectOptions("#operation-renspa-destination-select", [], "Elegir RENSPA destino");
  $("#operation-date").value = new Date().toISOString().slice(0, 10);
  $("#operation-load-date").value = $("#operation-date").value;
  syncOperationType();
  setOperationModeNew();
  showOperationWorkspace();
  setOperationStep("operation");
  syncBuyerDiff();
}

async function bootstrap() {
  $("#login-form").addEventListener("submit", login);
  $("#logout-button").addEventListener("click", logout);
  const session = await fetchJson("/api/auth/session").catch(() => null);
  if (!session) {
    $("#login-screen").hidden = false;
    return;
  }
  $("#login-screen").hidden = true;
  applyUserRole(session.usuario);
  await init();
}

bootstrap().catch((error) => {
  $("#status").textContent = error.message;
  $("#status").style.color = "#9b1c1c";
});
