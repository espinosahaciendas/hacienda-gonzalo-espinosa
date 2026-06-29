const state = {
  clientes: [],
  operaciones: [],
  cuenta: null,
  caja: { items: [], total: 0, totalHoy: 0, totalMes: 0, pendienteRecuperar: 0 },
  cajaConciliaciones: { items: [], totalRecibido: 0, totalAplicado: 0, saldo: 0, abiertas: 0 },
  documentos: [],
  vista: "tablero",
  selectedClientId: "",
  showAllClients: false,
  selectedOperationId: "",
  categorias: [],
  tabRules: [],
  currentOperation: null,
  operationStep: "operation",
  reportMode: "auto",
  editingSaleLineId: "",
  editingExternalMovementId: "",
  liquidationFacturadoTouched: false,
  liquidationIvaProdTouched: false,
  liquidationIvaCompTouched: false,
  frigoBrutoSinIvaTouched: false,
  externalDueRows: [],
  commissionistRows: [],
  usuario: null,
  weightTickets: [],
  reportRefreshInFlight: false
};
let currentPaymentInstruments = [];
let documentFilterIds = [];
let selectedDocumentId = "";
let cashReconciliationBreakdown = [];
let cashReconciliationApplications = [];
const APP_BUILD = "20260629-reporte-conciliaciones";

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
  const previousView = state.vista;
  state.vista = view;
  $all(".view").forEach((section) => section.classList.toggle("active", section.id === view));
  $all("nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const titles = {
    tablero: "Tablero",
    consulta: "Consulta movil",
    clientes: "Clientes",
    operaciones: "Operaciones",
    cuenta: "Cuenta corriente",
    calendario: "Calendario",
    caja: "Caja",
    archivo: "Archivo documental",
    resumenes: "Resumenes",
    comisionistas: "Comisionistas"
  };
  $("#view-title").textContent = titles[view] || "Sistema";
  if (!state.restoringHistory && previousView !== view) {
    window.history.pushState({ view }, "", `#${view}`);
  }
}

function preferredInitialView() {
  return window.matchMedia && window.matchMedia("(max-width: 720px)").matches ? "consulta" : "tablero";
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
    "#category-admin-toggle",
    "#download-backup",
    "#cash-form",
    "#cash-clear",
    "#cash-rec-form",
    "#cash-rec-clear",
    "#document-form",
    "#commissionist-load",
    "#commissionist-generate"
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

async function reloadAppData() {
  const [clientes, operaciones, cuenta, categorias, tabs, caja, cajaConciliaciones, documentos] = await Promise.all([
    fetchJson("/api/clientes"),
    fetchJson("/api/operaciones"),
    fetchJson("/api/cuenta-corriente/resumen"),
    fetchJson("/api/categorias"),
    fetchJson("/api/tabs"),
    fetchJson("/api/caja-diaria"),
    fetchJson("/api/caja-conciliaciones"),
    fetchJson("/api/documentos")
  ]);

  state.clientes = clientes.items || [];
  state.operaciones = operaciones.items || [];
  state.cuenta = cuenta;
  state.categorias = categorias.items || [];
  state.tabRules = tabs.items || [];
  state.caja = caja || { items: [], total: 0, totalHoy: 0, totalMes: 0, pendienteRecuperar: 0 };
  state.cajaConciliaciones = cajaConciliaciones || { items: [], totalRecibido: 0, totalAplicado: 0, saldo: 0, abiertas: 0 };
  state.documentos = documentos.items || [];

  renderMetrics();
  renderCajaDiaria();
  renderCashReconciliations();
  renderDocumentos();
  renderClientes();
  renderOperaciones();
  renderCategories();
  renderTabRules();
  renderCuentaCorriente();
  populateCurrentAccountClients();
  populateCommissionistClients();
  renderMobileSummary();
  renderCommissionistRows();
}

function downloadBackup() {
  window.location.href = "/api/backup/download";
}

function setDocumentMessage(message, type = "") {
  const node = $("#document-message");
  if (!node) return;
  node.textContent = message || "";
  node.className = `form-message ${type}`.trim();
}

function resetDocumentForm() {
  $("#document-entity-type").value = "MOVIMIENTO";
  $("#document-entity-id").value = "";
  $("#document-client").value = "";
  $("#document-type").value = "Liquidacion";
  $("#document-title").value = "";
  $("#document-file").value = "";
  $("#document-notes").value = "";
  setDocumentMessage("");
}

function documentDownloadUrl(documentId) {
  return `/api/documentos/${encodeURIComponent(documentId)}/descargar`;
}

function documentReferenceText(documento) {
  const type = documento.entidadTipo || "GENERAL";
  const id = documento.entidadId || documento.operacion || documento.movimientoId || documento.pagoId || "-";
  return `${type}: ${id}`;
}

function relatedDocumentsForMovement(movement) {
  const movementId = String(movement.id || "");
  const operationId = String(movement.operacion || "");
  const paymentId = String(movement.paymentId || "");
  return (state.documentos || []).filter((documento) =>
    (movementId && String(documento.movimientoId || documento.entidadId) === movementId)
    || (operationId && String(documento.operacion || documento.entidadId) === operationId)
    || (paymentId && String(documento.pagoId || documento.entidadId) === paymentId)
  );
}

function documentActionButtons(movement) {
  const docs = relatedDocumentsForMovement(movement);
  const payload = encodeURIComponent(JSON.stringify({
    id: movement.id || "",
    cliente: movement.cliente || "",
    operacion: movement.operacion || "",
    pagoId: movement.paymentId || "",
    comprobante: movement.comprobante || "",
    concepto: movement.concepto || ""
  }));
  return ` <button type="button" class="small-button" data-document-attach="${payload}">Adjuntar PDF</button>${docs.length ? ` <button type="button" class="small-button" data-document-list="${payload}">PDFs (${docs.length})</button>` : ""}`;
}

function renderDocumentos() {
  if (!$("#document-body")) return;
  const allDocs = state.documentos || [];
  const docs = documentFilterIds.length
    ? allDocs.filter((documento) => documentFilterIds.includes(String(documento.id)))
    : allDocs;
  $("#document-show-all").hidden = !documentFilterIds.length;
  $("#document-summary").textContent = documentFilterIds.length
    ? docs.length
      ? `${docs.length} PDF relacionado/s con el movimiento seleccionado.`
      : "No hay PDF adjunto para este movimiento."
    : docs.length ? `${docs.length} documento/s cargado/s.` : "Sin documentos cargados.";
  $("#document-body").innerHTML = docs.length
    ? docs.map((documento) => `
        <tr class="${String(documento.id) === selectedDocumentId ? "selected-row" : ""}">
          <td>${escapeHtml(documento.creadoEn ? new Date(documento.creadoEn).toLocaleDateString("es-AR") : "-")}</td>
          <td>${escapeHtml(documento.cliente || "-")}</td>
          <td>${escapeHtml(documento.tipo || "-")}</td>
          <td><strong>${escapeHtml(documento.titulo || "-")}</strong>${documento.observacion ? `<small>${escapeHtml(documento.observacion)}</small>` : ""}</td>
          <td>${escapeHtml(documentReferenceText(documento))}</td>
          <td>${escapeHtml(documento.nombreOriginal || "-")}<small>${escapeHtml(`${documento.storageProvider || "-"} / ${documento.storageBucket || "-"} / ${documento.storagePath || "-"}`)}</small></td>
          <td><button type="button" class="small-button" data-document-view="${escapeHtml(documento.id)}">Ver en pantalla</button> <a class="small-button" href="${documentDownloadUrl(documento.id)}" target="_blank" rel="noopener">Abrir PDF</a>${state.usuario?.rol === "CONSULTA" ? "" : ` <button type="button" class="small-button danger-button" data-document-delete="${escapeHtml(documento.id)}">Eliminar</button>`}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="7">Sin documentos cargados.</td></tr>`;
}

function showDocumentPreview(documentId) {
  const documento = (state.documentos || []).find((item) => String(item.id) === String(documentId));
  if (!documento) return;
  selectedDocumentId = String(documento.id);
  const url = documentDownloadUrl(documento.id);
  $("#document-preview-panel").hidden = false;
  $("#document-preview-title").textContent = documento.titulo || documento.nombreOriginal || "Vista del comprobante";
  $("#document-preview-subtitle").textContent = `${documento.cliente || "-"} · ${documentReferenceText(documento)}`;
  $("#document-preview-open").href = url;
  $("#document-preview-frame").src = url;
  renderDocumentos();
}

function clearDocumentPreview() {
  selectedDocumentId = "";
  $("#document-preview-panel").hidden = true;
  $("#document-preview-frame").src = "about:blank";
}

function fillDocumentFormFromMovement(movement) {
  documentFilterIds = [];
  clearDocumentPreview();
  const isPayment = Boolean(movement.pagoId);
  $("#document-entity-type").value = isPayment ? "PAGO" : movement.operacion ? "OPERACION" : "MOVIMIENTO";
  $("#document-entity-id").value = isPayment ? movement.pagoId : movement.operacion || movement.id || "";
  $("#document-client").value = movement.cliente || "";
  $("#document-title").value = movement.comprobante ? `${movement.comprobante} - ${movement.cliente || ""}`.trim() : movement.concepto || "";
  $("#document-type").value = isPayment ? "Recibo / pago" : "Liquidacion";
  $("#document-notes").value = movement.concepto || "";
  setView("archivo");
  setDocumentMessage("Referencia cargada. Selecciona el PDF y guarda.", "ok");
}

function openDocumentsForMovement(movement) {
  const docs = relatedDocumentsForMovement(movement);
  documentFilterIds = docs.map((documento) => String(documento.id));
  setView("archivo");
  if (docs.length) {
    showDocumentPreview(docs[0].id);
    setDocumentMessage(`${docs.length} PDF relacionado/s.`, "ok");
  } else {
    clearDocumentPreview();
    fillDocumentFormFromMovement(movement);
    setDocumentMessage("Este movimiento todavia no tiene PDF adjunto. Queda cargada la referencia por si queres adjuntarlo.", "error");
  }
  renderDocumentos();
}

async function saveDocument(event) {
  event.preventDefault();
  const file = $("#document-file").files[0];
  if (!file) {
    setDocumentMessage("Falta seleccionar un PDF.", "error");
    return;
  }
  setDocumentMessage("Subiendo PDF...");
  const entityType = $("#document-entity-type").value;
  const entityId = $("#document-entity-id").value.trim();
  const form = new FormData();
  form.append("archivo", file);
  form.append("entidadTipo", entityType);
  form.append("entidadId", entityId);
  form.append("cliente", $("#document-client").value);
  form.append("tipo", $("#document-type").value);
  form.append("titulo", $("#document-title").value || file.name);
  form.append("observacion", $("#document-notes").value);
  if (entityType === "OPERACION") form.append("operacion", entityId);
  if (entityType === "MOVIMIENTO") form.append("movimientoId", entityId);
  if (entityType === "PAGO") form.append("pagoId", entityId);
  try {
    const response = await fetch("/api/documentos", { method: "POST", body: form });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "No se pudo subir el PDF.");
    }
    resetDocumentForm();
    await reloadAppData();
    setView("archivo");
    setDocumentMessage("PDF adjuntado correctamente.", "ok");
  } catch (error) {
    setDocumentMessage(error.message, "error");
  }
}

async function deleteDocument(documentId) {
  if (!window.confirm("Se eliminara la referencia y el PDF original. ¿Continuar?")) return;
  await fetchJson(`/api/documentos/${encodeURIComponent(documentId)}`, { method: "DELETE" });
  await reloadAppData();
  setView("archivo");
  if (String(selectedDocumentId) === String(documentId)) clearDocumentPreview();
}

function setCashMessage(message, type = "") {
  const node = $("#cash-message");
  if (!node) return;
  node.textContent = message || "";
  node.className = `form-message ${type}`.trim();
}

function setCashReconciliationMessage(message, type = "") {
  const node = $("#cash-rec-message");
  if (!node) return;
  node.textContent = message || "";
  node.className = `form-message ${type}`.trim();
}

function setCashReconciliationPayMessage(message, type = "") {
  const node = $("#cash-rec-pay-message");
  if (!node) return;
  node.textContent = message || "";
  node.className = `form-message ${type}`.trim();
}

function setCashTab(tab) {
  const isDaily = tab !== "conciliaciones";
  $("#cash-daily-view").hidden = !isDaily;
  $("#cash-reconciliation-view").hidden = isDaily;
  $all("[data-cash-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.cashTab === (isDaily ? "diaria" : "conciliaciones"));
  });
}

function resetCashForm() {
  $("#cash-id").value = "";
  $("#cash-date").value = new Date().toISOString().slice(0, 10);
  $("#cash-concept").value = "";
  $("#cash-provider").value = "";
  $("#cash-category").value = "Gasto oficina";
  $("#cash-amount").value = "";
  $("#cash-method").value = "Efectivo";
  $("#cash-source").value = "";
  $("#cash-paid-by").value = "";
  $("#cash-receipt").value = "";
  $("#cash-recovered").checked = false;
  $("#cash-notes").value = "";
  setCashMessage("");
}

function resetCashReconciliationForm() {
  const today = new Date().toISOString().slice(0, 10);
  $("#cash-rec-id").value = "";
  $("#cash-rec-date").value = today;
  $("#cash-rec-client").value = "";
  $("#cash-rec-reference").value = "";
  $("#cash-rec-amount").value = "";
  $("#cash-rec-notes").value = "";
  $("#cash-rec-app-date").value = today;
  $("#cash-rec-app-concept").value = "";
  $("#cash-rec-app-to").value = "";
  $("#cash-rec-app-amount").value = "";
  if ($("#cash-rec-pay-date")) $("#cash-rec-pay-date").value = today;
  if ($("#cash-rec-pay-concept")) $("#cash-rec-pay-concept").value = "";
  if ($("#cash-rec-pay-to")) $("#cash-rec-pay-to").value = "";
  if ($("#cash-rec-pay-amount")) $("#cash-rec-pay-amount").value = "";
  $("#cash-rec-break-concept").value = "";
  $("#cash-rec-break-detail").value = "";
  $("#cash-rec-break-amount").value = "";
  cashReconciliationBreakdown = [];
  cashReconciliationApplications = [];
  setCashReconciliationMessage("");
  setCashReconciliationPayMessage("");
  renderCashReconciliationBreakdown();
  renderCashReconciliationApplications();
}

function renderCajaDiaria() {
  if (!$("#cash-body")) return;
  const caja = state.caja || {};
  const items = caja.items || [];
  $("#cash-total-today").textContent = moneyValue(caja.totalHoy);
  $("#cash-total-month").textContent = moneyValue(caja.totalMes);
  $("#cash-pending-recover").textContent = moneyValue(caja.pendienteRecuperar);
  $("#cash-total-all").textContent = moneyValue(caja.total);
  $("#cash-body").innerHTML = items.length
    ? items.map((item) => `
        <tr class="${item.recuperado ? "cash-recovered-row" : ""}">
          <td>${escapeHtml(item.fecha || "-")}</td>
          <td><strong>${escapeHtml(item.concepto || "-")}</strong>${item.proveedor ? `<small>${escapeHtml(item.proveedor)}</small>` : ""}</td>
          <td>${escapeHtml(item.categoria || "-")}</td>
          <td class="amount negative">${moneyValue(item.importe)}</td>
          <td>${escapeHtml(item.origenEfectivo || "-")}</td>
          <td>${escapeHtml(item.pagadoPor || "-")}</td>
          <td>${item.recuperado ? "Recuperado" : "Pendiente"}</td>
          <td>
            ${state.usuario?.rol === "CONSULTA" ? "-" : `<button type="button" class="small-button" data-cash-edit="${escapeHtml(item.id)}">Editar</button>
            <button type="button" class="small-button danger-button" data-cash-delete="${escapeHtml(item.id)}">Eliminar</button>`}
          </td>
        </tr>
      `).join("")
    : `<tr><td colspan="8">Sin movimientos de caja cargados.</td></tr>`;
}

function renderCashReconciliationApplications() {
  const total = cashReconciliationApplications.reduce((sum, item) => sum + Number(item.importe || 0), 0);
  const recibido = parseMoneyInput($("#cash-rec-amount")?.value || 0);
  const saldo = recibido - total;
  $("#cash-rec-app-summary").textContent = cashReconciliationApplications.length
    ? `${cashReconciliationApplications.length} aplicacion/es - aplicado ${moneyValue(total)} - saldo ${moneyValue(saldo)}`
    : recibido ? `Sin aplicaciones - saldo ${moneyValue(recibido)}` : "Sin aplicaciones cargadas";
  $("#cash-rec-app-body").innerHTML = cashReconciliationApplications.length
    ? cashReconciliationApplications.map((item) => `
        <tr>
          <td>${escapeHtml(formatDate(item.fecha))}</td>
          <td>${escapeHtml(item.concepto || "-")}</td>
          <td>${escapeHtml(item.destino || "-")}</td>
          <td class="amount negative">${moneyValue(item.importe)}</td>
          <td><button type="button" class="small-button danger-button" data-cash-rec-app-remove="${escapeHtml(item.id)}">Quitar</button></td>
        </tr>
      `).join("")
    : `<tr><td colspan="5">Sin aplicaciones cargadas.</td></tr>`;
}

function renderCashReconciliationBreakdown() {
  const total = cashReconciliationBreakdown.reduce((sum, item) => sum + Number(item.importe || 0), 0);
  const recibido = parseMoneyInput($("#cash-rec-amount")?.value || 0);
  const diff = recibido - total;
  $("#cash-rec-breakdown-summary").textContent = cashReconciliationBreakdown.length
    ? `${cashReconciliationBreakdown.length} item/s - detallado ${moneyValue(total)} - diferencia ${moneyValue(diff)}`
    : recibido ? `Sin detalle - recibido ${moneyValue(recibido)}` : "Sin detalle cargado";
  $("#cash-rec-break-body").innerHTML = cashReconciliationBreakdown.length
    ? cashReconciliationBreakdown.map((item) => `
        <tr>
          <td>${escapeHtml(item.concepto || "-")}</td>
          <td>${escapeHtml(item.detalle || "-")}</td>
          <td class="amount positive">${moneyValue(item.importe)}</td>
          <td><button type="button" class="small-button danger-button" data-cash-rec-break-remove="${escapeHtml(item.id)}">Quitar</button></td>
        </tr>
      `).join("")
    : `<tr><td colspan="4">Sin detalle cargado.</td></tr>`;
}

function addCashReconciliationBreakdown() {
  const importe = parseMoneyInput($("#cash-rec-break-amount").value);
  const concepto = $("#cash-rec-break-concept").value.trim();
  if (!concepto || importe <= 0) {
    setCashReconciliationMessage("Para agregar el detalle carga concepto e importe mayor a cero.", "error");
    return;
  }
  cashReconciliationBreakdown.push({
    id: `DET-${Date.now()}-${cashReconciliationBreakdown.length}`,
    concepto,
    detalle: $("#cash-rec-break-detail").value,
    importe
  });
  $("#cash-rec-break-concept").value = "";
  $("#cash-rec-break-detail").value = "";
  $("#cash-rec-break-amount").value = "";
  setCashReconciliationMessage("");
  renderCashReconciliationBreakdown();
}

function addCashReconciliationApplication() {
  const importe = parseMoneyInput($("#cash-rec-app-amount").value);
  const concepto = $("#cash-rec-app-concept").value.trim();
  if (!concepto || importe <= 0) {
    setCashReconciliationMessage("Para agregar una aplicacion carga concepto e importe mayor a cero.", "error");
    return;
  }
  cashReconciliationApplications.push({
    id: `APP-${Date.now()}-${cashReconciliationApplications.length}`,
    fecha: $("#cash-rec-app-date").value || $("#cash-rec-date").value,
    concepto,
    destino: $("#cash-rec-app-to").value,
    importe
  });
  $("#cash-rec-app-concept").value = "";
  $("#cash-rec-app-to").value = "";
  $("#cash-rec-app-amount").value = "";
  setCashReconciliationMessage("");
  renderCashReconciliationApplications();
}

function renderCashReconciliations() {
  if (!$("#cash-rec-body")) return;
  const data = state.cajaConciliaciones || {};
  const items = data.items || [];
  $("#cash-rec-total-in").textContent = moneyValue(data.totalRecibido || 0);
  $("#cash-rec-total-out").textContent = moneyValue(data.totalAplicado || 0);
  $("#cash-rec-balance").textContent = moneyValue(data.saldo || 0);
  $("#cash-rec-open-count").textContent = data.abiertas || 0;
  $("#cash-rec-body").innerHTML = items.length
    ? items.map((item) => `
        <tr>
          <td>${escapeHtml(item.fecha || "-")}</td>
          <td><strong>${escapeHtml(item.recibidoDe || "-")}</strong>${item.observacion ? `<small>${escapeHtml(item.observacion)}</small>` : ""}</td>
          <td>${escapeHtml(item.referencia || "-")}</td>
          <td class="amount positive">${moneyValue(item.importeRecibido)}</td>
          <td class="amount negative">${moneyValue(item.totalAplicado)}</td>
          <td class="${amountClass(item.saldo)}">${moneyValue(item.saldo)}</td>
          <td>${Math.abs(Number(item.saldo || 0)) <= 0.01 ? "Cerrada" : "Abierta"}</td>
          <td>
            <button type="button" class="small-button" data-cash-rec-print="${escapeHtml(item.id)}">PDF</button>
            ${state.usuario?.rol === "CONSULTA" ? "" : `<button type="button" class="small-button" data-cash-rec-edit="${escapeHtml(item.id)}">Editar</button>
            <button type="button" class="small-button danger-button" data-cash-rec-delete="${escapeHtml(item.id)}">Eliminar</button>`}
          </td>
        </tr>
        ${item.detalleRecibido?.length ? `<tr class="cc-detail-row"><td colspan="8"><strong>Detalle recibido:</strong> ${item.detalleRecibido.map((det) => `${escapeHtml(det.concepto || "-")} · ${escapeHtml(det.detalle || "-")} · ${moneyValue(det.importe)}`).join(" | ")}</td></tr>` : ""}
        ${item.aplicaciones?.length ? `<tr class="cc-detail-row"><td colspan="8"><strong>Aplicaciones:</strong> ${item.aplicaciones.map((app) => `${escapeHtml(app.fecha || "-")} · ${escapeHtml(app.concepto || "-")} · ${moneyValue(app.importe)}`).join(" | ")}</td></tr>` : ""}
      `).join("")
    : `<tr><td colspan="8">Sin conciliaciones de efectivo cargadas.</td></tr>`;
  renderCashReconciliationOpenBalances(items);
}

function renderCashReconciliationOpenBalances(items = state.cajaConciliaciones.items || []) {
  if (!$("#cash-rec-open-body")) return;
  const openItems = items.filter((item) => Math.abs(Number(item.saldo || 0)) > 0.01);
  $("#cash-rec-open-body").innerHTML = openItems.length
    ? openItems.map((item) => `
        <tr>
          <td><input type="checkbox" data-cash-rec-open="${escapeHtml(item.id)}" data-cash-rec-balance="${Number(item.saldo || 0)}"></td>
          <td>${escapeHtml(item.fecha || "-")}</td>
          <td>${escapeHtml(item.recibidoDe || "-")}</td>
          <td>${escapeHtml(item.referencia || "-")}</td>
          <td class="${amountClass(item.saldo)}">${moneyValue(item.saldo)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="5">Sin ingresos con saldo disponible.</td></tr>`;
}

function fillCashForm(item) {
  $("#cash-id").value = item.id || "";
  $("#cash-date").value = dateToInput(item.fecha);
  $("#cash-concept").value = item.concepto || "";
  $("#cash-provider").value = item.proveedor || "";
  $("#cash-category").value = item.categoria || "Gasto oficina";
  $("#cash-amount").value = moneyValue(item.importe);
  $("#cash-method").value = item.medio || "Efectivo";
  $("#cash-source").value = item.origenEfectivo || "";
  $("#cash-paid-by").value = item.pagadoPor || "";
  $("#cash-receipt").value = item.comprobante || "";
  $("#cash-recovered").checked = Boolean(item.recuperado);
  $("#cash-notes").value = item.observacion || "";
  setCashMessage("Movimiento listo para editar.", "ok");
}

function fillCashReconciliationForm(item) {
  $("#cash-rec-id").value = item.id || "";
  $("#cash-rec-date").value = dateToInput(item.fecha);
  $("#cash-rec-client").value = item.recibidoDe || "";
  $("#cash-rec-reference").value = item.referencia || "";
  $("#cash-rec-amount").value = moneyValue(item.importeRecibido);
  $("#cash-rec-notes").value = item.observacion || "";
  cashReconciliationBreakdown = (item.detalleRecibido || []).map((detail, index) => ({
    id: detail.id || `DET-EDIT-${index}`,
    concepto: detail.concepto || "",
    detalle: detail.detalle || "",
    importe: Number(detail.importe || 0)
  }));
  cashReconciliationApplications = (item.aplicaciones || []).map((app, index) => ({
    id: app.id || `EDIT-${index}`,
    fecha: dateToInput(app.fecha),
    concepto: app.concepto || "",
    destino: app.destino || "",
    importe: Number(app.importe || 0)
  }));
  setCashTab("conciliaciones");
  renderCashReconciliationBreakdown();
  renderCashReconciliationApplications();
  setCashReconciliationMessage("Conciliacion lista para editar.", "ok");
}

async function saveCashMovement(event) {
  event.preventDefault();
  setCashMessage("Guardando movimiento...");
  const payload = {
    id: $("#cash-id").value,
    fecha: $("#cash-date").value,
    concepto: $("#cash-concept").value,
    proveedor: $("#cash-provider").value,
    categoria: $("#cash-category").value,
    importe: parseMoneyInput($("#cash-amount").value),
    medio: $("#cash-method").value,
    origenEfectivo: $("#cash-source").value,
    pagadoPor: $("#cash-paid-by").value,
    comprobante: $("#cash-receipt").value,
    recuperado: $("#cash-recovered").checked,
    observacion: $("#cash-notes").value
  };
  try {
    const path = payload.id ? `/api/caja-diaria/${encodeURIComponent(payload.id)}` : "/api/caja-diaria";
    await fetchJson(path, { method: payload.id ? "PUT" : "POST", body: JSON.stringify(payload) });
    setCashMessage("Movimiento de caja guardado.", "ok");
    resetCashForm();
    await reloadAppData();
    setView("caja");
  } catch (error) {
    setCashMessage(error.message, "error");
  }
}

async function saveCashReconciliation(event) {
  event.preventDefault();
  setCashReconciliationMessage("Guardando conciliacion...");
  const payload = {
    id: $("#cash-rec-id").value,
    fecha: $("#cash-rec-date").value,
    recibidoDe: $("#cash-rec-client").value,
    referencia: $("#cash-rec-reference").value,
    importeRecibido: parseMoneyInput($("#cash-rec-amount").value),
    observacion: $("#cash-rec-notes").value,
    detalleRecibido: cashReconciliationBreakdown,
    aplicaciones: cashReconciliationApplications
  };
  try {
    const path = payload.id ? `/api/caja-conciliaciones/${encodeURIComponent(payload.id)}` : "/api/caja-conciliaciones";
    await fetchJson(path, { method: payload.id ? "PUT" : "POST", body: JSON.stringify(payload) });
    setCashReconciliationMessage("Conciliacion guardada.", "ok");
    resetCashReconciliationForm();
    await reloadAppData();
    setView("caja");
    setCashTab("conciliaciones");
  } catch (error) {
    setCashReconciliationMessage(error.message, "error");
  }
}

async function applyCashReconciliationPayment() {
  const selected = $all("[data-cash-rec-open]:checked");
  const payload = {
    conciliacionIds: selected.map((item) => item.dataset.cashRecOpen),
    fecha: $("#cash-rec-pay-date").value,
    concepto: $("#cash-rec-pay-concept").value,
    destino: $("#cash-rec-pay-to").value,
    importe: parseMoneyInput($("#cash-rec-pay-amount").value)
  };
  try {
    setCashReconciliationPayMessage("Aplicando pago...");
    await fetchJson("/api/caja-conciliaciones/aplicar-pago", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    $("#cash-rec-pay-concept").value = "";
    $("#cash-rec-pay-to").value = "";
    $("#cash-rec-pay-amount").value = "";
    setCashReconciliationPayMessage("Pago aplicado a los ingresos seleccionados.", "ok");
    await reloadAppData();
    setView("caja");
    setCashTab("conciliaciones");
  } catch (error) {
    setCashReconciliationPayMessage(error.message, "error");
  }
}

async function deleteCashMovement(id) {
  if (!window.confirm("Se eliminara este movimiento de caja. ¿Continuar?")) return;
  await fetchJson(`/api/caja-diaria/${encodeURIComponent(id)}`, { method: "DELETE" });
  await reloadAppData();
  setView("caja");
}

async function deleteCashReconciliation(id) {
  if (!window.confirm("Se eliminara esta conciliacion de efectivo. ¿Continuar?")) return;
  await fetchJson(`/api/caja-conciliaciones/${encodeURIComponent(id)}`, { method: "DELETE" });
  await reloadAppData();
  setView("caja");
  setCashTab("conciliaciones");
}

function printCashReport() {
  const caja = state.caja || {};
  const rows = caja.items || [];
  const popup = window.open("", "_blank", "width=1000,height=800");
  if (!popup) return;
  popup.document.write(`<!doctype html><html><head><title>Caja diaria</title><style>
    body{font-family:Arial,sans-serif;margin:12mm;color:#173632}
    header{border-bottom:2px solid #173632;padding-bottom:8px;margin-bottom:12px}
    h1{font-size:20px;margin:0} p{margin:4px 0}.summary{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
    .summary div{border:1px solid #cbd7d4;padding:7px 9px;min-width:150px}.summary span{display:block;color:#52706b;font-size:10px}.summary strong{font-size:14px}
    table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #cbd7d4;padding:5px;text-align:left;vertical-align:top}th{background:#edf3f1}.amount{text-align:right;font-weight:700}.pending{color:#9b1c1c;font-weight:700}
    button{margin-top:16px;padding:8px 12px}@media print{@page{size:A4 landscape;margin:8mm}button{display:none}body{margin:0}}
  </style></head><body>
    <header><h1>Gonzalo Espinosa Hacienda y Liquidaciones</h1><p>Caja diaria - gastos internos de oficina</p></header>
    <div class="summary">
      <div><span>Hoy</span><strong>${moneyValue(caja.totalHoy)}</strong></div>
      <div><span>Mes actual</span><strong>${moneyValue(caja.totalMes)}</strong></div>
      <div><span>Pendiente recuperar</span><strong>${moneyValue(caja.pendienteRecuperar)}</strong></div>
      <div><span>Total registrado</span><strong>${moneyValue(caja.total)}</strong></div>
    </div>
    <table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoria</th><th>Importe</th><th>Salio de</th><th>Pagado por</th><th>Comprobante</th><th>Estado</th><th>Observacion</th></tr></thead><tbody>
      ${rows.map((item) => `<tr><td>${escapeHtml(item.fecha || "-")}</td><td>${escapeHtml(item.concepto || "-")}${item.proveedor ? `<br>${escapeHtml(item.proveedor)}` : ""}</td><td>${escapeHtml(item.categoria || "-")}</td><td class="amount">${moneyValue(item.importe)}</td><td>${escapeHtml(item.origenEfectivo || "-")}</td><td>${escapeHtml(item.pagadoPor || "-")}</td><td>${escapeHtml(item.comprobante || "-")}</td><td class="${item.recuperado ? "" : "pending"}">${item.recuperado ? "Recuperado" : "Pendiente"}</td><td>${escapeHtml(item.observacion || "-")}</td></tr>`).join("")}
    </tbody></table>
    <button onclick="window.print()">Imprimir / guardar PDF</button>
  </body></html>`);
  popup.document.close();
}

function cashReconciliationReportItems(itemId = "") {
  const items = state.cajaConciliaciones?.items || [];
  if (itemId) return items.filter((item) => String(item.id) === String(itemId));
  const from = parseInputDate($("#cash-rec-report-from")?.value);
  const to = parseInputDate($("#cash-rec-report-to")?.value);
  return items.filter((item) => {
    const date = parseDisplayDate(item.fecha);
    if (!date) return false;
    const value = dateOnly(date);
    if (from && value < dateOnly(from)) return false;
    if (to && value > dateOnly(to)) return false;
    return true;
  });
}

function cashReconciliationRowsHtml(items) {
  if (!items.length) return `<tr><td colspan="7">Sin conciliaciones para el filtro seleccionado.</td></tr>`;
  return items.map((item) => {
    const detailRows = (item.detalleRecibido || []).length
      ? `<tr class="detail-row"><td colspan="7"><strong>Detalle recibido</strong><table><thead><tr><th>Concepto</th><th>Detalle</th><th>Importe</th></tr></thead><tbody>${item.detalleRecibido.map((detail) => `<tr><td>${escapeHtml(detail.concepto || "-")}</td><td>${escapeHtml(detail.detalle || "-")}</td><td class="amount positive">${moneyValue(detail.importe)}</td></tr>`).join("")}</tbody></table></td></tr>`
      : "";
    const applicationRows = (item.aplicaciones || []).length
      ? `<tr class="detail-row"><td colspan="7"><strong>Egresos / aplicaciones</strong><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Destino</th><th>Importe</th></tr></thead><tbody>${item.aplicaciones.map((app) => `<tr><td>${escapeHtml(app.fecha || "-")}</td><td>${escapeHtml(app.concepto || "-")}</td><td>${escapeHtml(app.destino || "-")}</td><td class="amount negative">${moneyValue(app.importe)}</td></tr>`).join("")}</tbody></table></td></tr>`
      : "";
    return `<tr>
      <td>${escapeHtml(item.fecha || "-")}</td>
      <td>${escapeHtml(item.recibidoDe || "-")}</td>
      <td>${escapeHtml(item.referencia || "-")}</td>
      <td class="amount positive">${moneyValue(item.importeRecibido)}</td>
      <td class="amount negative">${moneyValue(item.totalAplicado)}</td>
      <td class="amount ${Number(item.saldo || 0) >= 0 ? "positive" : "negative"}">${moneyValue(item.saldo)}</td>
      <td>${Math.abs(Number(item.saldo || 0)) <= 0.01 ? "Cerrada" : "Abierta"}</td>
    </tr>${detailRows}${applicationRows}${item.observacion ? `<tr class="detail-row"><td colspan="7"><strong>Observacion:</strong> ${escapeHtml(item.observacion)}</td></tr>` : ""}`;
  }).join("");
}

function printCashReconciliationReport(itemId = "") {
  const items = cashReconciliationReportItems(itemId);
  const totals = items.reduce((acc, item) => {
    acc.income += Number(item.importeRecibido || 0);
    acc.out += Number(item.totalAplicado || 0);
    acc.balance += Number(item.saldo || 0);
    return acc;
  }, { income: 0, out: 0, balance: 0 });
  const fromLabel = itemId ? "Movimiento individual" : ($("#cash-rec-report-from").value || "inicio");
  const toLabel = itemId ? "" : ($("#cash-rec-report-to").value || "fin");
  const title = itemId && items[0]
    ? safePdfTitle("Conciliacion", items[0].recibidoDe, items[0].fecha)
    : safePdfTitle("Conciliaciones_efectivo", fromLabel, toLabel);
  const popup = window.open("", "_blank", "width=1100,height=850");
  if (!popup) return;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body{font-family:Arial,sans-serif;margin:10mm;color:#173632}
    header{display:flex;align-items:center;gap:14px;border-bottom:2px solid #173632;padding-bottom:8px;margin-bottom:10px}
    img{width:72px;height:72px;object-fit:contain;background:#173632;padding:6px}
    h1{font-size:18px;margin:0} p{margin:3px 0;font-size:11px}
    .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0}
    .summary div{border:1px solid #cbd7d4;background:#f8fbfa;padding:6px}
    .summary span{display:block;color:#52706b;font-size:9px}.summary strong{font-size:12px}
    table{width:100%;border-collapse:collapse;font-size:9.5px;margin-top:7px}
    th,td{border:1px solid #cbd7d4;padding:4px 5px;text-align:left;vertical-align:top}
    th{background:#edf3f1}.amount{text-align:right;font-weight:700;white-space:nowrap}.positive{color:#0f6b43}.negative{color:#9b1c1c}
    .detail-row td{background:#f8fbfa}.detail-row table{font-size:9px;margin-top:4px}
    button{margin-top:14px;padding:8px 12px}@media print{@page{size:A4 landscape;margin:8mm}body{margin:0}button{display:none}}
  </style></head><body>
    <header><img src="${window.location.origin}/logo-espinosa-blanco.png"><div><h1>Conciliaciones de efectivo</h1><p>Gonzalo Espinosa - Hacienda y Liquidaciones</p><p>${escapeHtml(itemId ? "Movimiento individual" : `Periodo: ${fromLabel} a ${toLabel}`)}</p></div></header>
    <div class="summary">
      <div><span>Ingresos</span><strong>${moneyValue(totals.income)}</strong></div>
      <div><span>Egresos / aplicaciones</span><strong>${moneyValue(totals.out)}</strong></div>
      <div><span>Saldo</span><strong>${moneyValue(totals.balance)}</strong></div>
      <div><span>Movimientos</span><strong>${items.length}</strong></div>
    </div>
    <table><thead><tr><th>Fecha</th><th>Recibido de</th><th>Referencia</th><th>Ingreso</th><th>Egreso</th><th>Saldo</th><th>Estado</th></tr></thead><tbody>${cashReconciliationRowsHtml(items)}</tbody></table>
    <button onclick="window.print()">Imprimir / guardar PDF</button>
  </body></html>`);
  popup.document.close();
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

function operationDateForPeriod(operation) {
  return parseDisplayDate(operation.fechaCarga || operation.fecha || operation.draftData?.fechaCarga || operation.draftData?.fecha);
}

function periodDestinationLabel(operation) {
  const destination = normalizeSearch(operation.destino || operation.draftData?.destino || "");
  const frigo = isFrigorificoIvaOperation(operation);
  if (destination.includes("faena") || frigo) return frigo ? "FAENA / FRIGORIFICO" : "FAENA";
  if (destination.includes("invernada")) return "INVERNADA";
  if (destination.includes("cria")) return "CRIA";
  if (destination.includes("reproduccion")) return "REPRODUCCION";
  return (operation.destino || operation.draftData?.destino || "Sin destino").toUpperCase();
}

async function renderPeriodStats() {
  const from = parseInputDate($("#dashboard-period-from").value);
  const to = parseInputDate($("#dashboard-period-to").value);
  const typeFilter = normalizeSearch($("#period-type-filter").value);
  const destinationFilter = normalizeSearch($("#period-destination-filter").value);
  const categoryFilter = normalizeSearch($("#period-category-filter").value);
  const clientFilter = normalizeSearch($("#period-client-filter").value);
  const message = $("#period-message");
  message.textContent = "Calculando periodo...";
  message.className = "form-message";
  const details = await Promise.all(state.operaciones.map((operation) =>
    fetchJson(`/api/operaciones/${encodeURIComponent(operation.id)}`)
      .then((response) => ({ ...operation, ...(response.item || {}) }))
      .catch(() => operation)
  ));
  const operations = details.filter((operation) => {
    const date = operationDateForPeriod(operation);
    if (!date) return false;
    date.setHours(0, 0, 0, 0);
    if (from && date < dateOnly(from)) return false;
    if (to && date > dateOnly(to)) return false;
    const typeText = normalizeSearch(operation.tipo || operation.draftData?.tipo || "");
    const destinationText = normalizeSearch(`${operation.destino || operation.draftData?.destino || ""} ${periodDestinationLabel(operation)}`);
    const clientText = normalizeSearch([
      operation.vendedor,
      operation.comprador,
      operation.consignataria,
      operation.draftData?.vendedor,
      operation.draftData?.comprador,
      operation.draftData?.consignataria
    ].filter(Boolean).join(" "));
    const lineText = normalizeSearch((operation.saleLines || []).map((line) => line.categoria).join(" "));
    if (typeFilter && !typeText.includes(typeFilter)) return false;
    if (destinationFilter && !destinationText.includes(destinationFilter)) return false;
    if (clientFilter && !clientText.includes(clientFilter)) return false;
    if (categoryFilter && !lineText.includes(categoryFilter)) return false;
    return true;
  });
  const categories = new Map();
  const destinations = new Map();
  const clients = new Map();
  let heads = 0;
  let kilos = 0;
  let sellerTotal = 0;
  operations.forEach((operation) => {
    const destination = periodDestinationLabel(operation);
    const client = operation.vendedor || operation.draftData?.vendedor || "Sin cliente";
    const lines = (operation.saleLines || []).filter((line) => !categoryFilter || normalizeSearch(line.categoria).includes(categoryFilter));
    const destinationCurrent = destinations.get(destination) || { heads: 0, kilos: 0, amount: 0, operations: new Set() };
    const clientCurrent = clients.get(client) || { heads: 0, kilos: 0, amount: 0, operations: new Set() };
    destinationCurrent.operations.add(operation.id);
    clientCurrent.operations.add(operation.id);
    lines.forEach((line) => {
      const category = line.categoria || "Sin categoria";
      const count = Number(line.cabezas || 0);
      const kg = Number(line.kgNetoVend || line.kgCalculoVend || line.kgBruto || 0);
      const amount = Number(line.importeVend || 0);
      heads += count;
      kilos += kg;
      sellerTotal += amount;
      destinationCurrent.heads += count;
      destinationCurrent.kilos += kg;
      destinationCurrent.amount += amount;
      clientCurrent.heads += count;
      clientCurrent.kilos += kg;
      clientCurrent.amount += amount;
      const current = categories.get(category) || { heads: 0, kilos: 0, amount: 0, operations: new Set() };
      current.heads += count;
      current.kilos += kg;
      current.amount += amount;
      current.operations.add(operation.id);
      categories.set(category, current);
    });
    destinations.set(destination, destinationCurrent);
    clients.set(client, clientCurrent);
  });
  const categoryRows = Array.from(categories.entries())
    .map(([categoria, item]) => ({ categoria, heads: item.heads, kilos: item.kilos, amount: item.amount, operations: item.operations.size }))
    .sort((a, b) => b.heads - a.heads || a.categoria.localeCompare(b.categoria, "es"));
  const destinationRows = Array.from(destinations.entries())
    .map(([destino, item]) => ({ destino, heads: item.heads, kilos: item.kilos, amount: item.amount, operations: item.operations.size }))
    .sort((a, b) => b.heads - a.heads || a.destino.localeCompare(b.destino, "es"));
  const clientRows = Array.from(clients.entries())
    .map(([cliente, item]) => ({ cliente, heads: item.heads, kilos: item.kilos, amount: item.amount, operations: item.operations.size }))
    .filter((row) => row.heads || row.kilos || row.amount)
    .sort((a, b) => b.heads - a.heads || a.cliente.localeCompare(b.cliente, "es"));
  $("#period-operations").textContent = operations.length;
  $("#period-heads").textContent = plainNumberValue(heads);
  $("#period-kilos").textContent = `${plainNumberValue(kilos)} kgs`;
  $("#period-seller-total").textContent = moneyValue(sellerTotal);
  $("#period-destination-body").innerHTML = destinationRows.length
    ? destinationRows.map((row) => `<tr><td>${escapeHtml(row.destino)}</td><td>${row.operations}</td><td>${plainNumberValue(row.heads)}</td><td>${plainNumberValue(row.kilos)} kgs</td><td>${moneyValue(row.amount)}</td></tr>`).join("")
    : `<tr><td colspan="5">Sin destinos para el periodo.</td></tr>`;
  $("#period-category-body").innerHTML = categoryRows.length
    ? categoryRows.map((row) => `<tr><td>${escapeHtml(row.categoria)}</td><td>${plainNumberValue(row.heads)}</td><td>${plainNumberValue(row.kilos)} kgs</td><td>${row.operations}</td><td>${moneyValue(row.amount)}</td></tr>`).join("")
    : `<tr><td colspan="5">Sin categorias para el periodo.</td></tr>`;
  $("#period-client-body").innerHTML = clientRows.length
    ? clientRows.map((row) => `<tr><td>${escapeHtml(row.cliente)}</td><td>${row.operations}</td><td>${plainNumberValue(row.heads)}</td><td>${plainNumberValue(row.kilos)} kgs</td><td>${moneyValue(row.amount)}</td></tr>`).join("")
    : `<tr><td colspan="5">Sin clientes para el periodo.</td></tr>`;
  message.textContent = operations.length ? "Periodo calculado." : "No hay operaciones en ese periodo.";
  message.className = `form-message ${operations.length ? "ok" : ""}`.trim();
}

function operationLineKilos(line) {
  return Number(line.kgNetoVend || line.kgCalculoVend || line.kgComp || line.kgBruto || 0);
}

function operationSearchDate(operation) {
  return parseDisplayDate(operation.fechaCarga || operation.draftData?.fechaCarga || operation.fecha || operation.draftData?.fecha);
}

function operationSearchBasicMatches(operation, filters) {
  const date = operationSearchDate(operation);
  if (!date) return false;
  date.setHours(0, 0, 0, 0);
  if (filters.from && date < dateOnly(filters.from)) return false;
  if (filters.to && date > dateOnly(filters.to)) return false;
  const clientText = normalizeSearch([
    operation.vendedor,
    operation.comprador,
    operation.consignataria,
    operation.draftData?.vendedor,
    operation.draftData?.comprador,
    operation.draftData?.consignataria
  ].filter(Boolean).join(" "));
  const typeText = normalizeSearch(`${operation.tipo || operation.draftData?.tipo || ""} ${operation.destino || operation.draftData?.destino || ""} ${periodDestinationLabel(operation)}`);
  const generalText = normalizeSearch([
    operation.id,
    operation.vendedor,
    operation.comprador,
    operation.consignataria,
    operation.tipo,
    operation.destino,
    operation.draftData?.minuta,
    operation.draftData?.condiciones
  ].filter(Boolean).join(" "));
  if (filters.client && !clientText.includes(filters.client)) return false;
  if (filters.type && !typeText.includes(filters.type)) return false;
  if (filters.text && !generalText.includes(filters.text)) return false;
  return true;
}

function operationSearchLineSummary(operation, categoryFilter = "") {
  const lines = (operation.saleLines || []).filter((line) => !categoryFilter || normalizeSearch(line.categoria).includes(categoryFilter));
  return lines.reduce((acc, line) => {
    const category = line.categoria || "Sin categoria";
    const heads = Number(line.cabezas || 0);
    acc.heads += heads;
    acc.kilos += operationLineKilos(line);
    acc.amount += Number(line.importeVend || 0);
    acc.categories.set(category, (acc.categories.get(category) || 0) + heads);
    return acc;
  }, { heads: 0, kilos: 0, amount: 0, categories: new Map() });
}

async function renderOperationSearch() {
  const filters = {
    from: parseInputDate($("#operation-search-from").value),
    to: parseInputDate($("#operation-search-to").value),
    client: normalizeSearch($("#operation-search-client").value),
    type: normalizeSearch($("#operation-search-type").value),
    category: normalizeSearch($("#operation-search-category").value),
    text: normalizeSearch($("#operation-search-text").value)
  };
  const message = $("#operation-search-message");
  message.textContent = "Buscando operaciones...";
  message.className = "form-message";
  const candidates = state.operaciones.filter((operation) => operationSearchBasicMatches(operation, filters));
  const details = await Promise.all(candidates.map((operation) =>
    fetchJson(`/api/operaciones/${encodeURIComponent(operation.id)}`)
      .then((response) => ({ ...operation, ...(response.item || {}) }))
      .catch(() => operation)
  ));
  const rows = details
    .map((operation) => ({ operation, summary: operationSearchLineSummary(operation, filters.category) }))
    .filter((item) => !filters.category || item.summary.heads || item.summary.kilos || item.summary.amount)
    .sort((a, b) => {
      const dateA = operationSearchDate(a.operation)?.getTime() || 0;
      const dateB = operationSearchDate(b.operation)?.getTime() || 0;
      return dateB - dateA || String(b.operation.id || "").localeCompare(String(a.operation.id || ""), "es");
    });
  const totals = rows.reduce((acc, item) => {
    acc.heads += item.summary.heads;
    acc.kilos += item.summary.kilos;
    acc.amount += item.summary.amount;
    return acc;
  }, { heads: 0, kilos: 0, amount: 0 });
  $("#operation-search-count").textContent = rows.length;
  $("#operation-search-heads").textContent = plainNumberValue(totals.heads);
  $("#operation-search-kilos").textContent = `${plainNumberValue(totals.kilos)} kgs`;
  $("#operation-search-amount").textContent = moneyValue(totals.amount);
  $("#operation-search-body").innerHTML = rows.length
    ? rows.map(({ operation, summary }) => {
        const categories = Array.from(summary.categories.entries())
          .map(([name, heads]) => `${name}${heads ? ` (${plainNumberValue(heads)})` : ""}`)
          .join(", ");
        return `<tr>
          <td>${escapeHtml(operation.id || "-")}</td>
          <td>${escapeHtml(operation.fechaCarga || operation.draftData?.fechaCarga || operation.fecha || "-")}</td>
          <td>${escapeHtml(`${operationTypeLabel(operation)} ${operation.destino || operation.draftData?.destino || ""}`.trim())}</td>
          <td>${escapeHtml(operation.vendedor || operation.draftData?.vendedor || "-")}</td>
          <td>${escapeHtml(operation.comprador || operation.consignataria || operation.draftData?.comprador || operation.draftData?.consignataria || "-")}</td>
          <td>${escapeHtml(categories || "-")}</td>
          <td>${plainNumberValue(summary.heads)}</td>
          <td>${plainNumberValue(summary.kilos)} kgs</td>
          <td>${moneyValue(summary.amount)}</td>
          <td><button type="button" class="small-button" data-open-operation-search="${escapeHtml(operation.id)}">Abrir</button></td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="10">No hay operaciones para los filtros aplicados.</td></tr>`;
  message.textContent = rows.length ? "Busqueda lista." : "No se encontraron operaciones.";
  message.className = `form-message ${rows.length ? "ok" : ""}`.trim();
}

function movementDateForRealCommission(movement) {
  return parseDisplayDate(movement?.fecha) || parseDisplayDate(movement?.vencimiento) || null;
}

function isRealClientCommissionMovement(movement) {
  if (String(movement?.origen || "").toUpperCase() !== "COMISION") return false;
  if (movement?.paymentId) return false;
  if (normalizeSearch(movement?.concepto).includes("comisionista")) return false;
  return true;
}

function realCommissionRowsForFilters() {
  if (!state.cuenta) return [];
  const from = parseInputDate($("#real-commission-from").value);
  const to = parseInputDate($("#real-commission-to").value);
  const clientQuery = normalizeSearch($("#real-commission-client").value);
  const status = $("#real-commission-status").value;
  const kind = $("#real-commission-kind").value;
  const words = clientQuery.split(" ").filter(Boolean);
  return (state.cuenta.movimientos || [])
    .filter(isRealClientCommissionMovement)
    .map((movement) => ({ ...movement, commissionDate: movementDateForRealCommission(movement), commissionKind: commissionKind(movement) }))
    .filter((movement) => {
      if (!movement.commissionDate) return false;
      const date = dateOnly(movement.commissionDate);
      if (from && date < dateOnly(from)) return false;
      if (to && date > dateOnly(to)) return false;
      if (status !== "TODOS" && String(movement.estado || "").toUpperCase() !== status) return false;
      if (kind === "FACTURADO" && movement.commissionKind !== "facturado") return false;
      if (kind === "EFECTIVO" && movement.commissionKind !== "efectivo") return false;
      if (words.length) {
        const haystack = normalizeSearch(`${movement.cliente || ""} ${movement.contraparte || ""} ${movement.consignataria || ""} ${movement.comprobante || ""} ${movement.concepto || ""}`);
        if (!words.every((word) => haystack.includes(word))) return false;
      }
      return true;
    })
    .sort((a, b) => (b.commissionDate?.getTime() || 0) - (a.commissionDate?.getTime() || 0) || String(a.cliente || "").localeCompare(String(b.cliente || ""), "es"));
}

function renderRealCommissionSummary() {
  if (!state.cuenta || !$("#real-commission-detail-body")) return;
  const rows = realCommissionRowsForFilters();
  const byClient = new Map();
  let facturado = 0;
  let efectivo = 0;
  rows.forEach((movement) => {
    const amount = Number(movement.importe || 0);
    const client = movement.cliente || "Sin cliente";
    const current = byClient.get(client) || { cliente: client, facturado: 0, efectivo: 0, total: 0 };
    if (movement.commissionKind === "efectivo") {
      efectivo += amount;
      current.efectivo += amount;
    } else {
      facturado += amount;
      current.facturado += amount;
    }
    current.total += amount;
    byClient.set(client, current);
  });
  const total = facturado + efectivo;
  const clientRows = [...byClient.values()]
    .filter((row) => Math.abs(row.total) > 0.01)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.cliente.localeCompare(b.cliente, "es"));
  $("#real-commission-facturado").textContent = moneyValue(facturado);
  $("#real-commission-facturado").className = amountClass(facturado);
  $("#real-commission-efectivo").textContent = moneyValue(efectivo);
  $("#real-commission-efectivo").className = amountClass(efectivo);
  $("#real-commission-total").textContent = moneyValue(total);
  $("#real-commission-total").className = amountClass(total);
  $("#real-commission-count").textContent = rows.length;
  $("#real-commission-client-body").innerHTML = clientRows.length
    ? clientRows.map((row) => `<tr><td>${escapeHtml(row.cliente)}</td><td class="${amountClass(row.facturado)}">${row.facturado ? moneyValue(row.facturado) : "-"}</td><td class="${amountClass(row.efectivo)}">${row.efectivo ? moneyValue(row.efectivo) : "-"}</td><td class="${amountClass(row.total)}">${moneyValue(row.total)}</td></tr>`).join("")
    : `<tr><td colspan="4">Sin comisiones reales para estos filtros.</td></tr>`;
  $("#real-commission-detail-body").innerHTML = rows.length
    ? rows.slice(0, 200).map((movement) => {
        const amount = Number(movement.importe || 0);
        return `<tr class="${movement.commissionKind === "efectivo" ? "movement-cash" : ""}">
          <td>${escapeHtml(formatDisplayDate(movement.commissionDate))}</td>
          <td>${escapeHtml(movement.cliente || "-")}</td>
          <td>${movement.commissionKind === "efectivo" ? "Sobre efectivo" : "Sobre facturado"}</td>
          <td>${escapeHtml(movement.comprobante || "-")}</td>
          <td class="${amountClass(amount)}">${moneyValue(amount)}</td>
          <td>${escapeHtml(movement.estado || "-")}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6">Sin detalle para estos filtros.</td></tr>`;
  $("#real-commission-message").textContent = rows.length
    ? "Resumen calculado con comisiones reales de cuenta corriente."
    : "No hay comisiones reales en el periodo seleccionado.";
  $("#real-commission-message").className = `form-message ${rows.length ? "ok" : ""}`.trim();
}

function amountClass(value) {
  return Number(value || 0) < 0 ? "amount-negative" : "amount-positive";
}

function dayDiffFromToday(value) {
  const due = parseFlexibleDate(value);
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function dashboardDueRow(movement, mode) {
  const amount = Math.sign(Number(movement.importe || 0)) * Number(movement.importePendiente ?? Math.abs(Number(movement.importe || 0)));
  if (mode === "today") {
    return `<tr><td>${escapeHtml(movement.cliente || "-")}</td><td>${escapeHtml(currentAccountDueDetailText(movement))}</td><td class="${amountClass(amount)}">${moneyValue(amount)}</td></tr>`;
  }
  return `<tr><td>${escapeHtml(movement.vencimiento || "-")}</td><td>${escapeHtml(`${movement.cliente || "-"} - ${currentAccountDueDetailText(movement)}`)}</td><td class="${amountClass(amount)}">${moneyValue(amount)}</td></tr>`;
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
  renderDashboardPendingList();
  renderMobileSummary();
}

function renderDashboardPendingList() {
  if (!state.cuenta || !$("#dashboard-pending-body")) return;
  const today = dateOnly(new Date()).getTime();
  const pending = (state.cuenta.movimientos || [])
    .filter((movement) => !movement.paymentId)
    .filter((movement) => !["IMPUTADO", "ANULADO"].includes(String(movement.estado || "").toUpperCase()))
    .map((movement) => ({ ...movement, pendienteFirmado: signedPendingAmount(movement), dueDate: parseFlexibleDate(movement.vencimiento) }))
    .filter((movement) => movement.dueDate && dateOnly(movement.dueDate).getTime() < today)
    .filter((movement) => Math.abs(movement.pendienteFirmado) > 0.01)
    .sort((a, b) => {
      const dateA = a.dueDate?.getTime() || Number.MAX_SAFE_INTEGER;
      const dateB = b.dueDate?.getTime() || Number.MAX_SAFE_INTEGER;
      return dateA - dateB || Math.abs(b.pendienteFirmado) - Math.abs(a.pendienteFirmado);
    });
  const positive = pending
    .filter((movement) => movement.pendienteFirmado > 0)
    .reduce((sum, movement) => sum + movement.pendienteFirmado, 0);
  const negative = pending
    .filter((movement) => movement.pendienteFirmado < 0)
    .reduce((sum, movement) => sum + movement.pendienteFirmado, 0);
  const net = positive + negative;
  $("#dashboard-pending-count").textContent = `${pending.length} vencido/s`;
  $("#dashboard-pending-positive").textContent = moneyValue(positive);
  $("#dashboard-pending-positive").className = amountClass(positive);
  $("#dashboard-pending-negative").textContent = moneyValue(negative);
  $("#dashboard-pending-negative").className = amountClass(negative);
  $("#dashboard-pending-net").textContent = moneyValue(net);
  $("#dashboard-pending-net").className = amountClass(net);
  $("#dashboard-pending-body").innerHTML = pending.length
    ? pending.map((movement) => `
        <tr class="${isCashMovement(movement) ? "movement-cash" : ""}">
          <td>${escapeHtml(movement.vencimiento || "-")}</td>
          <td>${escapeHtml(movement.cliente || "-")}</td>
          <td>${escapeHtml(currentAccountDueDetailText(movement))}</td>
          <td>${escapeHtml(movement.comprobante || "-")}</td>
          <td class="${amountClass(movement.pendienteFirmado)}">${moneyValue(movement.pendienteFirmado)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="5">Sin pendientes vencidos.</td></tr>`;
}

function signedPendingAmount(movement) {
  return Math.sign(Number(movement.importe || 0)) * Number(movement.importePendiente ?? Math.abs(Number(movement.importe || 0)));
}

function mobileMovementCard(movement, showDate = false) {
  const amount = signedPendingAmount(movement);
  return `
    <article class="mobile-list-item ${isCashMovement(movement) ? "movement-cash" : ""}">
      <div>
        <strong>${escapeHtml(movement.cliente || "-")}</strong>
        <span>${escapeHtml(currentAccountDueDetailText(movement))}</span>
        ${showDate ? `<small>Vto. ${escapeHtml(movement.vencimiento || "-")}</small>` : ""}
      </div>
      <b class="${amountClass(amount)}">${moneyValue(amount)}</b>
    </article>`;
}

function renderMobileSummary() {
  if (!state.cuenta || !$("#mobile-due-today-list")) return;
  const pending = (state.cuenta.movimientos || [])
    .filter((movement) => !movement.paymentId && !["IMPUTADO", "ANULADO"].includes(String(movement.estado || "").toUpperCase()));
  const due = (state.cuenta.vencimientos || [])
    .filter((movement) => !["IMPUTADO", "ANULADO"].includes(String(movement.estado || "").toUpperCase()))
    .map((movement) => ({ ...movement, days: dayDiffFromToday(movement.vencimiento) }))
    .filter((movement) => movement.days !== null)
    .sort((a, b) => a.days - b.days || String(a.cliente || "").localeCompare(String(b.cliente || ""), "es"));
  const today = due.filter((movement) => movement.days === 0);
  const week = due.filter((movement) => movement.days >= 0 && movement.days <= 7);
  const todayTotal = today.reduce((sum, movement) => sum + signedPendingAmount(movement), 0);
  const weekTotal = week.reduce((sum, movement) => sum + signedPendingAmount(movement), 0);

  const balances = new Map();
  const commissions = new Map();
  pending.forEach((movement) => {
    balances.set(movement.cliente, (balances.get(movement.cliente) || 0) + signedPendingAmount(movement));
    if (String(movement.origen || "").toUpperCase() === "COMISION") {
      commissions.set(movement.cliente, (commissions.get(movement.cliente) || 0) + signedPendingAmount(movement));
    }
  });
  const balanceRows = [...balances.entries()]
    .map(([cliente, saldo]) => ({ cliente, saldo }))
    .filter((item) => Math.abs(item.saldo) > 0.01)
    .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo))
    .slice(0, 8);
  const commissionRows = [...commissions.entries()]
    .map(([cliente, saldo]) => ({ cliente, saldo }))
    .filter((item) => Math.abs(item.saldo) > 0.01)
    .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo))
    .slice(0, 8);
  const commissionTotal = [...commissions.values()].reduce((sum, amount) => sum + Number(amount || 0), 0);

  $("#mobile-due-today-total").textContent = moneyValue(todayTotal);
  $("#mobile-due-today-total").className = amountClass(todayTotal);
  $("#mobile-due-today-count").textContent = `${today.length} vencimiento${today.length === 1 ? "" : "s"}`;
  $("#mobile-due-week-total").textContent = moneyValue(weekTotal);
  $("#mobile-due-week-total").className = amountClass(weekTotal);
  $("#mobile-due-week-count").textContent = `${week.length} vencimiento${week.length === 1 ? "" : "s"}`;
  $("#mobile-commission-total").textContent = moneyValue(commissionTotal);
  $("#mobile-commission-total").className = amountClass(commissionTotal);
  $("#mobile-today-label").textContent = new Date().toLocaleDateString("es-AR");
  $("#mobile-week-label").textContent = "Proximos 7 dias";
  $("#mobile-due-today-list").innerHTML = today.length
    ? today.slice(0, 8).map((movement) => mobileMovementCard(movement)).join("")
    : `<p class="empty-mobile">Sin vencimientos para hoy.</p>`;
  $("#mobile-due-week-list").innerHTML = week.length
    ? week.slice(0, 10).map((movement) => mobileMovementCard(movement, true)).join("")
    : `<p class="empty-mobile">Sin vencimientos esta semana.</p>`;
  $("#mobile-balance-list").innerHTML = balanceRows.length
    ? balanceRows.map((item) => `<article class="mobile-list-item"><div><strong>${escapeHtml(item.cliente)}</strong><span>Saldo pendiente</span></div><b class="${amountClass(item.saldo)}">${moneyValue(item.saldo)}</b></article>`).join("")
    : `<p class="empty-mobile">Sin saldos pendientes.</p>`;
  $("#mobile-commission-list").innerHTML = commissionRows.length
    ? commissionRows.map((item) => `<article class="mobile-list-item"><div><strong>${escapeHtml(item.cliente)}</strong><span>Comision pendiente</span></div><b class="${amountClass(item.saldo)}">${moneyValue(item.saldo)}</b></article>`).join("")
    : `<p class="empty-mobile">Sin comisiones pendientes.</p>`;
}

function isCashMovement(movement) {
  const detail = commissionistDetailFromObservation(movement?.observacion);
  const detailHasCash = Array.isArray(detail?.items) && detail.items.some(isCashDetailRow);
  return detailHasCash || normalizeSearch(`${movement?.concepto || ""} ${movement?.comprobante || ""} ${movement?.origen || ""}`).includes("efectivo");
}

function movementDueKind(movement) {
  if (isCashMovement(movement)) return "Efectivo";
  if (String(movement?.origen || "").toUpperCase() === "FACTURACION_PARCIAL") return "Facturacion parcial";
  if (String(movement?.origen || "").toUpperCase() === "COMISION") return "Comision";
  if (normalizeSearch(movement?.concepto || "").includes("mercado agroganadero")) return "Mercado";
  if (String(movement?.origen || "").toUpperCase() === "EXTERNO") return "Externo";
  return "Factura / liquidacion";
}

function operationBusinessText(movement) {
  const pieces = [];
  const type = [movement?.tipoOperacion, movement?.destinoOperacion].filter(Boolean).join(" ");
  if (type) pieces.push(type);
  if (movement?.vendedor) pieces.push(`V: ${movement.vendedor}`);
  if (movement?.comprador) pieces.push(`C: ${movement.comprador}`);
  if (movement?.consignataria) pieces.push(`Consig.: ${movement.consignataria}`);
  if (!pieces.length && movement?.contraparte) pieces.push(`Por ${movement.contraparte}`);
  return pieces.join(" | ");
}

function currentAccountDueDetailText(movement) {
  const kind = movementDueKind(movement);
  const business = operationBusinessText(movement);
  const receipt = movement?.comprobante ? ` - ${movement.comprobante}` : "";
  return `${kind}${business ? ` - ${business}` : movement?.concepto ? ` - ${movement.concepto}` : ""}${receipt}`;
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
  return (state.cuenta.movimientos || []).some((movement) => movementConsigneeKey(movement) === query || movementCommissionistAccountKey(movement) === query) ? query : "";
}

function getExactCurrentAccountCommissionist(query) {
  if (!query) return "";
  return (state.cuenta.movimientos || []).some((movement) => movementCommissionistAccountKey(movement) === query) ? query : "";
}

function movementConsigneeKey(movement) {
  const isConsigneeOwnMovement = String(movement.origen || "").toUpperCase() === "CONSIGNATARIA";
  if (!movement.consignatariaCuenta && !isConsigneeOwnMovement) return "";
  return normalizeSearch(movement.consignataria || movement.cliente);
}

function isConsigneeOwnCharge(movement) {
  return String(movement?.origen || "").toUpperCase() === "CONSIGNATARIA";
}

function isConsigneeInformationalDue(movement) {
  return Boolean(movement?.consignatariaCuenta) && !isConsigneeOwnCharge(movement);
}

function isCommissionPendingMovement(movement, viewMode = "CLIENTE") {
  if (viewMode === "CONSIGNATARIA") return isConsigneeOwnCharge(movement) || Boolean(movementCommissionistAccountKey(movement));
  return String(movement?.origen || "").toUpperCase() === "COMISION";
}

function commissionKind(movement) {
  const text = normalizeSearch(`${movement?.concepto || ""} ${movement?.comprobante || ""} ${movement?.observacion || ""}`);
  return text.includes("efectivo") ? "efectivo" : "facturado";
}

function commissionSplitSummary(movements, viewMode = "CLIENTE") {
  const byClient = new Map();
  (movements || []).forEach((movement) => {
    const status = String(movement?.estado || "").toUpperCase();
    if (movement?.paymentId || status === "IMPUTADO" || status === "ANULADO") return;
    if (!isCommissionPendingMovement(movement, viewMode)) return;
    const client = movement?.cliente || "Sin cliente";
    const row = byClient.get(client) || { cliente: client, facturado: 0, efectivo: 0, total: 0 };
    const amount = pendingSignedAmount(movement);
    if (commissionKind(movement) === "efectivo") row.efectivo += amount;
    else row.facturado += amount;
    row.total += amount;
    byClient.set(client, row);
  });
  return [...byClient.values()]
    .filter((row) => Math.abs(row.total) > 0.01 || Math.abs(row.facturado) > 0.01 || Math.abs(row.efectivo) > 0.01)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.cliente.localeCompare(b.cliente));
}

function commissionSplitTotals(rows) {
  return (rows || []).reduce((totals, row) => ({
    facturado: totals.facturado + Number(row.facturado || 0),
    efectivo: totals.efectivo + Number(row.efectivo || 0),
    total: totals.total + Number(row.total || 0)
  }), { facturado: 0, efectivo: 0, total: 0 });
}

function currentAccountConceptText(movement, viewMode) {
  if (viewMode !== "CONSIGNATARIA") return movement.concepto || "-";
  if (isConsigneeOwnCharge(movement)) {
    return `Comision / diferencia pendiente de Gonzalo Espinosa${movement.contraparte ? ` - por ${movement.contraparte}` : ""}`;
  }
  if (isConsigneeInformationalDue(movement)) {
    const action = Number(movement.importe || 0) < 0 ? "La consignataria debe pagar a" : "La consignataria debe cobrar de";
    return `${action} ${movement.cliente || "-"} - ${movement.concepto || "-"}`;
  }
  return movement.concepto || "-";
}

function movementCommissionistKey(movement) {
  const directCommissionist = normalizeSearch(movement.comisionista || "");
  if (directCommissionist) return directCommissionist;
  const detail = commissionistDetailFromObservation(movement.observacion);
  const detailCommissionist = normalizeSearch(detail?.comisionista || "");
  if (detailCommissionist) return detailCommissionist;
  if (normalizeSearch(movement.concepto).includes("comisionista")) return normalizeSearch(movement.cliente);
  return "";
}

function isCommissionistClientName(name) {
  const key = normalizeSearch(name);
  if (!key) return false;
  return (state.clientes || []).some((client) => {
    const type = normalizeSearch(client.tipo);
    return normalizeSearch(client.nombre) === key && (type === "comisionista" || type === "consignataria");
  });
}

function movementCommissionistAccountKey(movement) {
  const detail = commissionistDetailFromObservation(movement.observacion);
  const detailCommissionist = normalizeSearch(detail?.comisionista || "");
  if (detailCommissionist) return detailCommissionist;
  if (normalizeSearch(movement.concepto).includes("comisionista")) return normalizeSearch(movement.cliente);
  if (movement.paymentId && isCommissionistClientName(movement.cliente)) return normalizeSearch(movement.cliente);
  return "";
}

function matchesCurrentAccountClientSearch(movement, words, exactClient = "") {
  if (exactClient) return movementAccountEntities(movement).includes(exactClient);
  if (!words.length) return true;
  const haystack = normalizeSearch(`${movement.cliente} ${movement.contraparte || ""} ${movement.consignataria || ""} ${movement.comprobante} ${movement.concepto}`);
  return words.every((word) => haystack.includes(word));
}

function matchesCurrentAccountConsigneeSearch(movement, words, exactConsignee = "") {
  const consignee = movementConsigneeKey(movement);
  const commissionistAccount = movementCommissionistAccountKey(movement);
  if (exactConsignee) return consignee === exactConsignee || commissionistAccount === exactConsignee;
  if (!words.length) return true;
  const haystack = normalizeSearch(`${movement.consignataria || ""} ${movement.cliente || ""} ${movement.contraparte || ""} ${movement.comprobante || ""} ${movement.concepto || ""}`);
  return words.every((word) => haystack.includes(word));
}

function matchesCurrentAccountCommissionistSearch(movement, words, exactCommissionist = "") {
  const commissionist = movementCommissionistAccountKey(movement);
  if (exactCommissionist) return commissionist === exactCommissionist;
  if (!words.length) return Boolean(commissionist);
  const detail = commissionistDetailFromObservation(movement.observacion);
  const haystack = normalizeSearch(`${detail?.comisionista || ""} ${movement.cliente || ""} ${movement.comprobante || ""} ${movement.concepto || ""}`);
  return words.every((word) => haystack.includes(word));
}

function commissionistDetailFromObservation(observation) {
  const text = String(observation || "").trim();
  if (!text.startsWith("COMISIONISTA_DETALLE:")) return null;
  try {
    return JSON.parse(text.slice("COMISIONISTA_DETALLE:".length));
  } catch (error) {
    return null;
  }
}

function commissionistDetailSubtotals(rows) {
  return rows.reduce((totals, row) => {
    const bucket = isCashDetailRow(row) ? "efectivo" : "facturado";
    totals[bucket].base += Number(row.base || 0);
    totals[bucket].comision += Number(row.comision || 0);
    totals[bucket].items += 1;
    return totals;
  }, {
    facturado: { base: 0, comision: 0, items: 0 },
    efectivo: { base: 0, comision: 0, items: 0 }
  });
}

function commissionistDetailSubtotalHtml(subtotals) {
  return `
    <div class="commissionist-subtotals">
      <div><span>A facturar</span><strong>${moneyValue(subtotals.facturado.comision)}</strong><small>Base ${moneyValue(subtotals.facturado.base)} - ${subtotals.facturado.items} item/s</small></div>
      <div><span>A cobrar en efectivo</span><strong>${moneyValue(subtotals.efectivo.comision)}</strong><small>Base ${moneyValue(subtotals.efectivo.base)} - ${subtotals.efectivo.items} item/s</small></div>
    </div>`;
}

function commissionistDetailHtml(detail) {
  const rows = Array.isArray(detail.items) ? detail.items : [];
  if (!rows.length) return "";
  const subtotals = commissionistDetailSubtotals(rows);
  return `
    <div class="cc-commissionist-detail">
      <strong>Detalle comisionista: ${escapeHtml(detail.comisionista || "-")} - ${escapeHtml(detail.porcentaje || "0")}%</strong>
      <span>Importe bruto ${moneyValue(detail.base)} | Comision ${moneyValue(detail.comision)}</span>
      ${commissionistDetailSubtotalHtml(subtotals)}
      <table>
        <thead><tr><th>Origen</th><th>Fecha</th><th>Operacion / mov.</th><th>Comprobante</th><th>Importe bruto</th><th>%</th><th>Comision</th></tr></thead>
        <tbody>${rows.map((row) => `<tr class="${isCashDetailRow(row) ? "movement-cash" : ""}"><td>${escapeHtml(row.origen || "-")}</td><td>${escapeHtml(row.fecha || "-")}</td><td>${escapeHtml(row.id || "-")}</td><td>${escapeHtml(row.comprobante || "-")}</td><td>${moneyValue(row.base)}</td><td>${row.porcentaje ? escapeHtml(row.porcentaje) : "-"}</td><td>${moneyValue(row.comision)}</td></tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function commissionistStatusRows(commissionistName = $("#commissionist-client")?.value || "") {
  const key = normalizeSearch(commissionistName);
  if (!key || !state.cuenta) return [];
  return (state.cuenta.movimientos || [])
    .filter((movement) => !movement.paymentId)
    .filter((movement) => normalizeSearch(movement.cliente) === key || normalizeSearch(commissionistDetailFromObservation(movement.observacion)?.comisionista) === key)
    .filter((movement) => normalizeSearch(movement.concepto).includes("comisionista") || commissionistDetailFromObservation(movement.observacion))
    .map((movement) => {
      const detail = commissionistDetailFromObservation(movement.observacion);
      const subtotals = detail ? commissionistDetailSubtotals(detail.items || []) : {
        facturado: { comision: Math.abs(Number(movement.importe || 0)), base: 0, items: 0 },
        efectivo: { comision: 0, base: 0, items: 0 }
      };
      const total = Math.abs(Number(movement.importe || 0)) || Math.abs(Number(subtotals.facturado.comision || 0) + Number(subtotals.efectivo.comision || 0));
      const pending = Number(movement.importePendiente ?? total);
      const paid = Math.max(total - Math.abs(pending), 0);
      return {
        fecha: movement.fecha || movement.vencimiento || "",
        comprobante: movement.comprobante || (detail?.periodoDesde && detail?.periodoHasta ? `${detail.periodoDesde} / ${detail.periodoHasta}` : "-"),
        facturado: Number(subtotals.facturado.comision || 0),
        efectivo: Number(subtotals.efectivo.comision || 0),
        total,
        pending: Math.abs(pending),
        paid,
        estado: movement.estado || "PENDIENTE"
      };
    })
    .sort((a, b) => (parseDisplayDate(b.fecha)?.getTime() || 0) - (parseDisplayDate(a.fecha)?.getTime() || 0));
}

function renderCommissionistStatus() {
  if (!$("#commissionist-status-body")) return;
  const rows = commissionistStatusRows();
  const totals = rows.reduce((acc, row) => {
    const pendingRatio = row.total ? row.pending / row.total : 0;
    acc.pendingFacturado += row.facturado * pendingRatio;
    acc.pendingEfectivo += row.efectivo * pendingRatio;
    acc.pending += row.pending;
    acc.paid += row.paid;
    return acc;
  }, { pendingFacturado: 0, pendingEfectivo: 0, pending: 0, paid: 0 });
  $("#commissionist-pending-invoiced").textContent = moneyValue(totals.pendingFacturado);
  $("#commissionist-pending-cash").textContent = moneyValue(totals.pendingEfectivo);
  $("#commissionist-pending-total").textContent = moneyValue(totals.pending);
  $("#commissionist-paid-total").textContent = moneyValue(totals.paid);
  $("#commissionist-status-summary").textContent = rows.length ? `${rows.length} liquidacion/es encontradas` : "Sin movimientos para ese comisionista";
  $("#commissionist-status-body").innerHTML = rows.length
    ? rows.map((row) => `<tr>
        <td>${escapeHtml(row.fecha || "-")}</td>
        <td>${escapeHtml(row.comprobante || "-")}</td>
        <td class="amount">${moneyValue(row.facturado)}</td>
        <td class="amount">${moneyValue(row.efectivo)}</td>
        <td class="amount">${moneyValue(row.total)}</td>
        <td class="amount ${row.pending > 0.01 ? "negative" : "positive"}">${moneyValue(row.pending)}</td>
        <td>${escapeHtml(row.pending > 0.01 ? row.estado : "PAGADO")}</td>
      </tr>`).join("")
    : `<tr><td colspan="7">Seleccione un comisionista para ver su estado.</td></tr>`;
}

function isCashDetailRow(row) {
  return normalizeSearch(`${row?.origen || ""} ${row?.comprobante || ""} ${row?.comprador || ""} ${row?.concepto || ""}`).includes("efectivo");
}

function canEditExternalMovement(movement) {
  const origin = String(movement?.origen || "").toUpperCase();
  const id = String(movement?.id || "");
  const isExternalId = id.startsWith("EXT-");
  const isExternalOrigin = origin === "EXTERNO" || origin === "COMISION";
  return Boolean(id) && (isExternalId || isExternalOrigin) && !movement.paymentId && !movement.operacion;
}

function externalMovementActions(movement) {
  return canEditExternalMovement(movement)
    ? `<button type="button" class="small-button" data-cc-edit-external="${escapeHtml(movement.id)}">Editar</button> <button type="button" class="small-button danger-button" data-cc-delete-external="${escapeHtml(movement.id)}">Eliminar</button>`
    : "";
}

function renderCuentaCorriente() {
  if (!state.cuenta) return;
  const query = normalizeSearch($("#cc-client-search").value);
  const viewMode = $("#cc-view-mode").value;
  const statusFilter = $("#cc-status-filter").value;
  const conceptFilter = $("#cc-concept-filter").value;
  const dueFilter = $("#cc-due-filter").value;
  const dateFrom = parseInputDate($("#cc-date-from").value);
  const dateTo = parseInputDate($("#cc-date-to").value);
  const words = query.split(" ").filter(Boolean);
  const exactClient = viewMode === "CLIENTE" ? getExactCurrentAccountClient(query) : "";
  const exactConsignee = viewMode === "CONSIGNATARIA" ? getExactCurrentAccountConsignee(query) : "";
  const exactCommissionist = viewMode === "COMISIONISTA" ? getExactCurrentAccountCommissionist(query) : "";
  const allMovements = state.cuenta.movimientos || [];
  const movements = allMovements.filter((movement) => {
    const matchesEntity = viewMode === "CONSIGNATARIA"
      ? matchesCurrentAccountConsigneeSearch(movement, words, exactConsignee)
      : viewMode === "COMISIONISTA"
        ? matchesCurrentAccountCommissionistSearch(movement, words, exactCommissionist)
        : matchesCurrentAccountClientSearch(movement, words, exactClient);
    if (!matchesEntity) return false;
    if (statusFilter !== "TODOS" && String(movement.estado || "").toUpperCase() !== statusFilter) return false;
    if (conceptFilter === "COMISION" && (!isCommissionPendingMovement(movement, viewMode) || String(movement.estado || "").toUpperCase() === "IMPUTADO")) return false;
    if (!matchesCurrentAccountDateRange(movement, dateFrom, dateTo)) return false;
    return matchesCurrentAccountDueFilter(movement, dueFilter);
  });
  const balance = viewMode === "CONSIGNATARIA"
    ? movements
      .filter((movement) => isConsigneeOwnCharge(movement) || movementCommissionistAccountKey(movement))
      .reduce((sum, movement) => sum + pendingSignedAmount(movement), 0)
    : movements.reduce((sum, movement) => sum + Number(movement.importe || 0), 0);
  const selectedClient = words.length ? $("#cc-client-search").value.trim() : (viewMode === "CONSIGNATARIA" ? "Todas las consignatarias" : viewMode === "COMISIONISTA" ? "Todos los comisionistas" : "Todos");

  $("#cc-selected-client").textContent = selectedClient || "Todos";
  const balanceLabel = document.querySelector("#cc-selected-balance")?.previousElementSibling;
  if (balanceLabel) balanceLabel.textContent = viewMode === "CONSIGNATARIA" ? "Comisiones pendientes" : "Saldo";
  $("#cc-selected-balance").textContent = moneyValue(balance);
  $("#cc-selected-balance").className = amountClass(balance);
  $("#cc-selected-count").textContent = movements.length;
  const commissionRows = commissionSplitSummary(movements, viewMode);
  const commissionTotals = commissionSplitTotals(commissionRows);
  const commissionPanel = $("#cc-commission-summary-panel");
  if (commissionPanel) commissionPanel.hidden = !commissionRows.length;
  if ($("#cc-commission-summary-count")) {
    $("#cc-commission-summary-count").textContent = commissionRows.length
      ? `${commissionRows.length} cliente/s - Total ${moneyValue(commissionTotals.total)}`
      : "Sin comisiones pendientes";
  }
  if ($("#cc-commission-summary-body")) {
    $("#cc-commission-summary-body").innerHTML = commissionRows.length
      ? commissionRows.map((row) => `
          <tr>
            <td>${escapeHtml(row.cliente)}</td>
            <td class="${amountClass(row.facturado)}">${Math.abs(row.facturado) > 0.01 ? moneyValue(row.facturado) : "-"}</td>
            <td class="${amountClass(row.efectivo)}">${Math.abs(row.efectivo) > 0.01 ? moneyValue(row.efectivo) : "-"}</td>
            <td class="${amountClass(row.total)}">${moneyValue(row.total)}</td>
          </tr>
        `).join("") + `
          <tr>
            <th>Total</th>
            <th class="${amountClass(commissionTotals.facturado)}">${moneyValue(commissionTotals.facturado)}</th>
            <th class="${amountClass(commissionTotals.efectivo)}">${moneyValue(commissionTotals.efectivo)}</th>
            <th class="${amountClass(commissionTotals.total)}">${moneyValue(commissionTotals.total)}</th>
          </tr>
        `
      : `<tr><td colspan="4">Sin comisiones pendientes para esta busqueda.</td></tr>`;
  }
  $("#cc-due-title").textContent = viewMode === "CONSIGNATARIA" ? "Vencimientos de clientes y comisiones" : "Vencimientos pendientes";
  $("#cc-due-subtitle").textContent = viewMode === "CONSIGNATARIA"
    ? "Incluye vencimientos informativos entre la consignataria y tus clientes, y comisiones pendientes a cobrar."
    : "Ordenados por fecha de vencimiento.";

  $("#cc-movements-body").innerHTML = movements.length
    ? movements.slice(0, 200).map((movement) => {
        const detail = commissionistDetailFromObservation(movement.observacion);
        const baseActions = movement.paymentId
          ? `<button type="button" class="small-button" data-cc-payment-receipt="${escapeHtml(movement.paymentId)}">Ver comprobante</button> <button type="button" class="small-button" data-cc-payment-print="${escapeHtml(movement.paymentId)}">Imprimir/PDF</button>${movement.estado === "ANULADO" ? "" : ` <button type="button" class="small-button danger-button" data-cc-payment-cancel="${escapeHtml(movement.paymentId)}">Anular</button>`}`
          : movement.operacion
            ? `<button type="button" class="small-button" data-cc-operation-report="${escapeHtml(movement.operacion)}">Ver comprobante</button>`
            : externalMovementActions(movement);
        return `
        <tr class="${isCashMovement(movement) ? "movement-cash" : ""} ${movement.estado === "ANULADO" ? "movement-cancelled" : ""}">
          <td>${escapeHtml(movement.fecha || "-")}</td>
          <td>${escapeHtml(movement.vencimiento || "-")}</td>
          <td>${escapeHtml(movement.cliente || "-")}</td>
          <td>${escapeHtml(currentAccountDueDetailText(movement))}</td>
          <td>${escapeHtml(movement.comprobante || "-")}</td>
          <td>${escapeHtml(movement.operacion || "-")}</td>
          <td class="${amountClass(movement.importe)}">${moneyValue(Math.sign(movement.importe) * Number(movement.importePendiente ?? Math.abs(movement.importe)))}</td>
          <td>${escapeHtml(movement.estado || "-")}</td>
          <td>${baseActions}${documentActionButtons(movement)}</td>
        </tr>
        ${detail ? `<tr class="cc-detail-row"><td colspan="9">${commissionistDetailHtml(detail)}</td></tr>` : ""}
      `;
      }).join("")
    : `<tr><td colspan="9">Sin movimientos para esta busqueda.</td></tr>`;

  const due = (state.cuenta.vencimientos || []).filter((movement) => {
    const matchesEntity = viewMode === "CONSIGNATARIA"
      ? matchesCurrentAccountConsigneeSearch(movement, words, exactConsignee)
      : viewMode === "COMISIONISTA"
        ? matchesCurrentAccountCommissionistSearch(movement, words, exactCommissionist)
        : matchesCurrentAccountClientSearch(movement, words, exactClient);
    if (!matchesEntity) return false;
    if (conceptFilter === "COMISION" && !isCommissionPendingMovement(movement, viewMode)) return false;
    if (!matchesCurrentAccountDateRange(movement, dateFrom, dateTo)) return false;
    return matchesCurrentAccountDueFilter(movement, dueFilter);
  });
  $("#cc-due-body").innerHTML = due.length
    ? due.slice(0, 80).map((movement) => `
        <tr class="${isCashMovement(movement) ? "movement-cash" : ""}">
          <td>${escapeHtml(movement.vencimiento || "-")}</td>
          <td>${escapeHtml(movement.cliente || "-")}</td>
          <td>${escapeHtml(currentAccountConceptText(movement, viewMode))}</td>
          <td>${escapeHtml(movement.comprobante || "-")}</td>
          <td class="${amountClass(movement.importe)}">${moneyValue(movement.importe)}</td>
          <td>${externalMovementActions(movement)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="6">Sin vencimientos pendientes para esta busqueda.</td></tr>`;
}

function parseInputDate(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function matchesCurrentAccountDateRange(movement, from, to) {
  if (!from && !to) return true;
  const date = parseDisplayDate(movement.fecha || movement.vencimiento);
  if (!date) return false;
  date.setHours(0, 0, 0, 0);
  if (from) {
    from.setHours(0, 0, 0, 0);
    if (date < from) return false;
  }
  if (to) {
    to.setHours(0, 0, 0, 0);
    if (date > to) return false;
  }
  return true;
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

function populateCommissionistClients() {
  const commissionistTypes = new Set(["comisionista", "consignataria"]);
  const usedAsCommissionist = (state.cuenta?.movimientos || [])
    .map((movement) => movement.comisionista)
    .filter(Boolean);
  const names = Array.from(new Set([
    ...state.clientes
      .filter((client) => commissionistTypes.has(normalizeSearch(client.tipo)))
      .map((client) => client.nombre),
    ...usedAsCommissionist
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
  $("#commissionist-client-list").innerHTML = names
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
    state.editingExternalMovementId = "";
    $("#cc-external-title").textContent = "Movimiento externo";
    $("#cc-save-external").textContent = "Guardar movimiento externo";
    $("#cc-external-message").textContent = "";
    $("#cc-external-message").className = "form-message";
    $("#cc-external-client").value = $("#cc-client-search").value;
    $("#cc-external-direction").value = "PAGAR";
    $("#cc-external-concept").value = "Venta MAG";
    $("#cc-external-receipt").value = "";
    $("#cc-external-date").value = today;
    $("#cc-external-due").value = today;
    setMoneyInput("#cc-external-amount", 0);
    setMoneyInput("#cc-external-mag-net", 0);
    setMoneyInput("#cc-external-mag-iva", 0);
    $("#cc-external-multiple-due").checked = false;
    $("#cc-external-due-panel").hidden = true;
    $("#cc-external-due-date").value = today;
    setMoneyInput("#cc-external-due-amount", 0);
    state.externalDueRows = [];
    $("#cc-external-commissionist").value = "";
    setMoneyInput("#cc-external-commission-base", 0);
    $("#cc-external-commission-percent").value = "";
    setMoneyInput("#cc-external-commission-amount", 0);
    syncExternalConceptFields();
    renderExternalDueRows();
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

function externalMovementBaseId(id) {
  return String(id || "").replace(/-(NETO(?:-\d+)?|IVA|VTO-\d+)$/i, "");
}

function isExternalMagSale() {
  return normalizeSearch($("#cc-external-concept").value) === "venta mag";
}

function syncExternalConceptFields() {
  const isMag = isExternalMagSale();
  $("#cc-external-mag-panel").hidden = !isMag;
  $("#cc-external-amount-wrap").hidden = isMag;
  $("#cc-external-multiple-due").closest(".cc-subpanel").hidden = isMag;
  if (isMag) {
    $("#cc-external-multiple-due").checked = false;
    $("#cc-external-due-panel").hidden = true;
    state.externalDueRows = [];
  }
  renderExternalDueRows();
}

function externalDueTargetAmount() {
  if (isExternalMagSale()) {
    return Math.max(numberValue("#cc-external-mag-net") - numberValue("#cc-external-mag-iva"), 0);
  }
  return numberValue("#cc-external-amount");
}

function toggleExternalDuePanel() {
  const enabled = $("#cc-external-multiple-due").checked;
  $("#cc-external-due-panel").hidden = !enabled;
  renderExternalDueRows();
}

function renderExternalDueRows() {
  const body = $("#cc-external-due-body");
  if (!body) return;
  const total = state.externalDueRows.reduce((sum, item) => sum + Number(item.importe || 0), 0);
  const target = externalDueTargetAmount();
  $("#cc-external-due-summary").textContent = state.externalDueRows.length
    ? `${state.externalDueRows.length} vencimiento/s - total ${moneyValue(total)}${target ? ` / esperado ${moneyValue(target)}` : ""}`
    : `Sin vencimientos cargados${target ? ` - esperado ${moneyValue(target)}` : ""}`;
  body.innerHTML = state.externalDueRows.length
    ? state.externalDueRows.map((item) => `<tr><td>${escapeHtml(formatDate(item.vencimiento))}</td><td>${moneyValue(item.importe)}</td><td><button type="button" class="small-button danger-button" data-cc-remove-external-due="${escapeHtml(item.id)}">Quitar</button></td></tr>`).join("")
    : `<tr><td colspan="3">Sin vencimientos cargados.</td></tr>`;
}

function addExternalDueRow() {
  const vencimiento = $("#cc-external-due-date").value || $("#cc-external-due").value;
  const importe = numberValue("#cc-external-due-amount");
  if (!vencimiento || importe <= 0) {
    $("#cc-external-message").textContent = "Para agregar un vencimiento cargá fecha e importe mayor a cero.";
    $("#cc-external-message").className = "form-message error";
    return;
  }
  state.externalDueRows.push({
    id: `VTO-${Date.now()}-${state.externalDueRows.length}`,
    vencimiento,
    importe
  });
  $("#cc-external-message").textContent = "";
  $("#cc-external-message").className = "form-message";
  $("#cc-external-due-date").value = vencimiento;
  setMoneyInput("#cc-external-due-amount", 0);
  renderExternalDueRows();
}

function collectExternalDueRows() {
  if (!$("#cc-external-multiple-due").checked) return [];
  return state.externalDueRows.map((item) => ({
    vencimiento: item.vencimiento,
    importe: Number(item.importe || 0)
  }));
}

function validateExternalDueRows() {
  if (!$("#cc-external-multiple-due").checked) return true;
  const total = state.externalDueRows.reduce((sum, item) => sum + Number(item.importe || 0), 0);
  const target = externalDueTargetAmount();
  if (!state.externalDueRows.length) {
    $("#cc-external-message").textContent = "Marcaste varios vencimientos, pero todavia no agregaste ninguno.";
    $("#cc-external-message").className = "form-message error";
    return false;
  }
  if (Math.abs(total - target) > 0.02) {
    $("#cc-external-message").textContent = `La suma de vencimientos (${moneyValue(total)}) debe coincidir con el neto que impacta en cuenta corriente (${moneyValue(target)}).`;
    $("#cc-external-message").className = "form-message error";
    return false;
  }
  return true;
}

function syncExternalCommissionAmount() {
  const base = numberValue("#cc-external-commission-base");
  const percent = percentValue("#cc-external-commission-percent");
  const amountInput = $("#cc-external-commission-amount");
  if (document.activeElement === amountInput) return;
  if (base && percent) setMoneyInput("#cc-external-commission-amount", base * percent / 100);
}

function openExternalMovementEdit(movementId) {
  const movement = (state.cuenta?.movimientos || []).find((item) => String(item.id) === String(movementId));
  if (!movement || !canEditExternalMovement(movement)) return;
  const baseId = externalMovementBaseId(movement.id);
  const group = (state.cuenta?.movimientos || []).filter((item) => canEditExternalMovement(item) && externalMovementBaseId(item.id) === baseId);
  const netRow = group.find((item) => item.tipoDesglose === "NETO") || movement;
  const ivaRow = group.find((item) => item.tipoDesglose === "IVA_FISCAL");
  const accountRows = group.filter((item) => item.tipoDesglose !== "IVA_FISCAL");
  const isMag = group.some((item) => String(item.concepto || "").toUpperCase().includes("VENTA MAG"));
  const signSource = netRow || ivaRow || movement;
  state.editingExternalMovementId = movement.id;
  $("#cc-external-panel").hidden = false;
  $("#cc-payment-panel").hidden = true;
  $("#cc-external-title").textContent = `Editar movimiento externo ${baseId}`;
  $("#cc-save-external").textContent = "Guardar correccion";
  $("#cc-external-message").textContent = "";
  $("#cc-external-message").className = "form-message";
  $("#cc-external-client").value = signSource.cliente || "";
  $("#cc-external-direction").value = Number(signSource.importe || 0) >= 0 ? "COBRAR" : "PAGAR";
  $("#cc-external-concept").value = isMag ? "Venta MAG" : (movement.concepto || "Otros gastos");
  $("#cc-external-receipt").value = signSource.comprobante || "";
  $("#cc-external-date").value = dateToInput(signSource.fecha || "");
  $("#cc-external-due").value = dateToInput(signSource.vencimiento || "");
  const accountTotal = accountRows.reduce((sum, item) => sum + Math.abs(Number(item.importe || 0)), 0);
  setMoneyInput("#cc-external-amount", accountTotal || Math.abs(Number(movement.importe || 0)));
  setMoneyInput("#cc-external-mag-net", accountTotal + Math.abs(Number(ivaRow?.importe || 0)));
  setMoneyInput("#cc-external-mag-iva", Math.abs(Number(ivaRow?.importe || 0)));
  $("#cc-external-notes").value = signSource.observacion || "";
  const commissionRow = accountRows.find((item) => item.comisionista || Number(item.baseComision || 0) || Number(item.importeComision || 0)) || netRow;
  $("#cc-external-commissionist").value = commissionRow?.comisionista || "";
  setMoneyInput("#cc-external-commission-base", Number(commissionRow?.baseComision || 0));
  $("#cc-external-commission-percent").value = commissionRow?.porcComision || "";
  setMoneyInput("#cc-external-commission-amount", Number(commissionRow?.importeComision || 0));
  state.externalDueRows = accountRows.length > 1
    ? accountRows.map((item, index) => ({
        id: `EDIT-${index}`,
        vencimiento: dateToInput(item.vencimiento || signSource.vencimiento || ""),
        importe: Math.abs(Number(item.importe || 0))
      }))
    : [];
  $("#cc-external-multiple-due").checked = accountRows.length > 1;
  $("#cc-external-due-panel").hidden = accountRows.length <= 1;
  syncExternalConceptFields();
  renderExternalDueRows();
}

function getPaymentPendingMovements(clientSelector = "#cc-payment-client", typeSelector = "#cc-payment-type") {
  const client = normalizeSearch($(clientSelector).value);
  const type = $(typeSelector).value;
  return (state.cuenta.movimientos || []).filter((movement) => {
    if (normalizeSearch(movement.cliente) !== client || String(movement.estado || "").toUpperCase() === "IMPUTADO") return false;
    const amount = Number(movement.importe || 0);
    const isCommission = String(movement.origen || "").toUpperCase() === "COMISION";
    const isExpenseDiscount = isExpenseOrDiscountMovement(movement);
    if (type === "PAGO") return amount < 0 || ((isCommission || isExpenseDiscount) && amount > 0);
    return amount > 0;
  });
}

function isExpenseOrDiscountMovement(movement) {
  const origin = String(movement?.origen || "").toUpperCase();
  const text = normalizeSearch(`${movement?.concepto || ""} ${movement?.comprobante || ""} ${movement?.observacion || ""}`);
  return origin === "EXTERNO" && (
    text.includes("gasto") ||
    text.includes("guia") ||
    text.includes("dte") ||
    text.includes("flete") ||
    text.includes("pesada") ||
    text.includes("vacunacion") ||
    text.includes("veterinario") ||
    text.includes("descuento") ||
    text.includes("retencion")
  );
}

function renderCurrentAccountCounterpartyImputations() {
  const movements = getPaymentPendingMovements("#cc-counterparty-client", "#cc-counterparty-type");
  $("#cc-counterparty-summary").textContent = movements.length ? `${movements.length} pendiente/s disponibles` : "Sin pendientes para imputar";
  $("#cc-counterparty-body").innerHTML = movements.length
    ? movements.map((movement) => {
        const pending = Number(movement.importePendiente ?? Math.abs(movement.importe));
        const signedPending = Math.sign(Number(movement.importe || 0)) * pending;
        return `<tr><td><input type="checkbox" data-cc-counterparty-impute="${escapeHtml(movement.id)}" data-cc-pending="${pending}" data-cc-signed-pending="${signedPending}"></td><td>${escapeHtml(movement.vencimiento || "-")}</td><td>${escapeHtml(movement.concepto || "-")}</td><td>${escapeHtml(movement.comprobante || "-")}</td><td>${moneyValue(pending)}</td></tr>`;
      }).join("")
    : `<tr><td colspan="5">Sin pendientes para imputar.</td></tr>`;
}

function renderCurrentAccountImputations() {
  const movements = getPaymentPendingMovements();
  $("#cc-imputation-summary").textContent = movements.length ? `${movements.length} pendiente/s disponibles` : "Sin pendientes para imputar";
  $("#cc-imputation-body").innerHTML = movements.length
    ? movements.map((movement) => {
        const pending = Number(movement.importePendiente ?? Math.abs(movement.importe));
        const signedPending = Math.sign(Number(movement.importe || 0)) * pending;
        return `<tr><td><input type="checkbox" data-cc-impute="${escapeHtml(movement.id)}" data-cc-pending="${pending}" data-cc-signed-pending="${signedPending}"></td><td>${escapeHtml(movement.vencimiento || "-")}</td><td>${escapeHtml(movement.concepto || "-")}</td><td>${escapeHtml(movement.comprobante || "-")}</td><td>${moneyValue(pending)}</td></tr>`;
      }).join("")
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
  const selected = $all("[data-cc-impute]:checked");
  const signedTotal = selected.reduce((sum, checkbox) => sum + Number(checkbox.dataset.ccSignedPending || 0), 0);
  const positiveTotal = selected
    .filter((item) => Number(item.dataset.ccSignedPending || 0) > 0)
    .reduce((sum, checkbox) => sum + Number(checkbox.dataset.ccPending || 0), 0);
  const discountOnly = $("#cc-discount-only")?.checked;
  updateCurrentAccountImputationSummary({
    selector: "[data-cc-impute]:checked",
    summarySelector: "#cc-imputation-summary",
    availableText: available ? `${available} pendiente/s disponibles` : "Sin pendientes para imputar",
    updatePaymentAmount: true
  });
  if (selected.length && selected.some((item) => Number(item.dataset.ccSignedPending || 0) < 0) && selected.some((item) => Number(item.dataset.ccSignedPending || 0) > 0)) {
    if (discountOnly) {
      $("#cc-imputation-summary").textContent = `${selected.length} seleccionado/s - descuentos a aplicar ${moneyValue(positiveTotal)}`;
      if (!currentPaymentInstruments.length) setMoneyInput("#cc-payment-amount", positiveTotal);
    } else {
      $("#cc-imputation-summary").textContent = `${selected.length} seleccionado/s - neto a registrar ${moneyValue(Math.abs(signedTotal))}`;
      if (!currentPaymentInstruments.length) setMoneyInput("#cc-payment-amount", Math.abs(signedTotal));
    }
  }
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
    const isMag = isExternalMagSale();
    if (!validateExternalDueRows()) return;
    const editingId = state.editingExternalMovementId;
    const path = editingId
      ? `/api/cuenta-corriente/movimientos-externos/${encodeURIComponent(editingId)}`
      : "/api/cuenta-corriente/movimientos-externos";
    await fetchJson(path, {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify({
        cliente: $("#cc-external-client").value,
        direccion: $("#cc-external-direction").value,
        concepto: $("#cc-external-concept").value,
        comprobante: $("#cc-external-receipt").value,
        fechaVenta: $("#cc-external-date").value,
        vencimiento: $("#cc-external-due").value,
        importe: isMag ? numberValue("#cc-external-mag-net") : numberValue("#cc-external-amount"),
        ivaFiscal: isMag ? numberValue("#cc-external-mag-iva") : 0,
        vencimientos: collectExternalDueRows(),
        comisionista: $("#cc-external-commissionist").value,
        baseComision: numberValue("#cc-external-commission-base"),
        porcComision: percentValue("#cc-external-commission-percent"),
        importeComision: numberValue("#cc-external-commission-amount"),
        observacion: $("#cc-external-notes").value
      })
    });
    state.editingExternalMovementId = "";
    $("#cc-external-panel").hidden = true;
    await reloadCurrentAccount();
  } catch (error) {
    $("#cc-external-message").textContent = error.message;
    $("#cc-external-message").className = "form-message error";
  }
}

function printCurrentAccountReceipt(payment, autoPrint = false) {
  const popup = window.open("", "_blank", "width=900,height=800");
  if (!popup) return;
  const instruments = payment.instrumentos?.length ? payment.instrumentos : [{ medio: payment.medio, fecha: payment.fecha, referencia: payment.referencia, importe: payment.importe }];
  const imputations = payment.imputaciones || [];
  const isDiscountImputation = (item) => {
    const text = normalizeSearch(`${item.concepto || ""} ${item.comprobante || ""}`);
    const originalSigned = Number(item.importeOriginalFirmado ?? item.importeFirmadoOriginal ?? 0);
    if (originalSigned) return originalSigned > 0;
    if (text.includes("comisionista")) return false;
    return text.includes("comision") ||
      text.includes("descuento") ||
      text.includes("retencion") ||
      text.includes("gasto") ||
      text.includes("guia") ||
      text.includes("dte") ||
      text.includes("flete") ||
      text.includes("pesada") ||
      text.includes("vacunacion") ||
      text.includes("veterinario");
  };
  const paidImputations = imputations.filter((item) => !isDiscountImputation(item));
  const discountImputations = imputations.filter(isDiscountImputation);
  const paidTotal = paidImputations.reduce((sum, item) => sum + Number(item.importe || 0), 0);
  const discountTotal = discountImputations.reduce((sum, item) => sum + Number(item.importe || 0), 0);
  const instrumentTotal = instruments.reduce((sum, item) => sum + Number(item.importe || 0), 0);
  const controlNet = paidTotal - discountTotal;
  const receiptTitle = safePdfTitle(payment.id, payment.tipo === "PAGO" ? "Pago" : "Cobro", payment.cliente, payment.fecha);
  const imputationRows = (rows, emptyText) => rows.length
    ? rows.map((item) => `<tr><td>${escapeHtml(item.vencimiento || "-")}</td><td>${escapeHtml(item.comprobante || "-")}</td><td>${escapeHtml(item.concepto || item.movementId)}</td><td class="amount">${moneyValue(item.importe)}</td><td class="amount">${moneyValue(item.saldoPendiente)}</td></tr>`).join("")
    : `<tr><td colspan="5">${emptyText}</td></tr>`;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(receiptTitle)}</title><style>
    body{font-family:Arial,sans-serif;margin:10mm;color:#173632} header{display:flex;align-items:center;gap:14px;border-bottom:2px solid #173632;padding-bottom:8px} img{width:76px;height:76px;object-fit:contain;background:#173632;padding:6px} h1{font-size:18px;margin:0} h2{font-size:13px;margin-top:14px} p{margin:3px 0;font-size:11px} table{width:100%;border-collapse:collapse;font-size:10px} th,td{border:1px solid #cbd7d4;padding:5px;text-align:left;vertical-align:top} th{background:#edf3f1} .amount{text-align:right;font-weight:700;white-space:nowrap}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0}.summary div{border:1px solid #cbd7d4;background:#f8fbfa;padding:6px}.summary span{display:block;color:#52706b;font-size:9px}.summary strong{font-size:12px}.discount th{background:#f8ebe5}.discount-total{background:#fff3e8;font-weight:700}.net-total{background:#eaf2ff;font-weight:700} button{margin-top:14px;padding:8px 12px}@media print{@page{size:A4 portrait;margin:9mm}button{display:none}body{margin:0}}
  </style></head><body>
  <header><img src="${window.location.origin}/logo-espinosa-blanco.png"><div><h1>${payment.tipo === "PAGO" ? "Comprobante de pago" : "Comprobante de cobro"}</h1><p><strong>${escapeHtml(payment.id)}</strong></p><p>Gonzalo Espinosa - Hacienda y Liquidaciones</p></div></header>
  ${payment.anulado ? `<p><strong>COMPROBANTE ANULADO</strong></p>` : ""}
  <p><strong>Cliente:</strong> ${escapeHtml(payment.cliente)}</p><p><strong>Fecha:</strong> ${escapeHtml(payment.fecha)}</p><p><strong>Importe:</strong> ${moneyValue(payment.importe)}</p><p><strong>Referencia:</strong> ${escapeHtml(payment.referencia || "-")}</p>
  <div class="summary">
    <div><span>${payment.tipo === "PAGO" ? "Importe pagado" : "Importe cobrado"}</span><strong>${moneyValue(instrumentTotal || payment.importe)}</strong></div>
    <div><span>Vencimientos aplicados</span><strong>${moneyValue(paidTotal)}</strong></div>
    <div><span>Descuentos / comisiones</span><strong>${moneyValue(discountTotal)}</strong></div>
    <div><span>Control neto</span><strong>${moneyValue(controlNet)}</strong></div>
  </div>
  <h2>Detalle de instrumentos</h2><table><thead><tr><th>Medio</th><th>Fecha</th><th>Referencia</th><th>Importe</th></tr></thead><tbody>${instruments.map((item) => `<tr><td>${escapeHtml(item.medio)}</td><td>${escapeHtml(item.fecha)}</td><td>${escapeHtml(item.referencia || "-")}</td><td class="amount">${moneyValue(item.importe)}</td></tr>`).join("")}</tbody></table>
  <h2>${payment.tipo === "PAGO" ? "Importes pagados / vencimientos cancelados" : "Importes cobrados / vencimientos cancelados"}</h2>
  <table><thead><tr><th>Vencimiento</th><th>Comprobante</th><th>Concepto</th><th>Importe aplicado</th><th>Saldo pendiente</th></tr></thead><tbody>${imputationRows(paidImputations, "Sin vencimientos liquidados en este comprobante.")}</tbody></table>
  <h2>Descuentos aplicados</h2>
  <table class="discount"><thead><tr><th>Vencimiento</th><th>Comprobante</th><th>Concepto</th><th>Importe descontado</th><th>Saldo pendiente</th></tr></thead><tbody>${imputationRows(discountImputations, "Sin descuentos aplicados.")}<tr class="discount-total"><td colspan="3">Total descuentos / comisiones</td><td class="amount">${moneyValue(discountTotal)}</td><td></td></tr><tr class="net-total"><td colspan="3">Neto del comprobante</td><td class="amount">${moneyValue(instrumentTotal || payment.importe)}</td><td></td></tr></tbody></table>
  <button onclick="window.print()">Imprimir / guardar PDF</button>${autoPrint ? `<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script>` : ""}</body></html>`);
  popup.document.close();
}

function getCurrentAccountReportFilters() {
  const query = normalizeSearch($("#cc-client-search").value);
  const viewMode = $("#cc-view-mode").value;
  return {
    viewMode,
    query,
    words: query.split(" ").filter(Boolean),
    exactClient: viewMode === "CLIENTE" ? getExactCurrentAccountClient(query) : "",
    exactConsignee: viewMode === "CONSIGNATARIA" ? getExactCurrentAccountConsignee(query) : "",
    exactCommissionist: viewMode === "COMISIONISTA" ? getExactCurrentAccountCommissionist(query) : "",
    statusFilter: $("#cc-status-filter").value,
    dueFilter: $("#cc-due-filter").value,
    conceptFilter: $("#cc-concept-filter").value,
    dateFrom: parseInputDate($("#cc-date-from").value),
    dateTo: parseInputDate($("#cc-date-to").value),
    dateFromText: $("#cc-date-from").value,
    dateToText: $("#cc-date-to").value
  };
}

function matchesCurrentAccountReportFilters(movement, filters, includeDueFilter = false, includeStatusFilter = false) {
  const matchesEntity = filters.viewMode === "CONSIGNATARIA"
    ? matchesCurrentAccountConsigneeSearch(movement, filters.words, filters.exactConsignee)
    : filters.viewMode === "COMISIONISTA"
      ? matchesCurrentAccountCommissionistSearch(movement, filters.words, filters.exactCommissionist)
      : matchesCurrentAccountClientSearch(movement, filters.words, filters.exactClient);
  return matchesEntity
    && (filters.conceptFilter !== "COMISION" || isCommissionPendingMovement(movement, filters.viewMode))
    && (!includeStatusFilter || filters.statusFilter === "TODOS" || String(movement.estado || "").toUpperCase() === filters.statusFilter)
    && matchesCurrentAccountDateRange(movement, filters.dateFrom, filters.dateTo)
    && (!includeDueFilter || matchesCurrentAccountDueFilter(movement, filters.dueFilter));
}

function currentAccountReportStyles() {
  return `body{font-family:Arial,sans-serif;margin:10mm;color:#173632} header{display:flex;align-items:center;gap:16px;border-bottom:2px solid #173632;padding-bottom:10px} img{width:84px;height:84px;object-fit:contain;background:#173632;padding:6px} h1{font-size:20px;margin:0} h2{font-size:14px;margin:18px 0 0} p{margin:4px 0}.summary{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.summary div{border:1px solid #cbd7d4;padding:7px 9px;min-width:150px}.summary span{display:block;color:#52706b;font-size:10px}.summary strong{font-size:14px}table{width:100%;border-collapse:collapse;font-size:8.5px;margin-top:9px;table-layout:auto}th,td{border:1px solid #cbd7d4;padding:4px 5px;text-align:left;vertical-align:top}th{background:#edf3f1}.amount{text-align:right;font-weight:700;white-space:nowrap}.negative{color:#9b1c1c}.positive{color:#0f6b43}.movement-cash td{font-style:italic}.due-date-row td{background:#dfecea;font-weight:700}.due-compact td{font-size:8.2px}.allocation-row td{background:#f8fbfa;color:#52706b;font-size:8px}.allocation-label{padding-left:16px!important}.commissionist-detail-cell{background:#f8fbfa}.commissionist-detail-box{padding:6px}.commissionist-detail-box strong{display:block;margin-bottom:3px}.commissionist-detail-box span{display:block;color:#52706b;margin-bottom:5px}.commissionist-subtotals{display:grid;grid-template-columns:repeat(2,minmax(170px,1fr));gap:6px;margin:6px 0}.commissionist-subtotals div{border:1px solid #cbd7d4;background:#fff;padding:6px}.commissionist-subtotals span{font-size:8px;text-transform:uppercase}.commissionist-subtotals strong{display:block;font-size:11px}.commissionist-subtotals small{display:block;color:#52706b}.commissionist-detail-box table{font-size:8px;margin-top:4px}.status{font-weight:700}.compact{max-width:720px}button{margin-top:18px;padding:9px 14px}@media print{@page{size:A4 landscape;margin:7mm}body{margin:0}button{display:none}}`;
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

function commissionistDetailReportRow(detail) {
  const rows = Array.isArray(detail?.items) ? detail.items : [];
  if (!rows.length) return "";
  const subtotals = commissionistDetailSubtotals(rows);
  return `<tr>
    <td colspan="10" class="commissionist-detail-cell">
      <div class="commissionist-detail-box">
        <strong>Detalle de ventas aplicadas - ${escapeHtml(detail.comisionista || "-")}</strong>
        <span>Importe bruto ${moneyValue(detail.base)} | Comision ${moneyValue(detail.comision)} | Periodo ${escapeHtml(detail.periodoDesde || "-")} a ${escapeHtml(detail.periodoHasta || "-")}</span>
        ${commissionistDetailSubtotalHtml(subtotals)}
        <table>
          <thead><tr><th>Origen</th><th>Fecha</th><th>Operacion / mov.</th><th>Vendedor / cliente</th><th>Comprador / concepto</th><th>Comprobante</th><th>Importe bruto</th><th>%</th><th>Comision</th></tr></thead>
          <tbody>${rows.map((row) => `<tr class="${isCashDetailRow(row) ? "movement-cash" : ""}"><td>${escapeHtml(row.origen || "-")}</td><td>${escapeHtml(row.fecha || "-")}</td><td>${escapeHtml(row.id || "-")}</td><td>${escapeHtml(row.vendedor || "-")}</td><td>${escapeHtml(row.comprador || "-")}</td><td>${escapeHtml(row.comprobante || "-")}</td><td class="amount">${moneyValue(row.base)}</td><td>${row.porcentaje ? escapeHtml(row.porcentaje) : "-"}</td><td class="amount">${moneyValue(row.comision)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </td>
  </tr>`;
}

function currentAccountReportMovementRows(rows, imputationsByMovement, viewMode = "CLIENTE") {
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
    const cashClass = isCashMovement(movement) ? "movement-cash" : "";
    return `<tr class="${cashClass}">
      <td>${escapeHtml(movement.fecha || "-")}</td>
      <td>${escapeHtml(movement.vencimiento || "-")}</td>
      <td>${escapeHtml(movement.cliente || "-")}</td>
      <td>${escapeHtml(currentAccountConceptText(movement, viewMode))}</td>
      <td>${escapeHtml(movement.comprobante || "-")}</td>
      <td>${escapeHtml(movement.operacion || "-")}</td>
      <td class="amount ${original < 0 ? "negative" : "positive"}">${moneyValue(original)}</td>
      <td class="amount">${imputed === null ? "-" : moneyValue(imputed)}</td>
      <td class="amount ${pending !== null && pending < 0 ? "negative" : "positive"}">${pending === null ? "-" : moneyValue(pending)}</td>
      <td class="status">${escapeHtml(movement.estado || "-")}</td>
    </tr>${commissionistDetailReportRow(commissionistDetailFromObservation(movement.observacion))}${allocationRows}`;
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
  const pendingBalance = rows.filter((movement) => !movement.paymentId)
    .reduce((sum, movement) => sum + Math.sign(movement.importe) * Number(movement.importePendiente ?? Math.abs(movement.importe)), 0);
  const accountBalance = filters.viewMode === "CONSIGNATARIA"
    ? rows
      .filter((movement) => isConsigneeOwnCharge(movement) || movementCommissionistAccountKey(movement))
      .reduce((sum, movement) => sum + pendingSignedAmount(movement), 0)
    : pendingBalance;
  const applied = rows.filter((movement) => !movement.paymentId)
    .reduce((sum, movement) => sum + Number(movement.importeImputado || 0), 0);
  const imputationsByMovement = currentAccountImputationsByMovement();
  const balances = new Map();
  rows.forEach((movement) => {
    if (!movement.paymentId) {
      balances.set(movement.cliente, (balances.get(movement.cliente) || 0) + pendingSignedAmount(movement));
    }
  });
  const commissionRows = commissionSplitSummary(rows, filters.viewMode);
  const commissionTotals = commissionSplitTotals(commissionRows);
  const commissionByClient = new Map(commissionRows.map((row) => [row.cliente, row]));
  const commissionTotal = commissionTotals.total;
  const balanceRows = [...balances.entries()]
    .map(([cliente, saldo]) => {
      const commission = commissionByClient.get(cliente) || { facturado: 0, efectivo: 0, total: 0 };
      return { cliente, saldo, ...commission };
    })
    .filter((item) => Math.abs(item.saldo) > 0.01 || Math.abs(item.total) > 0.01)
    .sort((a, b) => Math.abs(b.total || 0) - Math.abs(a.total || 0) || Math.abs(b.saldo) - Math.abs(a.saldo));
  const balancesTable = type === "SALDOS" ? `<h2>Saldo por cliente</h2><table class="compact"><thead><tr><th>Cliente</th><th>Saldo</th><th>Comision s/facturado</th><th>Comision s/efectivo</th><th>Total comision</th></tr></thead><tbody>${balanceRows.length ? balanceRows.map((item) => `<tr><td>${escapeHtml(item.cliente)}</td><td class="amount ${item.saldo < 0 ? "negative" : "positive"}">${moneyValue(item.saldo)}</td><td class="amount ${item.facturado < 0 ? "negative" : "positive"}">${Math.abs(item.facturado) > 0.01 ? moneyValue(item.facturado) : "-"}</td><td class="amount ${item.efectivo < 0 ? "negative" : "positive"}">${Math.abs(item.efectivo) > 0.01 ? moneyValue(item.efectivo) : "-"}</td><td class="amount ${item.total < 0 ? "negative" : "positive"}">${Math.abs(item.total) > 0.01 ? moneyValue(item.total) : "-"}</td></tr>`).join("") : `<tr><td colspan="5">Sin saldos para los filtros aplicados.</td></tr>`}</tbody></table>` : "";
  const commissionsTable = commissionRows.length ? `<h2>Comisiones pendientes</h2><table class="compact"><thead><tr><th>Cliente / productor</th><th>Sobre facturado</th><th>Sobre efectivo</th><th>Total pendiente</th></tr></thead><tbody>${commissionRows.map((item) => `<tr><td>${escapeHtml(item.cliente)}</td><td class="amount ${item.facturado < 0 ? "negative" : "positive"}">${Math.abs(item.facturado) > 0.01 ? moneyValue(item.facturado) : "-"}</td><td class="amount ${item.efectivo < 0 ? "negative" : "positive"}">${Math.abs(item.efectivo) > 0.01 ? moneyValue(item.efectivo) : "-"}</td><td class="amount ${item.total < 0 ? "negative" : "positive"}">${moneyValue(item.total)}</td></tr>`).join("")}<tr><th>Total comisiones</th><th class="amount ${commissionTotals.facturado < 0 ? "negative" : "positive"}">${moneyValue(commissionTotals.facturado)}</th><th class="amount ${commissionTotals.efectivo < 0 ? "negative" : "positive"}">${moneyValue(commissionTotals.efectivo)}</th><th class="amount ${commissionTotal < 0 ? "negative" : "positive"}">${moneyValue(commissionTotal)}</th></tr></tbody></table>` : "";

  const filterLabel = $("#cc-client-search").value.trim() || (filters.viewMode === "COMISIONISTA" ? "Todos los comisionistas" : filters.viewMode === "CONSIGNATARIA" ? "Todas las consignatarias" : "Todos los clientes");
  const periodLabel = `${filters.dateFrom ? formatDisplayDate(filters.dateFrom) : "inicio"} a ${filters.dateTo ? formatDisplayDate(filters.dateTo) : "fin"}`;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${currentAccountReportStyles()}</style></head><body>
  <header><img src="${window.location.origin}/logo-espinosa-blanco.png"><div><h1>${escapeHtml(title)}</h1><p>Gonzalo Espinosa - Hacienda y Liquidaciones</p><p>Emitido: ${escapeHtml(new Date().toLocaleDateString("es-AR"))}</p></div></header>
  <div class="summary"><div><span>Filtro</span><strong>${escapeHtml(filterLabel)}</strong></div><div><span>Periodo</span><strong>${escapeHtml(periodLabel)}</strong></div><div><span>${filters.viewMode === "CONSIGNATARIA" ? "Comisiones pendientes" : "Saldo pendiente real"}</span><strong>${moneyValue(accountBalance)}</strong></div><div><span>Total imputado</span><strong>${moneyValue(applied)}</strong></div><div><span>${filters.viewMode === "CONSIGNATARIA" ? "Vencimientos informativos" : "Saldo pendiente"}</span><strong>${moneyValue(pendingBalance)}</strong></div><div><span>Comisiones pendientes</span><strong>${moneyValue(commissionTotal)}</strong></div></div>
  ${balancesTable}
  ${commissionsTable}
  <h2>Detalle de movimientos e imputaciones</h2>
  <table><thead><tr><th>Fecha</th><th>Vencimiento</th><th>Cliente</th><th>Concepto</th><th>Comprobante</th><th>Operacion</th><th>Importe original</th><th>Imputado</th><th>Saldo pendiente</th><th>Estado</th></tr></thead><tbody>${currentAccountReportMovementRows(rows, imputationsByMovement, filters.viewMode)}</tbody></table><button onclick="window.print()">Imprimir / guardar PDF</button></body></html>`);
  popup.document.close();
}

function dueDateInRange(movement, from, to) {
  if (!from && !to) return true;
  const date = parseDisplayDate(movement.vencimiento);
  if (!date) return false;
  const due = dateOnly(date);
  if (from && due < dateOnly(from)) return false;
  if (to && due > dateOnly(to)) return false;
  return true;
}

function dueReportQuickRange(mode) {
  const today = dateOnly(new Date());
  if (mode === "NEXT_7") {
    const to = addDateDays(today, 7);
    return {
      dateFrom: today,
      dateTo: to,
      label: `Proximos 7 dias (${formatDisplayDate(today)} a ${formatDisplayDate(to)})`
    };
  }
  if (mode === "NEXT_WEEK") {
    const day = today.getDay();
    const daysToNextMonday = day === 0 ? 1 : 8 - day;
    const from = addDateDays(today, daysToNextMonday);
    const to = addDateDays(from, 6);
    return {
      dateFrom: from,
      dateTo: to,
      label: `Semana proxima (${formatDisplayDate(from)} a ${formatDisplayDate(to)})`
    };
  }
  return {};
}

function printCurrentAccountDueReport(options = {}) {
  const currentFilters = getCurrentAccountReportFilters();
  const filters = options.all
    ? {
        ...currentFilters,
        viewMode: "CLIENTE",
        query: "",
        words: [],
        exactClient: "",
        exactConsignee: "",
        exactCommissionist: "",
        statusFilter: "TODOS",
        conceptFilter: "TODOS"
      }
    : currentFilters;
  const quickRange = dueReportQuickRange(options.range);
  const hasForcedRange = Boolean(quickRange.dateFrom || quickRange.dateTo);
  const effectiveFilters = {
    ...filters,
    dateFrom: quickRange.dateFrom || filters.dateFrom,
    dateTo: quickRange.dateTo || filters.dateTo,
    dueFilter: hasForcedRange ? "TODOS" : filters.dueFilter === "TODOS" && !filters.dateFrom && !filters.dateTo ? "7" : filters.dueFilter
  };
  const baseFilters = { ...effectiveFilters, dateFrom: null, dateTo: null };
  const rows = (state.cuenta.movimientos || [])
    .filter((movement) => movement.estado !== "ANULADO")
    .filter((movement) => !movement.paymentId && movement.estado !== "IMPUTADO")
    .filter((movement) => matchesCurrentAccountReportFilters(movement, baseFilters, true, filters.statusFilter !== "TODOS"))
    .filter((movement) => dueDateInRange(movement, effectiveFilters.dateFrom, effectiveFilters.dateTo))
    .sort((a, b) => {
      const dateA = parseDisplayDate(a.vencimiento)?.getTime() || 0;
      const dateB = parseDisplayDate(b.vencimiento)?.getTime() || 0;
      return dateA - dateB || String(a.cliente || "").localeCompare(String(b.cliente || ""), "es");
    });
  const groups = new Map();
  rows.forEach((movement) => {
    const key = [
      movement.vencimiento || "",
      movement.operacion || movement.id || "",
      movement.cliente || "",
      movement.comprobante || "",
      movement.concepto || ""
    ].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        vencimiento: movement.vencimiento || "",
        cliente: movement.cliente || "",
        vendedor: movement.vendedor || "",
        comprador: movement.comprador || "",
        consignataria: movement.consignataria || "",
        concepto: currentAccountDueDetailText(movement),
        comprobante: movement.comprobante || "",
        operacion: movement.operacion || "",
        factura: 0,
        efectivo: 0,
        comision: 0
      });
    }
    const item = groups.get(key);
    const amount = signedPendingAmount(movement);
    if (isCashMovement(movement)) item.efectivo += amount;
    else if (String(movement.origen || "").toUpperCase() === "COMISION") item.comision += amount;
    else item.factura += amount;
  });
  const dueRows = Array.from(groups.values());
  const totals = dueRows.reduce((acc, row) => {
    acc.factura += Number(row.factura || 0);
    acc.efectivo += Number(row.efectivo || 0);
    acc.comision += Number(row.comision || 0);
    return acc;
  }, { factura: 0, efectivo: 0, comision: 0 });
  const filterLabel = options.all ? "Todos" : $("#cc-client-search").value.trim() || "Todos";
  const periodLabel = filters.dateFrom || filters.dateTo
    ? `${filters.dateFrom ? formatDisplayDate(filters.dateFrom) : "inicio"} a ${filters.dateTo ? formatDisplayDate(filters.dateTo) : "fin"}`
    : effectiveFilters.dueFilter === "7" ? "Proximos 7 dias" : $("#cc-due-filter option:checked").textContent;
  const finalPeriodLabel = quickRange.label || periodLabel;
  const rowsByDate = new Map();
  dueRows.forEach((row) => {
    const key = row.vencimiento || "Sin fecha";
    if (!rowsByDate.has(key)) rowsByDate.set(key, []);
    rowsByDate.get(key).push(row);
  });
  const dueRowsHtml = rowsByDate.size
    ? Array.from(rowsByDate.entries()).map(([date, dateRows]) => {
        const dateTotals = dateRows.reduce((acc, row) => {
          acc.factura += Number(row.factura || 0);
          acc.efectivo += Number(row.efectivo || 0);
          acc.comision += Number(row.comision || 0);
          return acc;
        }, { factura: 0, efectivo: 0, comision: 0 });
        const dateTotal = dateTotals.factura + dateTotals.efectivo + dateTotals.comision;
        return `<tr class="due-date-row"><td colspan="8">${escapeHtml(date)} - Total del dia ${moneyValue(dateTotal)}${dateTotals.efectivo ? ` | efectivo ${moneyValue(dateTotals.efectivo)}` : ""}</td></tr>${dateRows.map((row) => {
          const business = [row.operacion, row.concepto].filter(Boolean).join(" - ");
          const counterpart = [row.vendedor, row.comprador, row.consignataria].filter(Boolean).join(" / ");
          const rowClass = row.efectivo ? "movement-cash due-compact" : "due-compact";
          return `<tr class="${rowClass}"><td>${escapeHtml(row.vencimiento || "-")}</td><td>${escapeHtml(row.cliente || "-")}</td><td>${escapeHtml(business || "-")}</td><td>${escapeHtml(counterpart || "-")}</td><td>${escapeHtml(row.comprobante || "-")}</td><td class="amount ${row.factura < 0 ? "negative" : "positive"}">${row.factura ? moneyValue(row.factura) : "-"}</td><td class="amount ${row.efectivo < 0 ? "negative" : "positive"}">${row.efectivo ? moneyValue(row.efectivo) : "-"}</td><td class="amount ${row.comision < 0 ? "negative" : "positive"}">${row.comision ? moneyValue(row.comision) : "-"}</td></tr>`;
        }).join("")}`;
      }).join("")
    : `<tr><td colspan="8">Sin vencimientos para el periodo.</td></tr>`;
  const popup = window.open("", "_blank", "width=1100,height=850");
  if (!popup) return;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(safePdfTitle("Vencimientos", finalPeriodLabel))}</title><style>${currentAccountReportStyles()}</style></head><body>
  <header><img src="${window.location.origin}/logo-espinosa-blanco.png"><div><h1>Reporte de vencimientos</h1><p>Gonzalo Espinosa - Hacienda y Liquidaciones</p><p>Emitido: ${escapeHtml(new Date().toLocaleDateString("es-AR"))}</p></div></header>
  <div class="summary"><div><span>Periodo</span><strong>${escapeHtml(finalPeriodLabel)}</strong></div><div><span>Filtro</span><strong>${escapeHtml(filterLabel)}</strong></div><div><span>Total factura</span><strong>${moneyValue(totals.factura)}</strong></div><div><span>Total efectivo</span><strong>${moneyValue(totals.efectivo)}</strong></div><div><span>Total comisiones</span><strong>${moneyValue(totals.comision)}</strong></div></div>
  <h2>Detalle semanal</h2>
  <table><thead><tr><th>Vto.</th><th>Cliente</th><th>Operacion / negocio</th><th>Partes / consignataria</th><th>Comprobante</th><th>Factura</th><th>Efectivo</th><th>Comision</th></tr></thead><tbody>${dueRowsHtml}</tbody></table>
  <button onclick="window.print()">Imprimir / guardar PDF</button></body></html>`);
  popup.document.close();
}

function calendarRangeDates() {
  const mode = $("#cc-calendar-range").value;
  const today = dateOnly(new Date());
  if (mode === "TODAY") return { from: today, to: today, label: "hoy" };
  if (mode === "NEXT_WEEK") {
    const range = dueReportQuickRange("NEXT_WEEK");
    return { from: range.dateFrom, to: range.dateTo, label: "semana_proxima" };
  }
  if (mode === "CUSTOM") {
    const from = parseInputDate($("#cc-calendar-from").value);
    const to = parseInputDate($("#cc-calendar-to").value);
    return { from, to, label: `${$("#cc-calendar-from").value || "inicio"}_${$("#cc-calendar-to").value || "fin"}` };
  }
  return { from: today, to: addDateDays(today, 7), label: "proximos_7_dias" };
}

function currentAccountDueKind(movement) {
  if (String(movement?.origen || "").toUpperCase() === "COMISION") return "COMISION";
  if (isCashMovement(movement)) return "EFECTIVO";
  return "FACTURA";
}

function calendarKindAllowed(kind) {
  if (kind === "COMISION") return false;
  if (kind === "EFECTIVO") return $("#cc-calendar-efectivo").checked;
  return $("#cc-calendar-factura").checked;
}

function calendarStatusAllowed(movement) {
  const selected = $("#cc-calendar-status").value;
  const status = String(movement?.estado || "").toUpperCase();
  if (selected === "PENDIENTE") return status === "PENDIENTE";
  if (selected === "PARCIAL") return status === "PARCIAL";
  return !["IMPUTADO", "ANULADO"].includes(status);
}

function calendarFilteredDueMovements() {
  const range = calendarRangeDates();
  const query = normalizeSearch($("#cc-calendar-client").value);
  const filters = {
    viewMode: "CLIENTE",
    query,
    words: query.split(" ").filter(Boolean),
    exactClient: getExactCurrentAccountClient(query),
    exactConsignee: "",
    exactCommissionist: "",
    statusFilter: "TODOS",
    conceptFilter: "TODOS",
    dateFrom: null,
    dateTo: null,
    dueFilter: "TODOS"
  };
  const movements = (state.cuenta.movimientos || [])
    .filter((movement) => !movement.paymentId)
    .filter(calendarStatusAllowed)
    .filter((movement) => {
      const kind = currentAccountDueKind(movement);
      if (!calendarKindAllowed(kind)) return false;
      if (!matchesCurrentAccountReportFilters(movement, filters, false, false)) return false;
      return dueDateInRange(movement, range.from, range.to);
    })
    .sort((a, b) => {
      const dateA = parseDisplayDate(a.vencimiento)?.getTime() || 0;
      const dateB = parseDisplayDate(b.vencimiento)?.getTime() || 0;
      return dateA - dateB || String(a.cliente || "").localeCompare(String(b.cliente || ""), "es");
    });
  return { movements, range };
}

function dateToIcsDate(date) {
  const value = dateOnly(date);
  return `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, "0")}${String(value.getDate()).padStart(2, "0")}`;
}

function dateToInputValue(date) {
  const value = dateOnly(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line) {
  const text = String(line || "");
  const chunks = [];
  for (let index = 0; index < text.length; index += 72) {
    chunks.push(`${index ? " " : ""}${text.slice(index, index + 72)}`);
  }
  return chunks.join("\r\n");
}

function calendarEventSummary(movement) {
  const kind = currentAccountDueKind(movement);
  const label = kind === "COMISION" ? "COMISION" : kind === "EFECTIVO" ? "EFECTIVO" : "VTO";
  return `${label} - ${movement.cliente || "Sin cliente"} - ${moneyValue(signedPendingAmount(movement))}`;
}

function calendarEventDescription(movement) {
  return [
    `Cliente: ${movement.cliente || "-"}`,
    `Concepto: ${currentAccountDueDetailText(movement)}`,
    `Importe pendiente: ${moneyValue(signedPendingAmount(movement))}`,
    `Comprobante: ${movement.comprobante || "-"}`,
    `Operacion: ${movement.operacion || "-"}`,
    `Vendedor: ${movement.vendedor || "-"}`,
    `Comprador: ${movement.comprador || "-"}`,
    `Consignataria: ${movement.consignataria || "-"}`,
    `Estado: ${movement.estado || "-"}`
  ].join("\n");
}

function downloadTextFile(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function safePdfTitle(...parts) {
  const title = parts
    .filter(Boolean)
    .join("_")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return title || "comprobante";
}

function exportCurrentAccountCalendar() {
  if (!state.cuenta) return;
  const { movements, range } = calendarFilteredDueMovements();
  const message = $("#cc-calendar-message");
  if (!movements.length) {
    message.textContent = "No hay vencimientos para exportar con esas opciones.";
    message.className = "form-message error";
    return;
  }
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gonzalo Espinosa Hacienda//Vencimientos//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];
  movements.forEach((movement, index) => {
    const date = parseDisplayDate(movement.vencimiento);
    if (!date) return;
    const endDate = addDateDays(date, 1);
    const uid = `${movement.id || index}-${dateToIcsDate(date)}@gonzalo-espinosa-hacienda`;
    lines.push(
      "BEGIN:VEVENT",
      foldIcsLine(`UID:${escapeIcsText(uid)}`),
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dateToIcsDate(date)}`,
      `DTEND;VALUE=DATE:${dateToIcsDate(endDate)}`,
      foldIcsLine(`SUMMARY:${escapeIcsText(calendarEventSummary(movement))}`),
      foldIcsLine(`DESCRIPTION:${escapeIcsText(calendarEventDescription(movement))}`),
      foldIcsLine(`CATEGORIES:${escapeIcsText(currentAccountDueKind(movement))}`),
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  const filename = `vencimientos_${String(range.label || "calendario").replace(/[^a-zA-Z0-9_-]/g, "_")}.ics`;
  downloadTextFile(filename, `${lines.join("\r\n")}\r\n`, "text/calendar;charset=utf-8");
  message.textContent = `Archivo generado con ${movements.length} vencimiento/s. Importalo en Google Calendar.`;
  message.className = "form-message ok";
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
        imputaciones: collectSelectedCurrentAccountImputations("[data-cc-impute]:checked", amount, $("#cc-payment-type").value),
        contrapartida: $("#cc-counterparty-enabled").checked ? {
          tipo: $("#cc-counterparty-type").value,
          cliente: $("#cc-counterparty-client").value,
          imputaciones: collectSelectedCurrentAccountImputations("[data-cc-counterparty-impute]:checked", amount, $("#cc-counterparty-type").value)
        } : null
      })
    });
    $("#cc-payment-panel").hidden = true;
    await reloadCurrentAccount();
    if (printReceipt) {
      const saved = response.item || {};
      const receipt = (state.cuenta.pagos || []).find((payment) => payment.id === saved.id) || saved;
      printCurrentAccountReceipt(receipt);
    }
  } catch (error) {
    $("#cc-payment-message").textContent = error.message;
    $("#cc-payment-message").className = "form-message error";
  }
}

function commissionistDateInRange(operation, from, to) {
  const date = parseFlexibleDate(operation.fecha || operation.vencimiento);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function parseFlexibleDate(value) {
  return parseInputDate(value) || parseDisplayDate(value);
}

function commissionistOperationBase(detail) {
  const liq = detail.liquidacion || {};
  const netProd = Number(liq.netoTotalProd || liq.netoLiquidacionProd || 0);
  const netComp = Number(liq.netoTotalComp || liq.netoLiquidacionComp || 0);
  if (netProd && netComp) return Math.max(Math.abs(netProd), Math.abs(netComp));
  return Math.abs(netProd || netComp || parseMoneyInput(detail.total));
}

function operationCommissionistKey(detail) {
  const draft = detail.draftData || {};
  const liq = detail.liquidacion || {};
  return normalizeSearch(
    draft.comisionista
    || draft.comisionistaAsociado
    || draft.comisionistaNombre
    || liq.comisionista
    || liq.comisionistaAsociado
    || ""
  );
}

function operationCommissionistKeys(detail) {
  return Array.from(new Set([
    operationCommissionistKey(detail),
    normalizeSearch(detail.consignataria || detail.draftData?.consignataria || "")
  ].filter(Boolean)));
}

function liquidatedCommissionistItemIds(commissionist) {
  const key = normalizeSearch(commissionist);
  const ids = new Set();
  (state.cuenta?.movimientos || []).forEach((movement) => {
    const detail = commissionistDetailFromObservation(movement.observacion);
    if (!detail || normalizeSearch(detail.comisionista) !== key) return;
    (Array.isArray(detail.items) ? detail.items : []).forEach((item) => {
      if (item.id) ids.add(String(item.id));
    });
  });
  return ids;
}

function renderCommissionistRows() {
  const percent = percentValue("#commissionist-percent");
  const selectedRows = state.commissionistRows.filter((row) => row.selected);
  const selectedBase = selectedRows.reduce((sum, row) => sum + Number(row.base || 0), 0);
  const selectedCommission = selectedRows.reduce((sum, row) => sum + commissionistRowCommission(row, percent), 0);
  $("#commissionist-summary").textContent = selectedRows.length
    ? `${selectedRows.length} item/s - importe bruto ${moneyValue(selectedBase)} - comision ${moneyValue(selectedCommission)}`
    : state.commissionistRows.length ? "Seleccione operaciones para liquidar." : "Sin operaciones seleccionadas";
  $("#commissionist-body").innerHTML = state.commissionistRows.length
    ? state.commissionistRows.map((row) => {
        const commission = commissionistRowCommission(row, percent);
        return `<tr>
          <td><input type="checkbox" data-commissionist-row="${escapeHtml(row.id)}" ${row.selected ? "checked" : ""}></td>
          <td>${escapeHtml(row.fecha || "-")}</td>
          <td>${escapeHtml(row.origen || "-")}</td>
          <td>${escapeHtml(row.id)}</td>
          <td>${escapeHtml(row.vendedor || "-")}</td>
          <td>${escapeHtml(row.comprador || "-")}</td>
          <td>${escapeHtml(row.comprobante || "-")}</td>
          <td>${moneyValue(row.base)}</td>
          <td>${moneyValue(commission)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="9">Busque operaciones y movimientos externos por periodo.</td></tr>`;
}

function commissionistRowCommission(row, fallbackPercent) {
  if (Number(row.comisionManual || 0)) return Number(row.comisionManual || 0);
  const percent = Number(row.porcentaje || fallbackPercent || 0);
  return Number(row.base || 0) * percent / 100;
}

async function loadCommissionistOperations() {
  const from = $("#commissionist-from").value ? parseInputDate($("#commissionist-from").value) : null;
  const to = $("#commissionist-to").value ? parseInputDate($("#commissionist-to").value) : null;
  const selectedCommissionist = $("#commissionist-client").value.trim();
  if (!selectedCommissionist) {
    $("#commissionist-message").textContent = "Seleccione un comisionista.";
    $("#commissionist-message").className = "form-message error";
    return;
  }
  $("#commissionist-message").textContent = "Buscando operaciones...";
  $("#commissionist-message").className = "form-message";
  const alreadyLiquidatedIds = liquidatedCommissionistItemIds(selectedCommissionist);
  const candidates = state.operaciones
    .filter((operation) => operation.estado !== "ANULADA")
    .filter((operation) => commissionistDateInRange(operation, from, to));
  const details = await Promise.all(candidates.map((operation) => fetchJson(`/api/operaciones/${encodeURIComponent(operation.id)}`).then((response) => response.item).catch(() => null)));
  state.commissionistRows = details
    .filter(Boolean)
    .filter((detail) => detail.liquidacion)
    .filter((detail) => !alreadyLiquidatedIds.has(String(detail.id)))
    .filter((detail) => operationCommissionistKeys(detail).includes(normalizeSearch(selectedCommissionist)))
    .map((detail) => {
      const liq = detail.liquidacion || {};
      return {
        id: detail.id,
        fecha: detail.fecha,
        origen: "Operacion",
        vendedor: detail.vendedor,
        comprador: detail.comprador,
        comprobante: liq.comprobanteProd || liq.comprobanteComp || "",
        base: commissionistOperationBase(detail),
        selected: true
      };
    })
    .filter((row) => Number(row.base || 0) > 0);
  const externalRows = (state.cuenta?.movimientos || [])
    .filter((movement) => String(movement.origen || "").toUpperCase() === "EXTERNO")
    .filter((movement) => !normalizeSearch(movement.concepto).includes("comisionista"))
    .filter((movement) => String(movement.tipoDesglose || "").toUpperCase() !== "IVA_FISCAL")
    .filter((movement) => normalizeSearch(movement.comisionista) === normalizeSearch(selectedCommissionist))
    .filter((movement) => !alreadyLiquidatedIds.has(String(movement.id)))
    .filter((movement) => commissionistDateInRange({ fecha: movement.fecha || movement.vencimiento }, from, to))
    .map((movement) => ({
      id: movement.id,
      fecha: movement.fecha || movement.vencimiento,
      origen: "Movimiento externo",
      vendedor: movement.cliente,
      comprador: movement.concepto || "-",
      comprobante: movement.comprobante || "",
      base: Number(movement.baseComision || 0) || Math.abs(Number(movement.importe || 0)),
      porcentaje: Number(movement.porcComision || 0),
      comisionManual: Number(movement.importeComision || 0),
      selected: true
    }))
    .filter((row) => Number(row.base || 0) > 0);
  state.commissionistRows = [...state.commissionistRows, ...externalRows]
    .sort((a, b) => (parseDisplayDate(a.fecha)?.getTime() || 0) - (parseDisplayDate(b.fecha)?.getTime() || 0));
  renderCommissionistRows();
  $("#commissionist-message").textContent = state.commissionistRows.length
    ? "Operaciones listas para revisar. Se excluyen las ya liquidadas al comisionista."
    : "No se encontraron operaciones pendientes de liquidar en el periodo.";
  $("#commissionist-message").className = `form-message ${state.commissionistRows.length ? "ok" : ""}`.trim();
}

async function generateCommissionistMovement() {
  const client = $("#commissionist-client").value.trim();
  const percent = percentValue("#commissionist-percent");
  const selected = state.commissionistRows.filter((row) => row.selected);
  const base = selected.reduce((sum, row) => sum + Number(row.base || 0), 0);
  const amount = selected.reduce((sum, row) => sum + commissionistRowCommission(row, percent), 0);
  if (!client || !selected.length || !amount) {
    $("#commissionist-message").textContent = "Falta comisionista, operaciones seleccionadas o porcentaje.";
    $("#commissionist-message").className = "form-message error";
    return;
  }
  const fromText = $("#commissionist-from").value || "inicio";
  const toText = $("#commissionist-to").value || "fin";
  const operations = selected.map((row) => row.id).join(", ");
  const detail = {
    tipo: "COMISIONISTA",
    comisionista: client,
    periodoDesde: fromText,
    periodoHasta: toText,
    porcentaje: percent,
    base,
      comision: amount,
      items: selected.map((row) => ({
      id: row.id,
      fecha: row.fecha,
      origen: row.origen,
      vendedor: row.vendedor,
      comprador: row.comprador,
        comprobante: row.comprobante,
        base: Number(row.base || 0),
        porcentaje: Number(row.porcentaje || percent || 0),
        comision: commissionistRowCommission(row, percent)
      }))
  };
  try {
    await fetchJson("/api/cuenta-corriente/movimientos-externos", {
      method: "POST",
      body: JSON.stringify({
        cliente: client,
        direccion: "PAGAR",
        concepto: `Comisionista ${percent}% periodo ${fromText} a ${toText}`,
        comprobante: `COMISIONISTA ${fromText}/${toText}`,
        fechaVenta: new Date().toISOString().slice(0, 10),
        vencimiento: $("#commissionist-due").value || new Date().toISOString().slice(0, 10),
        importe: amount,
        observacion: `COMISIONISTA_DETALLE:${JSON.stringify(detail)}`
      })
    });
    await reloadCurrentAccount();
    renderCommissionistStatus();
    $("#commissionist-message").textContent = `Movimiento generado por ${moneyValue(amount)}.`;
    $("#commissionist-message").className = "form-message ok";
  } catch (error) {
    $("#commissionist-message").textContent = error.message;
    $("#commissionist-message").className = "form-message error";
  }
}

function collectSelectedCurrentAccountImputations(selector, availableAmount, paymentType = "") {
  const selected = $all(selector);
  const rows = selected.map((checkbox) => ({
    movementId: checkbox.dataset.ccImpute || checkbox.dataset.ccCounterpartyImpute,
    pending: Number(checkbox.dataset.ccPending || 0),
    signedPending: Number(checkbox.dataset.ccSignedPending || 0)
  })).filter((item) => item.movementId && item.pending > 0);
  const hasPositive = rows.some((item) => item.signedPending > 0);
  const hasNegative = rows.some((item) => item.signedPending < 0);
  const discountOnly = selector.includes("data-cc-impute") && paymentType === "PAGO" && $("#cc-discount-only")?.checked;
  if (hasPositive && hasNegative) {
    if (discountOnly) {
      let discountBudget = rows
        .filter((item) => item.signedPending > 0)
        .reduce((sum, item) => sum + item.pending, 0);
      const positiveRows = rows
        .filter((item) => item.signedPending > 0)
        .map((item) => ({ movementId: item.movementId, importe: item.pending }));
      const negativeRows = rows
        .filter((item) => item.signedPending < 0)
        .map((item) => {
          const importe = Math.min(item.pending, discountBudget);
          discountBudget -= importe;
          return { movementId: item.movementId, importe };
        })
        .filter((item) => item.importe > 0);
      return [...positiveRows, ...negativeRows];
    }
    return rows.map((item) => ({ movementId: item.movementId, importe: item.pending }));
  }
  let remaining = Math.abs(Number(availableAmount || 0));
  return rows.map((item) => {
    const importe = Math.min(item.pending, remaining);
    remaining -= importe;
    return { movementId: item.movementId, importe };
  }).filter((item) => item.importe > 0);
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

function populateClientMergeTargets() {
  if (!$("#client-merge-list")) return;
  $("#client-merge-list").innerHTML = state.clientes
    .filter((client) => String(client.id) !== String(state.selectedClientId))
    .map((client) => `<option value="${escapeHtml(client.nombre)}" data-client-id="${escapeHtml(client.id)}">${escapeHtml(client.cuit || client.tipo || "")}</option>`)
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

function renderWeightCalculator() {
  const gross = state.weightTickets.reduce((sum, ticket) => sum + Number(ticket.kg || 0), 0);
  const shrink = parseMoneyInput($("#calc-weight-shrink").value);
  const heads = parseMoneyInput($("#calc-weight-heads").value);
  const adjust = parseMoneyInput($("#calc-weight-adjust").value);
  const net = Math.max(gross * (1 - shrink / 100) + adjust, 0);
  const average = heads ? net / heads : 0;
  $("#calc-ticket-body").innerHTML = state.weightTickets.length
    ? state.weightTickets.map((ticket, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${plainNumberValue(ticket.kg)} kgs</td>
        <td>${escapeHtml(ticket.note || "-")}</td>
        <td><button type="button" class="small-button danger-button" data-calc-ticket-remove="${ticket.id}">Quitar</button></td>
      </tr>
    `).join("")
    : `<tr><td colspan="4">Sin tickets cargados.</td></tr>`;
  $("#calc-weight-gross-total").textContent = `${plainNumberValue(gross)} kgs`;
  $("#calc-weight-net").textContent = `${plainNumberValue(net)} kgs`;
  $("#calc-weight-average").textContent = `${plainNumberValue(average)} kgs/cab`;
}

function addWeightTicket() {
  const kg = parseMoneyInput($("#calc-ticket-kg").value);
  if (!kg) return;
  state.weightTickets.push({
    id: `T-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kg,
    note: $("#calc-ticket-note").value
  });
  $("#calc-ticket-kg").value = "";
  $("#calc-ticket-note").value = "";
  renderWeightCalculator();
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
    renderCategorySuggestions();
    setCategoryAdminMessage("Categoria actualizada correctamente.", "ok");
  } catch (error) {
    setCategoryAdminMessage(error.message, "error");
  }
}

async function deleteCategory(category) {
  try {
    const confirmed = window.confirm(`Se quitara "${category}" del listado de categorias. Las ventas ya cargadas no se modifican. ¿Continuar?`);
    if (!confirmed) return;
    await fetchJson(`/api/categorias/${encodeURIComponent(category)}`, { method: "DELETE" });
    await reloadCategories();
    renderCategorySuggestions();
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
  const totalKgBruto = lines.reduce((sum, line) => sum + Number(line.kgBruto || 0), 0);
  const totalImporte = lines.reduce((sum, line) => sum + Number(line.importeVend || 0), 0);
  const showKgTotal = isFaenaSaleOperation() || lines.length > 1;
  $("#sale-lines-summary").textContent = lines.length
    ? `${lines.length} linea${lines.length === 1 ? "" : "s"} - ${totalCabezas} cab.${showKgTotal ? ` - ${kgValue(totalKgBruto)}` : ""} - ${currency.format(totalImporte)}`
    : "Sin lineas";
  $("#sale-lines-body").innerHTML = lines.length
    ? lines.map((line) => `
        <tr>
          <td>${escapeHtml(line.categoria)}</td>
          <td>${escapeHtml(line.cabezas || 0)}</td>
          <td>${escapeHtml(line.kgNetoVend || 0)}</td>
          <td>${currency.format(Number(line.precioVend || 0))}</td>
          <td>${currency.format(Number(line.importeVend || 0))}</td>
          <td class="row-actions">
            <button type="button" class="small-button" data-edit-sale-line="${escapeHtml(line.id)}">Editar</button>
            <button type="button" class="small-button danger-button" data-delete-sale-line="${escapeHtml(line.id)}">Quitar</button>
          </td>
        </tr>
      `).join("") + (showKgTotal ? `<tr class="report-total"><td colspan="2">Total kilos</td><td>${kgValue(totalKgBruto)}</td><td colspan="3"></td></tr>` : "")
    : `<tr><td colspan="6">Sin lineas cargadas todavia.</td></tr>`;
  renderPartialBilling();
}

function operationPartialBillingLines(operation = state.currentOperation) {
  const direct = Array.isArray(operation?.facturacionParcial) ? operation.facturacionParcial : [];
  const draft = Array.isArray(operation?.draftData?.facturacionParcial) ? operation.draftData.facturacionParcial : [];
  const seen = new Set();
  return [...direct, ...draft].filter((line) => {
    const key = [
      line.fecha,
      line.planVencimientos || line.vencimiento,
      line.comprobante,
      line.parteCuenta,
      Number(line.cantidad || 0).toFixed(2),
      Number(line.importeBruto || 0).toFixed(2),
      Number(line.importeNeto || 0).toFixed(2),
      Number(line.iva || 0).toFixed(2)
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function visiblePartialBillingLines() {
  const rows = $all("#partial-body tr");
  return rows.map((row) => {
    const cells = Array.from(row.children || []);
    if (cells.length < 8 || normalizeSearch(row.textContent).includes("sin lineas")) return null;
    const line = {
      id: `visible-${cells.map((cell) => cell.textContent.trim()).join("|")}`,
      fecha: cells[0]?.textContent.trim() || "",
      planVencimientos: cells[1]?.textContent.trim() || "",
      comprobante: cells[2]?.textContent.trim() || "",
      cantidad: parseMoneyInput(cells[4]?.textContent || 0),
      importeBruto: parseMoneyInput(cells[5]?.textContent || 0),
      importeNeto: parseMoneyInput(cells[6]?.textContent || 0),
      iva: parseMoneyInput(cells[7]?.textContent || 0),
      observaciones: cells[8]?.textContent.trim() || ""
    };
    return line.fecha || line.comprobante || line.importeNeto ? line : null;
  }).filter(Boolean);
}

function reportPartialBillingLines(operation = state.currentOperation) {
  const fromOperation = operationPartialBillingLines(operation);
  const fromScreen = visiblePartialBillingLines();
  const seen = new Set();
  return [...fromOperation, ...fromScreen].filter((line) => {
    const key = [
      line.fecha,
      line.planVencimientos || line.vencimiento,
      line.comprobante,
      Number(line.cantidad || 0).toFixed(2),
      Number(line.importeBruto || 0).toFixed(2),
      Number(line.importeNeto || 0).toFixed(2),
      Number(line.iva || 0).toFixed(2)
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function partialBillingTotals(operation = state.currentOperation, partialLines = null) {
  const lines = operation?.saleLines || [];
  const partials = Array.isArray(partialLines) ? partialLines : operationPartialBillingLines(operation);
  const totalHeads = lines.reduce((sum, line) => sum + Number(line.cabezas || 0), 0);
  const totalGross = lines.reduce((sum, line) => sum + Number(line.importeVend || 0), 0);
  const billedHeads = partials.reduce((sum, line) => sum + Number(line.cantidad || 0), 0);
  const billedGross = partials.reduce((sum, line) => sum + Number(line.importeBruto || line.importeNeto || 0), 0);
  const billedNet = partials.reduce((sum, line) => sum + Number(line.importeNeto || 0), 0);
  const billedIva = partials.reduce((sum, line) => sum + Number(line.iva || 0), 0);
  return {
    totalHeads,
    totalNet: totalGross,
    totalGross,
    billedHeads,
    billedGross,
    billedNet,
    billedIva,
    pendingHeads: Math.max(totalHeads - billedHeads, 0),
    pendingNet: Math.max(totalGross - billedGross, 0),
    pendingGross: Math.max(totalGross - billedGross, 0)
  };
}

function renderPartialBilling() {
  if (!$("#partial-total-heads")) return;
  const operation = state.currentOperation || {};
  const partials = operationPartialBillingLines(operation);
  const totals = partialBillingTotals(operation);
  $("#partial-total-heads").textContent = `${plainNumberValue(totals.totalHeads)} cab.`;
  $("#partial-total-net").textContent = moneyValue(totals.totalGross);
  $("#partial-billed-net").textContent = `${moneyValue(totals.billedGross)} / neto ${moneyValue(totals.billedNet)}`;
  $("#partial-pending-net").textContent = `${moneyValue(totals.pendingNet)} / ${plainNumberValue(totals.pendingHeads)} cab.`;
  $("#partial-body").innerHTML = partials.length
    ? partials.map((line) => `
      <tr>
        <td>${escapeHtml(line.fecha || "-")}</td>
        <td>${escapeHtml(line.planVencimientos || line.vencimiento || "-")}</td>
        <td>${escapeHtml(line.comprobante || "-")}</td>
        <td>${escapeHtml(partialPartyLabel(line.parteCuenta))}</td>
        <td>${plainNumberValue(line.cantidad)}</td>
        <td>${moneyValue(line.importeBruto || line.importeNeto)}</td>
        <td>${moneyValue(line.importeNeto)}</td>
        <td>${moneyValue(line.iva)}</td>
        <td>${escapeHtml(line.observaciones || "-")}</td>
        <td><button type="button" class="small-button danger-button" data-partial-delete="${escapeHtml(line.id)}">Eliminar</button></td>
      </tr>
    `).join("")
    : `<tr><td colspan="10">Sin facturacion parcial cargada.</td></tr>`;
}

function partialPartyLabel(value) {
  const key = normalizeSearch(value || "NINGUNA");
  if (key === "ambas") return "Vendedor y comprador";
  if (key === "vendedor") return "Solo vendedor";
  if (key === "comprador") return "Solo comprador";
  return "No impacta";
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

function isFaenaReportOperation(operation = state.currentOperation) {
  const draft = operation && operation.draftData ? operation.draftData : {};
  return normalizeSearch(operation?.destino || draft.destino || "").includes("faena") || isFrigorificoIvaOperation(operation);
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
  $("#sale-use-real-kg-vend").checked = false;
  $("#sale-use-real-kg-comp").checked = false;
  $("#sale-kg-calc-vend").value = "";
  $("#sale-kg-calc-comp").value = "";
  $("#sale-prom-used-vend").value = "";
  $("#sale-prom-used-comp").value = "";
}

function syncSaleMode() {
  const faena = isFaenaSaleOperation();
  const faenaBuyerDifferent = faena && $("#sale-buyer-different-faena").checked;
  $all(".sale-not-faena").forEach((element) => { element.hidden = faena; });
  $all(".sale-faena-buyer-toggle").forEach((element) => { element.hidden = !faena; });
  $all(".sale-buyer-kg-grid").forEach((element) => { element.hidden = faena; });
  $("#sale-tipo-precio-vend").disabled = faena;
  $("#sale-tipo-precio-comp").disabled = faena;
  $("#sale-buyer-different").disabled = faena;
  if (faena) {
    syncFaenaSaleInputs();
    $("#sale-buyer-diff").hidden = !faenaBuyerDifferent;
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

function dateOnly(date = new Date()) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDateDays(date, days) {
  const result = dateOnly(date);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
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
  const syncIvaFromSeller = () => {
    setMoneyInput("#liq-iva-comp", numberValue("#liq-iva-prod"));
    state.liquidationIvaCompTouched = state.liquidationIvaProdTouched;
  };
  const syncIvaFromBuyer = () => {
    setMoneyInput("#liq-iva-prod", numberValue("#liq-iva-comp"));
    state.liquidationIvaProdTouched = state.liquidationIvaCompTouched;
  };
  $("#liq-comprobante-prod").disabled = syncFromBuyer;
  $("#liq-comprobante-comp").disabled = syncFromSeller;
  if (syncFromBuyer && (!changedParty || changedParty === "comp")) {
    $("#liq-comprobante-prod").value = $("#liq-comprobante-comp").value;
    syncIvaFromBuyer();
  }
  if (syncFromSeller && (!changedParty || changedParty === "prod")) {
    $("#liq-comprobante-comp").value = $("#liq-comprobante-prod").value;
    syncIvaFromSeller();
  }
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

function isCommissionEnabled(selector) {
  const input = $(selector);
  return Boolean(input && input.checked);
}

function commissionPercent(enabledSelector, percentSelector) {
  return isCommissionEnabled(enabledSelector) ? percentValue(percentSelector) : 0;
}

function syncCommissionToggles() {
  [
    ["#liq-comision-fact-prod-enabled", "#liq-comision-fact-prod-pct"],
    ["#liq-comision-fact-comp-enabled", "#liq-comision-fact-comp-pct"],
    ["#liq-comision-efect-prod-enabled", "#liq-comision-efect-prod-pct"],
    ["#liq-comision-efect-comp-enabled", "#liq-comision-efect-comp-pct"]
  ].forEach(([enabledSelector, percentSelector]) => {
    const percentInput = $(percentSelector);
    if (percentInput) percentInput.disabled = !isCommissionEnabled(enabledSelector);
  });
}

function calculateLiquidationPreview() {
  const facturado = numberValue("#liq-facturado");
  const ivaProd = numberValue("#liq-iva-prod");
  const ivaComp = numberValue("#liq-iva-comp");
  const frigo = isFrigorificoIvaOperation();
  const frigoCalc = frigo ? getFrigorificoCalc() : null;
  const efectivoProd = normalizeFrigorificoCashInput(numberValue("#liq-efectivo-prod"));
  const efectivoComp = frigoCalc ? frigoCalc.efectivoComp : numberValue("#liq-efectivo-comp");
  const cashExpenseProd = numberValue("#liq-cash-exp-prod");
  const expenses = getSellerExpenses();
  const buyerExpenses = getBuyerExpenses();
  const consigned = isConsignedOperation();
  const comFactProd = facturado * commissionPercent("#liq-comision-fact-prod-enabled", "#liq-comision-fact-prod-pct") / 100;
  const comFactComp = facturado * commissionPercent("#liq-comision-fact-comp-enabled", "#liq-comision-fact-comp-pct") / 100;
  const consigneeCommission = facturado * percentValue("#liq-consignee-commission-pct") / 100;
  const consigneeAdjustment = numberValue("#liq-consignee-adjustment");
  const cashWithIvaProd = efectivoProd + (frigo ? efectivoProd * 0.105 : 0);
  const comEfProd = cashWithIvaProd * commissionPercent("#liq-comision-efect-prod-enabled", "#liq-comision-efect-prod-pct") / 100;
  const comEfComp = efectivoComp * commissionPercent("#liq-comision-efect-comp-enabled", "#liq-comision-efect-comp-pct") / 100;
  const expenseBase = expenses.comision + expenses.fondoGarantia + expenses.controlEntrega + expenses.fondoCompGastos + expenses.otrosGastos;
  const netoGravadoProd = consigned ? Math.max(facturado - expenseBase, 0) : facturado;
  let netoLiquidacionProd = consigned
    ? netoGravadoProd + ivaProd - expenses.retIibb - expenses.retGanancias - expenses.ivaGastos
    : facturado + ivaProd;
  let netoLiquidacionComp = facturado + ivaComp + buyerExpenses.total;
  let netoTotalProd = netoLiquidacionProd + cashWithIvaProd - cashExpenseProd - comEfProd;
  let netoTotalComp = netoLiquidacionComp + efectivoComp;
  const settledByConsignee = $("#liq-consignee-settled-party") ? $("#liq-consignee-settled-party").value : "";
  if (consigned && settledByConsignee === "VENDEDOR") {
    netoLiquidacionComp = netoLiquidacionProd;
    netoTotalComp = netoTotalProd;
  }
  if (consigned && settledByConsignee === "COMPRADOR") {
    netoLiquidacionProd = netoLiquidacionComp;
    netoTotalProd = netoTotalComp;
  }
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
    netoTotalProd,
    netoTotalComp
  };
}

function syncLiquidationCashFromFacturado() {
  const facturado = numberValue("#liq-facturado");
  const brutoVend = numberValue("#liq-bruto-vend");
  const brutoComp = numberValue("#liq-bruto-comp");
  const frigoCalc = isFrigorificoIvaOperation() ? getFrigorificoCalc() : null;
  const brutoBaseProd = frigoCalc ? frigoCalc.brutoSinIva : brutoVend;
  setMoneyInput("#liq-efectivo-prod", Math.max(brutoBaseProd - facturado, 0));
  setMoneyInput("#liq-efectivo-comp", frigoCalc ? frigoCalc.efectivoComp : Math.max(brutoComp - facturado, 0));
}

function currentAutomaticFacturado(operation = state.currentOperation) {
  const brutoVend = sumSaleLines(operation?.saleLines || [], "importeVend");
  if (!isFrigorificoIvaOperation(operation)) return brutoVend;
  const draft = operation?.draftData || {};
  const liquidation = operation?.liquidacion || {};
  const netoFinal = Number(liquidation.netoFinalFrigorificoComp || draft.netoFinalFrigorificoComp || brutoVend || 0);
  const brutoSinIvaManual = Boolean(liquidation.brutoSinIvaFrigorificoManual || draft.brutoSinIvaFrigorificoManual);
  const brutoSinIva = brutoSinIvaManual ? Number(liquidation.brutoSinIvaFrigorificoComp || draft.brutoSinIvaFrigorificoComp || 0) : 0;
  return netoFinal ? (brutoSinIva || netoFinal / 1.105) : brutoVend;
}

function automaticLiquidationIvaValues() {
  const facturado = numberValue("#liq-facturado");
  if ($("#liq-direct-no-iva").checked) return { prod: 0, comp: 0 };
  const consigned = isConsignedOperation();
  const expenses = getSellerExpenses();
  const expenseBase = expenses.comision + expenses.fondoGarantia + expenses.controlEntrega + expenses.fondoCompGastos + expenses.otrosGastos;
  const netoGravadoProd = consigned ? Math.max(facturado - expenseBase, 0) : facturado;
  return {
    prod: netoGravadoProd * 0.105,
    comp: facturado * 0.105
  };
}

function syncAutomaticLiquidationIva() {
  const iva = automaticLiquidationIvaValues();
  if (!state.liquidationIvaProdTouched) setMoneyInput("#liq-iva-prod", iva.prod);
  if (!state.liquidationIvaCompTouched) setMoneyInput("#liq-iva-comp", iva.comp);
}

function normalizeFrigorificoCashInput(value, operation = state.currentOperation) {
  const parsed = Number(value || 0);
  if (!isFrigorificoIvaOperation(operation) || !parsed) return parsed;
  const calc = getFrigorificoCalc(operation);
  const expectedWithoutIva = Math.max(Number(calc.brutoSinIva || 0) - Number(calc.facturado || 0), 0);
  const expectedWithIva = expectedWithoutIva * 1.105;
  const tolerance = Math.max(2, expectedWithIva * 0.002);
  return Math.abs(parsed - expectedWithIva) <= tolerance ? expectedWithoutIva : parsed;
}

function renderLiquidationTotals() {
  syncCommissionToggles();
  const calc = calculateLiquidationPreview();
  if (isFrigorificoIvaOperation() && document.activeElement !== $("#liq-efectivo-prod")) {
    setMoneyInput("#liq-efectivo-prod", calc.efectivoProd);
  }
  if (isFrigorificoIvaOperation()) {
    setMoneyInput("#liq-efectivo-comp", calc.efectivoComp);
  }
  setMoneyInput("#liq-comision-fact-prod", calc.comFactProd);
  setMoneyInput("#liq-comision-fact-comp", calc.comFactComp);
  setMoneyInput("#liq-comision-efect-prod", calc.comEfProd);
  setMoneyInput("#liq-comision-efect-comp", calc.comEfComp);
  if ($("#liq-cash-iva-prod")) $("#liq-cash-iva-prod").value = moneyValue(calc.cashWithIvaProd - calc.efectivoProd);
  if ($("#liq-cash-with-iva-prod")) $("#liq-cash-with-iva-prod").value = moneyValue(calc.cashWithIvaProd);
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
  state.liquidationFacturadoTouched = Boolean(liquidacion.importeFacturadoManual);
  const facturadoValue = liquidacion.importeFacturadoManual
    ? liquidacion.importeFacturado
    : currentAutomaticFacturado();
  setMoneyInput("#liq-facturado", facturadoValue);
  $("#liq-comprobante-prod").value = liquidacion.comprobanteProd || "";
  $("#liq-comprobante-comp").value = liquidacion.comprobanteComp || "";
  state.liquidationIvaProdTouched = Boolean(liquidacion.ivaProdManual);
  state.liquidationIvaCompTouched = Boolean(liquidacion.ivaCompManual);
  const autoIva = automaticLiquidationIvaValues();
  setMoneyInput("#liq-iva-prod", liquidacion.ivaProdManual ? liquidacion.ivaProd : autoIva.prod);
  setMoneyInput("#liq-iva-comp", liquidacion.ivaCompManual ? liquidacion.ivaComp : autoIva.comp);
  setMoneyInput("#frigo-neto-final", liquidacion.netoFinalFrigorificoComp || draft.netoFinalFrigorificoComp || liquidacion.brutoVend);
  const storedBrutoSinIvaFrigo = Number(liquidacion.brutoSinIvaFrigorificoComp || draft.brutoSinIvaFrigorificoComp || 0);
  const netoFinalFrigo = Number(liquidacion.netoFinalFrigorificoComp || draft.netoFinalFrigorificoComp || liquidacion.brutoVend || 0);
  state.frigoBrutoSinIvaTouched = Boolean(liquidacion.brutoSinIvaFrigorificoManual || draft.brutoSinIvaFrigorificoManual);
  setMoneyInput("#frigo-bruto-sin-iva", storedBrutoSinIvaFrigo || (netoFinalFrigo ? netoFinalFrigo / 1.105 : 0));
  setMoneyInput("#liq-efectivo-prod", normalizeFrigorificoCashInput(liquidacion.efectivoProd));
  setMoneyInput("#liq-efectivo-comp", isFrigorificoIvaOperation() ? getFrigorificoCalc().efectivoComp : liquidacion.efectivoComp);
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
  const resolveCommissionFlag = (flag, fallback) => flag !== undefined && flag !== null ? Boolean(flag) : Boolean(fallback);
  $("#liq-comision-fact-prod-enabled").checked = Boolean(
    resolveCommissionFlag(
      liquidacion.aplicaComisionFacturadoProd ?? draft.aplicaComisionFacturadoProd,
      Number(liquidacion.comisionFacturadoProd || 0) || Number(liquidacion.comisionFacturadoProdPct || draft.comisionProd || 0)
    )
  );
  $("#liq-comision-fact-comp-enabled").checked = Boolean(
    resolveCommissionFlag(
      liquidacion.aplicaComisionFacturadoComp ?? draft.aplicaComisionFacturadoComp,
      Number(liquidacion.comisionFacturadoComp || 0) || Number(liquidacion.comisionFacturadoCompPct || draft.comisionComp || 0)
    )
  );
  $("#liq-comision-efect-prod-enabled").checked = Boolean(
    resolveCommissionFlag(
      liquidacion.aplicaComisionEfectivoProd ?? draft.aplicaComisionEfectivoProd,
      Number(liquidacion.comisionEfectivoProd || 0) || Number(liquidacion.comisionEfectivoProdPct || draft.comisionEfectivoProd || 0)
    )
  );
  $("#liq-comision-efect-comp-enabled").checked = Boolean(
    resolveCommissionFlag(
      liquidacion.aplicaComisionEfectivoComp ?? draft.aplicaComisionEfectivoComp,
      Number(liquidacion.comisionEfectivoComp || 0) || Number(liquidacion.comisionEfectivoCompPct || draft.comisionEfectivoComp || 0)
    )
  );
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
  $("#liq-observaciones").value = liquidacion.observaciones || "";
  $("#liq-observaciones-prod").value = liquidacion.observacionesProd || draft.observacionesProd || "";
  $("#liq-observaciones-comp").value = liquidacion.observacionesComp || draft.observacionesComp || "";
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
  const brutoComp = numberValue("#liq-bruto-comp") || Number(liquidation.brutoComp || sumSaleLines(operation && operation.saleLines, "importeComp") || brutoVend);
  const facturado = numberValue("#liq-facturado") || Number(liquidation.importeFacturado || 0);
  const netoFinal = optionalInputNumber("#frigo-neto-final", parseMoneyInput(draft.netoFinalFrigorificoComp || liquidation.netoFinalFrigorifico || brutoVend));
  const brutoSinIvaAuto = netoFinal > 0 ? netoFinal / 1.105 : 0;
  const brutoSinIvaManual = Boolean(liquidation.brutoSinIvaFrigorificoManual || draft.brutoSinIvaFrigorificoManual || state.frigoBrutoSinIvaTouched);
  const storedBrutoSinIva = brutoSinIvaManual
    ? parseMoneyInput(liquidation.brutoSinIvaFrigorificoComp || draft.brutoSinIvaFrigorificoComp || 0)
    : 0;
  const brutoSinIva = state.frigoBrutoSinIvaTouched
    ? optionalInputNumber("#frigo-bruto-sin-iva", storedBrutoSinIva || brutoSinIvaAuto)
    : (storedBrutoSinIva || brutoSinIvaAuto);
  const efectivoSinIva = Math.max(brutoSinIva - facturado, 0);
  const ivaLiquidacion = facturado * 0.105;
  const ivaComprador = ivaLiquidacion;
  const ivaEfectivo = efectivoSinIva * 0.105;
  const efectivoConIva = efectivoSinIva + ivaEfectivo;
  const facturadoConIvaComp = facturado + ivaComprador;
  const efectivoComp = Math.max(brutoComp - facturadoConIvaComp, 0);

  return {
    netoFinal,
    brutoSinIva,
    brutoSinIvaAuto,
    brutoComp,
    facturado,
    ivaLiquidacion,
    ivaComprador,
    efectivoSinIva,
    ivaEfectivo,
    efectivoConIva,
    facturadoConIvaComp,
    efectivoComp,
    totalControlComp: facturadoConIvaComp + efectivoComp,
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
    if (document.activeElement !== $("#frigo-bruto-sin-iva")) setMoneyInput("#frigo-bruto-sin-iva", calc.brutoSinIva);
    $("#frigo-bruto-liquidado").textContent = moneyValue(calc.facturado);
    $("#frigo-iva-liquidacion").textContent = moneyValue(calc.ivaLiquidacion);
    $("#frigo-efectivo-sin-iva").textContent = moneyValue(calc.efectivoSinIva);
    $("#frigo-iva-efectivo").textContent = moneyValue(calc.ivaEfectivo);
    $("#frigo-efectivo-con-iva").textContent = moneyValue(calc.efectivoConIva);
    $("#frigo-total-control").textContent = moneyValue(calc.totalControl);
    if ($("#frigo-buyer-calc-box")) {
      $("#frigo-buyer-calc-box").hidden = false;
      $("#frigo-comp-total").textContent = moneyValue(calc.brutoComp);
      $("#frigo-comp-facturado-iva").textContent = moneyValue(calc.facturadoConIvaComp);
      $("#frigo-comp-efectivo").textContent = moneyValue(calc.efectivoComp);
      $("#frigo-comp-control").textContent = moneyValue(calc.totalControlComp);
    }
  }
  if (!isFrigo && $("#frigo-buyer-calc-box")) $("#frigo-buyer-calc-box").hidden = true;

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
  if (nextStep !== "report") state.reportMode = "auto";
  $all("[data-operation-step]").forEach((button) => {
    button.classList.toggle("active", button.dataset.operationStep === nextStep);
  });
  if (selected && nextStep === "report") {
    renderReport();
    refreshOperationForReport();
  }
}

async function refreshOperationForReport() {
  if (!state.selectedOperationId || state.reportRefreshInFlight) return;
  const operationId = state.selectedOperationId;
  state.reportRefreshInFlight = true;
  try {
    const response = await fetchJson(`/api/operaciones/${encodeURIComponent(operationId)}`);
    if (state.selectedOperationId !== operationId || state.operationStep !== "report") return;
    state.currentOperation = {
      ...(state.currentOperation || {}),
      ...(response.item || {})
    };
    renderSaleLines(state.currentOperation.saleLines || []);
    renderReport();
  } catch (error) {
    console.warn("No se pudo refrescar la operacion para el reporte", error);
  } finally {
    state.reportRefreshInFlight = false;
  }
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
  if ($("#partial-date") && !$("#partial-date").value) $("#partial-date").value = new Date().toISOString().slice(0, 10);
  if ($("#partial-due") && !$("#partial-due").value) $("#partial-due").value = $("#partial-date")?.value || new Date().toISOString().slice(0, 10);
  $("#category-admin-panel").hidden = false;
  $("#category-admin-toggle").textContent = "Cerrar listado";
  renderCategoryAdmin();
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
  state.editingSaleLineId = "";
  $("#sale-panel").hidden = true;
  $("#liquidation-panel").hidden = true;
  $("#report-panel").hidden = true;
  $("#sale-operation-label").textContent = "";
  $("#sale-category-suggestions").hidden = true;
  $("#sale-category-suggestions").innerHTML = "";
  $("#report-sheet").innerHTML = "";
  $("#sale-desbaste-vend").value = "0";
  $("#sale-desbaste-comp").value = "0";
  $("#sale-line-save").textContent = "Agregar linea";
  $("#sale-line-cancel-edit").hidden = true;
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

function resetSaleLineForm() {
  state.editingSaleLineId = "";
  $("#sale-form").reset();
  $("#sale-line-save").textContent = "Agregar linea";
  $("#sale-line-cancel-edit").hidden = true;
  $("#sale-category-suggestions").hidden = true;
  $("#sale-category-suggestions").innerHTML = "";
  $("#sale-desbaste-vend").value = "0";
  $("#sale-desbaste-comp").value = "0";
  syncSaleMode();
  syncBuyerDiff();
  renderSalePreview();
}

function fillSaleLineForm(line) {
  state.editingSaleLineId = line.id;
  $("#sale-category").value = line.categoria || "";
  $("#sale-heads").value = line.cabezas || "";
  $("#sale-kg-bruto").value = line.kgBruto || "";
  $("#sale-desbaste-vend").value = line.desbasteVend || "0";
  $("#sale-kg-neto-vend").value = line.kgNetoVend || "";
  $("#sale-tipo-precio-vend").value = line.tipoPrecioVend || "KG";
  $("#sale-precio-vend").value = line.precioVend || "";
  $("#sale-tab-vend").value = line.tabVend || "";
  $("#sale-use-real-kg-vend").checked = Boolean(line.usarKgRealVend);
  $("#sale-kg-calc-vend").value = line.kgCalculoVend || "";
  $("#sale-prom-used-vend").value = line.promUsadoVend || "";
  $("#sale-final-price-manual-vend").value = line.precioFinalManualVend || "";
  $("#sale-amount-manual-vend").value = line.importeManualVend || "";

  $("#sale-buyer-different").checked = Boolean(line.compradorDiferente);
  $("#sale-buyer-different-faena").checked = Boolean(line.compradorDiferente);
  $("#sale-desbaste-comp").value = line.desbasteComp || "0";
  $("#sale-kg-comp").value = line.kgComp || "";
  $("#sale-tipo-precio-comp").value = line.tipoPrecioComp || "KG";
  $("#sale-precio-comp").value = line.precioComp || "";
  $("#sale-tab-comp").value = line.tabComp || "";
  $("#sale-use-real-kg-comp").checked = Boolean(line.usarKgRealComp);
  $("#sale-kg-calc-comp").value = line.kgCalculoComp || "";
  $("#sale-prom-used-comp").value = line.promUsadoComp || "";
  $("#sale-final-price-manual-comp").value = line.precioFinalManualComp || "";
  $("#sale-amount-manual-comp").value = line.importeManualComp || "";

  $("#sale-line-save").textContent = "Guardar cambios";
  $("#sale-line-cancel-edit").hidden = false;
  syncSaleMode();
  syncBuyerDiff();
  renderSalePreview();
  $("#sale-form").scrollIntoView({ behavior: "smooth", block: "start" });
  setSaleMessage("Editando linea cargada. Guarde cambios o cancele.", "ok");
}

async function deleteSaleLine(lineId) {
  if (!state.selectedOperationId || !lineId) return;
  const confirmed = window.confirm("Se quitara solo esta linea de venta. La operacion queda cargada. ¿Continuar?");
  if (!confirmed) return;
  setSaleMessage("Quitando linea...");
  try {
    await fetchJson(`/api/operaciones/${encodeURIComponent(state.selectedOperationId)}/venta-lineas/${encodeURIComponent(lineId)}`, {
      method: "DELETE"
    });
    const operaciones = await fetchJson("/api/operaciones");
    state.operaciones = operaciones.items || [];
    renderOperaciones();
    renderMetrics();
    await openSale(state.selectedOperationId, "sale");
    resetSaleLineForm();
    setSaleMessage("Linea quitada correctamente.", "ok");
  } catch (error) {
    setSaleMessage(error.message, "error");
  }
}

async function savePartialBilling() {
  if (!state.selectedOperationId) return;
  $("#partial-message").textContent = "Guardando parcial...";
  $("#partial-message").className = "form-message";
  try {
    await fetchJson(`/api/operaciones/${encodeURIComponent(state.selectedOperationId)}/facturacion-parcial`, {
      method: "POST",
      body: JSON.stringify({
        fecha: $("#partial-date").value,
        vencimiento: $("#partial-due").value,
        planVencimientos: $("#partial-due-plan").value,
        comprobante: $("#partial-receipt").value,
        parteCuenta: $("#partial-party").value,
        cantidad: parseMoneyInput($("#partial-heads").value),
        importeBruto: parseMoneyInput($("#partial-gross").value),
        importeNeto: parseMoneyInput($("#partial-net").value),
        iva: parseMoneyInput($("#partial-iva").value),
        observaciones: $("#partial-notes").value
      })
    });
    await openSale(state.selectedOperationId, "sale");
    $("#partial-receipt").value = "";
    $("#partial-due-plan").value = "";
    $("#partial-heads").value = "";
    $("#partial-gross").value = "";
    $("#partial-net").value = "";
    $("#partial-iva").value = "";
    $("#partial-notes").value = "";
    $("#partial-message").textContent = "Parcial agregado. Si tiene impacto seleccionado, ya queda disponible en cuenta corriente.";
    $("#partial-message").className = "form-message ok";
  } catch (error) {
    $("#partial-message").textContent = error.message;
    $("#partial-message").className = "form-message error";
  }
}

async function deletePartialBilling(lineId) {
  if (!state.selectedOperationId || !lineId) return;
  const confirmed = window.confirm("Se quitara este parcial y su movimiento de cuenta corriente si tenia impacto. ¿Continuar?");
  if (!confirmed) return;
  try {
    await fetchJson(`/api/operaciones/${encodeURIComponent(state.selectedOperationId)}/facturacion-parcial/${encodeURIComponent(lineId)}`, {
      method: "DELETE"
    });
    await openSale(state.selectedOperationId, "sale");
    $("#partial-message").textContent = "Parcial eliminado.";
    $("#partial-message").className = "form-message ok";
  } catch (error) {
    $("#partial-message").textContent = error.message;
    $("#partial-message").className = "form-message error";
  }
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
  const buyerDifferent = faena ? $("#sale-buyer-different-faena").checked : $("#sale-buyer-different").checked;
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
    precioComp: buyerDifferent ? parseMoneyInput($("#sale-precio-comp").value) : parseMoneyInput($("#sale-precio-vend").value),
    tabComp: faena ? "" : $("#sale-tab-comp").value,
    usarKgRealComp: faena ? false : $("#sale-use-real-kg-comp").checked,
    kgCalculoComp: faena ? "" : $("#sale-kg-calc-comp").value,
    promUsadoComp: faena ? "" : $("#sale-prom-used-comp").value,
    precioFinalManualComp: parseMoneyInput($("#sale-final-price-manual-comp").value) || "",
    importeManualComp: parseMoneyInput($("#sale-amount-manual-comp").value) || ""
  };

  try {
    const editingLineId = state.editingSaleLineId;
    const url = editingLineId
      ? `/api/operaciones/${encodeURIComponent(state.selectedOperationId)}/venta-lineas/${encodeURIComponent(editingLineId)}`
      : `/api/operaciones/${encodeURIComponent(state.selectedOperationId)}/venta-lineas`;
    await fetchJson(url, {
      method: editingLineId ? "PUT" : "POST",
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
    resetSaleLineForm();
    setSaleMessage(editingLineId ? "Linea actualizada correctamente." : "Linea agregada correctamente.", "ok");
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
    importeFacturadoManual: Boolean(state.liquidationFacturadoTouched),
    comprobanteProd: $("#liq-comprobante-prod").value,
    comprobanteComp: $("#liq-comprobante-comp").value,
    ivaProd: parseMoneyInput($("#liq-iva-prod").value),
    ivaProdManual: Boolean(state.liquidationIvaProdTouched),
    ivaComp: parseMoneyInput($("#liq-iva-comp").value),
    ivaCompManual: Boolean(state.liquidationIvaCompTouched),
    efectivoProd: normalizeFrigorificoCashInput(parseMoneyInput($("#liq-efectivo-prod").value)),
    efectivoComp: isFrigorificoIvaOperation() ? getFrigorificoCalc().efectivoComp : parseMoneyInput($("#liq-efectivo-comp").value),
    comisionFacturadoProd: parseMoneyInput($("#liq-comision-fact-prod").value),
    comisionFacturadoComp: parseMoneyInput($("#liq-comision-fact-comp").value),
    comisionEfectivoProd: parseMoneyInput($("#liq-comision-efect-prod").value),
    comisionEfectivoComp: parseMoneyInput($("#liq-comision-efect-comp").value),
    aplicaComisionFacturadoProd: isCommissionEnabled("#liq-comision-fact-prod-enabled"),
    aplicaComisionFacturadoComp: isCommissionEnabled("#liq-comision-fact-comp-enabled"),
    aplicaComisionEfectivoProd: isCommissionEnabled("#liq-comision-efect-prod-enabled"),
    aplicaComisionEfectivoComp: isCommissionEnabled("#liq-comision-efect-comp-enabled"),
    comisionFacturadoProdPct: commissionPercent("#liq-comision-fact-prod-enabled", "#liq-comision-fact-prod-pct"),
    comisionFacturadoCompPct: commissionPercent("#liq-comision-fact-comp-enabled", "#liq-comision-fact-comp-pct"),
    comisionEfectivoProdPct: commissionPercent("#liq-comision-efect-prod-enabled", "#liq-comision-efect-prod-pct"),
    comisionEfectivoCompPct: commissionPercent("#liq-comision-efect-comp-enabled", "#liq-comision-efect-comp-pct"),
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
    brutoSinIvaFrigorificoComp: parseMoneyInput($("#frigo-bruto-sin-iva").value),
    brutoSinIvaFrigorificoManual: Boolean(state.frigoBrutoSinIvaTouched),
    observaciones: $("#liq-observaciones").value,
    observacionesProd: $("#liq-observaciones-prod").value,
    observacionesComp: $("#liq-observaciones-comp").value,
    detalleLiquidar: collectLiquidationDetail()
  };
  try {
  const saved = await fetchJson(`/api/operaciones/${encodeURIComponent(state.selectedOperationId)}/liquidacion`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    fillLiquidationForm(saved.item);
    if (state.currentOperation) {
      state.currentOperation.liquidacion = saved.item;
      state.currentOperation.liquidacionConfirmada = true;
    }
    setLiquidationMessage("Liquidacion guardada correctamente.", "ok");
  } catch (error) {
    setLiquidationMessage(error.message, "error");
  }
}

function kgValue(value) {
  const number = Number(value || 0);
  return number ? `${number.toLocaleString("es-AR", { maximumFractionDigits: 2 })} kgs` : "-";
}

function plainNumberValue(value) {
  const number = Number(value || 0);
  return number ? number.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "-";
}

function saleLineCalcValue(line, side) {
  const seller = side === "vend";
  const heads = Number(line.cabezas || 0);
  const kgBruto = Number(line.kgBruto || 0);
  const desbaste = Number(seller ? line.desbasteVend : line.desbasteComp || line.desbasteVend || 0);
  const kgNeto = Number(seller ? line.kgNetoVend : line.kgComp || line.kgNetoVend || 0);
  const kgCalculoManual = seller ? line.kgCalculoVend : line.kgCalculoComp;
  const useReal = seller ? line.usarKgRealVend : line.usarKgRealComp;
  const kgCalculo = String(kgCalculoManual || "").trim()
    ? parseMoneyInput(kgCalculoManual)
    : useReal ? kgBruto * (1 - desbaste / 100) : kgNeto;
  const promManual = seller ? line.promUsadoVend : line.promUsadoComp;
  const promedio = String(promManual || "").trim() ? parseMoneyInput(promManual) : heads ? kgCalculo / heads : 0;
  const tab = seller ? line.tabVend : line.tabComp || line.tabVend;
  const tipoPrecio = seller ? line.tipoPrecioVend : line.tipoPrecioComp || line.tipoPrecioVend;
  const precioBase = Number(seller ? line.precioVend : line.precioComp || line.precioVend || 0);
  const precioFinal = Number(seller ? line.precioFinalVend : line.precioFinalComp || line.precioFinalVend || 0);
  const ajusteTab = tipoPrecio === "CAB" ? 0 : tabDelta(tab, promedio);
  return { kgCalculo, promedio, tab, tipoPrecio, precioBase, precioFinal, ajusteTab };
}

function tabText(calc) {
  if (!calc.tab) return "-";
  const adjustment = Number(calc.ajusteTab || 0);
  return `${calc.tab}${adjustment ? ` (${adjustment > 0 ? "+" : ""}${adjustment})` : ""}`;
}

function saleControlRows(lines, side) {
  return (lines || []).map((line) => {
    const calc = saleLineCalcValue(line, side);
    const seller = side === "vend";
    return `
      <tr>
        <td>${escapeHtml(line.categoria || "-")}</td>
        <td>${escapeHtml(line.cabezas || "-")}</td>
        <td>${kgValue(line.kgBruto)}</td>
        <td>${plainNumberValue(seller ? line.desbasteVend : line.desbasteComp || line.desbasteVend)}%</td>
        <td>${kgValue(seller ? line.kgNetoVend : line.kgComp || line.kgNetoVend)}</td>
        <td>${kgValue(calc.kgCalculo)}</td>
        <td>${plainNumberValue(calc.promedio)}</td>
        <td>${escapeHtml(tabText(calc))}</td>
        <td>${moneyValue(calc.precioFinal || calc.precioBase)}</td>
        <td>${moneyValue(seller ? line.importeVend : line.importeComp || line.importeVend)}</td>
      </tr>
    `;
  }).join("");
}

function fileSafeName(value) {
  return normalizeSearch(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function reportPdfName(party) {
  const operation = state.currentOperation || {};
  const isSeller = party === "seller";
  const kind = isSeller ? "Venta" : "Compra";
  const name = isSeller ? operation.vendedor : operation.comprador;
  return `${fileSafeName(operation.id || "Operacion")}_${kind}_${fileSafeName(name || "Cliente")}`;
}

function reportExportButton(party) {
  return `
    <div class="report-export-actions">
      <button type="button" class="ghost-button" data-report-party-pdf="${party}">Exportar PDF ${party === "seller" ? "vendedor" : "comprador"}</button>
    </div>
  `;
}

function printReportParty(party) {
  const selector = party === "seller" ? ".seller-report" : ".buyer-report";
  const block = document.querySelector(`#report-sheet ${selector}`);
  if (!block) return;
  const filename = reportPdfName(party);
  const clone = block.cloneNode(true);
  clone.querySelectorAll(".report-export-actions").forEach((node) => node.remove());
  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title><style>
    body{font-family:Arial,sans-serif;margin:8mm;color:#173632;background:white}
    .report-page-block{border:0;padding:0;font-size:8.5pt;line-height:1.12}
    .report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #173632;padding-bottom:5px;margin-bottom:5px}
    .report-header h2{font-size:14px;margin:0}.subtle{color:#52706b;margin:2px 0}
    .report-logo{width:72px;height:72px;object-fit:contain;background:#173632;border-radius:6px;padding:4px}
    .report-title,.report-kv,.report-note,.report-line,.report-net,.report-section{margin-top:5px}
    .report-title,.report-line,.report-net{border:1px solid #cbd7d4;padding:5px 6px}
    .report-title strong,.report-title span,.report-note span,.report-note strong{display:block}
    .report-kv{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #cbd7d4}
    .report-kv span,.report-kv strong{padding:3px 4px;border-bottom:1px solid #cbd7d4}.report-kv span{color:#52706b}
    .report-section h3{margin:0 0 3px;font-size:8pt;text-transform:uppercase}
    .report-table{width:100%;border-collapse:collapse;font-size:7.5pt}.control-table{font-size:6.6pt}
    .partial-report-table,.partial-due-table{table-layout:fixed;font-size:6.5pt}
    .partial-report-table th,.partial-report-table td,.partial-due-table th,.partial-due-table td{overflow-wrap:anywhere;padding:2.5px 3px}
    .report-table th,.report-table td{border:1px solid #cbd7d4;padding:3px 4px;text-align:left;vertical-align:top}
    .report-total{background:#edf3f1;font-weight:bold}.seller-net{background:#eaf2ff}.buyer-net{background:#fff0e6}
    button{margin-top:14px;padding:8px 12px}@media print{@page{size:A4 portrait;margin:6mm}body{margin:0}button{display:none}}
  </style></head><body>${clone.outerHTML}<button onclick="window.print()">Imprimir / guardar PDF</button></body></html>`);
  popup.document.close();
  popup.focus();
}

function printReportSheet() {
  const sheet = $("#report-sheet");
  if (!sheet || !sheet.innerHTML.trim()) return;
  const clone = sheet.cloneNode(true);
  clone.querySelectorAll(".report-export-actions").forEach((node) => node.remove());
  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Reporte_${escapeHtml(state.currentOperation?.id || "")}</title><style>
    body{font-family:Arial,sans-serif;margin:8mm;color:#173632;background:white}
    .report-pages{display:block}.report-page-block{break-after:page;border:0;padding:0;font-size:8.5pt;line-height:1.12;margin-bottom:8mm}
    .report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #173632;padding-bottom:5px;margin-bottom:5px}
    .report-header h2{font-size:14px;margin:0}.subtle,.report-build{color:#52706b;margin:2px 0}.report-build{font-size:7pt}
    .report-logo{width:72px;height:72px;object-fit:contain;background:#173632;border-radius:6px;padding:4px}
    .report-title,.report-kv,.report-note,.report-line,.report-net,.report-section{margin-top:5px}
    .report-title,.report-line,.report-net{border:1px solid #cbd7d4;padding:5px 6px}
    .report-title strong,.report-title span,.report-note span,.report-note strong{display:block}
    .report-kv{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #cbd7d4}
    .report-kv span,.report-kv strong{padding:3px 4px;border-bottom:1px solid #cbd7d4}.report-kv span{color:#52706b}
    .report-section h3{margin:0 0 3px;font-size:8pt;text-transform:uppercase}
    .report-table{width:100%;border-collapse:collapse;font-size:7.5pt}.control-table{font-size:6.6pt}
    .partial-report-table,.partial-due-table{table-layout:fixed;font-size:6.5pt}
    .partial-report-table th,.partial-report-table td,.partial-due-table th,.partial-due-table td{overflow-wrap:anywhere;padding:2.5px 3px}
    .report-table th,.report-table td{border:1px solid #cbd7d4;padding:3px 4px;text-align:left;vertical-align:top}
    .report-total{background:#edf3f1;font-weight:bold}.seller-net{background:#eaf2ff}.buyer-net{background:#fff0e6}
    button{margin-top:14px;padding:8px 12px}@media print{@page{size:A4 portrait;margin:6mm}body{margin:0}button{display:none}}
  </style></head><body>${clone.innerHTML}<button onclick="window.print()">Imprimir / guardar PDF</button></body></html>`);
  popup.document.close();
  popup.focus();
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
  const controlOnly = state.reportMode === "control" || !operation.liquidacionConfirmada;
  const sellerObservation = $("#liq-observaciones-prod").value || (operation.liquidacion && operation.liquidacion.observacionesProd) || draft.observacionesProd || "";
  const buyerObservation = $("#liq-observaciones-comp").value || (operation.liquidacion && operation.liquidacion.observacionesComp) || draft.observacionesComp || "";
  const partialLines = reportPartialBillingLines(operation);
  const partialTotals = partialBillingTotals(operation, partialLines);
  const hasPartialBilling = partialLines.length > 0;
  const partialFinalRows = partialLines.map((line) => `
    <tr>
      <td>${escapeHtml(line.fecha || "-")}</td>
      <td>${escapeHtml(line.comprobante || "-")}</td>
      <td>${plainNumberValue(line.cantidad)}</td>
      <td>${moneyValue(line.importeBruto || line.importeNeto)}</td>
      <td>${moneyValue(line.importeNeto)}</td>
      <td>${moneyValue(line.iva)}</td>
    </tr>
  `).join("");
  const partialDueItems = partialLines.flatMap((line) => {
    const amount = Number(line.importeNeto || 0);
    if (!amount) return [];
    if (String(line.planVencimientos || "").trim()) {
      return parseDuePlan(line.planVencimientos, amount).map((item) => ({
        fecha: addDisplayDays(line.fecha, item.days),
        comprobante: line.comprobante || "-",
        cantidad: Number(line.cantidad || 0),
        detalle: item.manual ? "Importe manual" : `${String(Number(item.pct.toFixed(2))).replace(".", ",")}%`,
        importe: Number(item.amount || 0)
      }));
    }
    return [{
      fecha: line.vencimiento || line.fecha || "-",
      comprobante: line.comprobante || "-",
      cantidad: Number(line.cantidad || 0),
      detalle: "100%",
      importe: amount
    }];
  });
  const partialDueTotals = Array.from(partialDueItems.reduce((map, item) => {
    const key = item.fecha || "-";
    map.set(key, (map.get(key) || 0) + Number(item.importe || 0));
    return map;
  }, new Map()).entries())
    .sort((a, b) => (parseDisplayDate(a[0])?.getTime() || 0) - (parseDisplayDate(b[0])?.getTime() || 0));
  const partialDueTotalRows = partialDueTotals.map(([fecha, importe]) => `
    <tr class="report-total"><td>${escapeHtml(fecha)}</td><td>Total a cobrar por liquidaciones parciales</td><td>${moneyValue(importe)}</td></tr>
  `).join("");
  const partialDueReport = hasPartialBilling ? `
    <div class="report-section partial-due-section">
      <h3>Cobros por fecha</h3>
      <table class="report-table partial-due-table">
        <thead><tr><th>Fecha de cobro</th><th>Detalle</th><th>Neto a cobrar</th></tr></thead>
        <tbody>${partialDueTotalRows || `<tr><td colspan="3">Sin vencimientos parciales informados.</td></tr>`}</tbody>
      </table>
    </div>
  ` : "";

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
  const sellerLines = saleControlRows(operation.saleLines || [], "vend");
  const sellerLinesTotal = (operation.saleLines || []).reduce((sum, line) => sum + Number(line.importeVend || 0), 0);
  const buyerLines = saleControlRows(operation.saleLines || [], "comp");
  const buyerLinesTotal = (operation.saleLines || []).reduce((sum, line) => sum + Number(line.importeComp || line.importeVend || 0), 0);
  const showKgTotal = isFaenaReportOperation(operation) || (operation.saleLines || []).length > 1;
  const totalKgBruto = (operation.saleLines || []).reduce((sum, line) => sum + Number(line.kgBruto || 0), 0);
  const kgTotalReportRow = showKgTotal ? `<tr class="report-total"><td colspan="2">Total kilos</td><td>${kgValue(totalKgBruto)}</td><td colspan="7"></td></tr>` : "";
  const loadTableHead = `<thead><tr><th>Categoria</th><th>Cant.</th><th>Kg bruto</th><th>Desb.</th><th>Kg neto</th><th>Kg calculo</th><th>Prom.</th><th>TAB</th><th>Precio final</th><th>Importe</th></tr></thead>`;
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
        <p class="report-build">Actualizacion ${escapeHtml(APP_BUILD)}</p>
      </div>
      <img class="report-logo" src="/logo-espinosa-blanco.png" alt="">
    </div>
    <div class="report-title"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(operationTypeLabel(operation))} - ${escapeHtml(operation.destino || "")}</span></div>
  `;
  const operationNote = conditions ? `<div class="report-note"><span>Minuta / condiciones de la operacion</span><strong>${escapeHtml(conditions)}</strong></div>` : "";
  const partyNote = (title, text) => text ? `<div class="report-note"><span>${escapeHtml(title)}</span><strong>${escapeHtml(text)}</strong></div>` : "";
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
  const partialReport = partialLines.length ? `
    <div class="report-section partial-report-section">
      <h3>Control de facturacion parcial</h3>
      <table class="report-table partial-report-table">
        <thead><tr><th>Fecha</th><th>Comprobante</th><th>Cant.</th><th>Bruto</th><th>Neto a cobrar</th><th>IVA dato</th></tr></thead>
        <tbody>${partialFinalRows}
          <tr class="report-total"><td colspan="2">Liquidado parcial</td><td>${plainNumberValue(partialTotals.billedHeads)}</td><td>${moneyValue(partialTotals.billedGross)}</td><td>${moneyValue(partialTotals.billedNet)}</td><td>${moneyValue(partialTotals.billedIva)}</td></tr>
          <tr class="report-total"><td colspan="2">Pendiente operativo bruto</td><td>${plainNumberValue(partialTotals.pendingHeads)}</td><td>${moneyValue(partialTotals.pendingGross)}</td><td>-</td><td>-</td></tr>
        </tbody>
      </table>
    </div>
    ${partialDueReport}
  ` : "";
  const partialFinalReport = hasPartialBilling ? `
    <div class="report-section partial-report-section">
      <h3>Liquidaciones parciales consolidadas</h3>
      <table class="report-table partial-report-table">
        <thead><tr><th>Fecha</th><th>Comprobante</th><th>Cant.</th><th>Bruto liquidado</th><th>Neto a cobrar</th><th>IVA dato</th></tr></thead>
        <tbody>${partialFinalRows}
          <tr class="report-total"><td colspan="2">Total liquidado real</td><td>${plainNumberValue(partialTotals.billedHeads)}</td><td>${moneyValue(partialTotals.billedGross)}</td><td>${moneyValue(partialTotals.billedNet)}</td><td>${moneyValue(partialTotals.billedIva)}</td></tr>
          <tr class="report-total"><td colspan="2">Pendiente contra operacion total</td><td>${plainNumberValue(partialTotals.pendingHeads)}</td><td>${moneyValue(partialTotals.pendingGross)}</td><td>-</td><td>-</td></tr>
        </tbody>
      </table>
    </div>
    ${partialDueReport}
  ` : "";
  const sellerFinalNet = hasPartialBilling ? partialTotals.billedNet + (Number(calc.netoTotalProd || 0) - Number(calc.netoLiquidacionProd || 0)) : calc.netoTotalProd;
  const buyerFinalNet = hasPartialBilling ? partialTotals.billedNet + (Number(calc.netoTotalComp || 0) - Number(calc.netoLiquidacionComp || 0)) : calc.netoTotalComp;
  const sellerLiquidationSummary = hasPartialBilling ? `
    ${partialFinalReport}
    <div class="report-net seller-net"><span>NETO LIQUIDACIONES PARCIALES</span><strong>${moneyValue(partialTotals.billedNet)}</strong></div>
  ` : `
    <div class="report-section"><h3>Liquidacion / facturado</h3><table class="report-table"><tbody>
      <tr><th>Comprobante</th><td>${escapeHtml($("#liq-comprobante-prod").value || "-")}</td><th>Importe bruto operacion</th><td>${moneyValue(calc.brutoVend || numberValue("#liq-bruto-vend"))}</td></tr>
      <tr><th>Importe facturado</th><td>${moneyValue(calc.facturado)}</td><th>IVA liquidacion</th><td>${moneyValue(calc.ivaProd)}</td></tr>
    </tbody></table></div>
    ${sellerExpensesReport}
    ${calc.comFactProd ? `<div class="report-line"><span>Comision sobre facturado</span><strong>${moneyValue(calc.comFactProd)}</strong></div>` : ""}
    <div class="report-net seller-net"><span>NETO LIQUIDACION</span><strong>${moneyValue(calc.netoLiquidacionProd)}</strong></div>
  `;
  const buyerLiquidationSummary = hasPartialBilling ? `
    ${partialFinalReport}
    <div class="report-net buyer-net"><span>NETO LIQUIDACIONES PARCIALES</span><strong>${moneyValue(partialTotals.billedNet)}</strong></div>
  ` : `
    <div class="report-section"><h3>Liquidacion / facturado</h3><table class="report-table"><tbody>
      <tr><th>Comprobante</th><td>${escapeHtml($("#liq-comprobante-comp").value || "-")}</td><th>Importe bruto operacion</th><td>${moneyValue(calc.brutoComp || numberValue("#liq-bruto-comp"))}</td></tr>
      <tr><th>Importe facturado</th><td>${moneyValue(calc.facturado)}</td><th>IVA liquidacion</th><td>${moneyValue(calc.ivaComp)}</td></tr>
    </tbody></table></div>
    ${buyerExpensesReport}
    ${calc.comFactComp ? `<div class="report-line"><span>Comision sobre facturado</span><strong>${moneyValue(calc.comFactComp)}</strong></div>` : ""}
    <div class="report-net buyer-net"><span>NETO LIQUIDACION</span><strong>${moneyValue(calc.netoLiquidacionComp)}</strong></div>
  `;
  const controlReport = `
    <div class="report-pages">
      <section class="report-page-block seller-report">
        ${reportHeader("REPORTE DE CARGA Y CONTROL - PRODUCTOR")}
        ${operationData("Productor", operation.vendedor, sellerCuit, operation.comprador, buyerCuit)}
        ${operationNote}
        ${partyNote("Observaciones productor", sellerObservation)}
        <div class="report-section"><h3>Detalle de carga vendedor</h3><table class="report-table control-table">${loadTableHead}<tbody>${sellerLines}${kgTotalReportRow}<tr class="report-total"><td colspan="9">Importe bruto venta</td><td>${moneyValue(sellerLinesTotal)}</td></tr></tbody></table></div>
        ${partialReport}
        ${reportExportButton("seller")}
      </section>
      <section class="report-page-block buyer-report">
        ${reportHeader("REPORTE DE CARGA Y CONTROL - COMPRADOR")}
        ${operationData("Comprador", operation.comprador, buyerCuit, operation.vendedor, sellerCuit)}
        ${operationNote}
        ${partyNote("Observaciones comprador", buyerObservation)}
        <div class="report-section"><h3>Detalle de carga comprador</h3><table class="report-table control-table">${loadTableHead}<tbody>${buyerLines}${kgTotalReportRow}<tr class="report-total"><td colspan="9">Importe bruto venta</td><td>${moneyValue(buyerLinesTotal)}</td></tr></tbody></table></div>
        ${reportExportButton("buyer")}
      </section>
    </div>
  `;
  $("#report-control-mode").classList.toggle("active", controlOnly);
  $("#report-final-mode").classList.toggle("active", !controlOnly);

  if (controlOnly) {
    $("#report-sheet").innerHTML = controlReport;
    return;
  }
  $("#report-sheet").innerHTML = `
    <div class="report-pages">
      <section class="report-page-block seller-report">
        ${reportHeader("REPORTE FINAL PARA PRODUCTOR")}
        ${operationData("Productor", operation.vendedor, sellerCuit, operation.comprador, buyerCuit)}
        ${operationNote}
        ${partyNote("Observaciones productor", sellerObservation)}
        <div class="report-section"><h3>Carga real vendedor</h3><table class="report-table control-table">${loadTableHead}<tbody>${sellerLines}${kgTotalReportRow}<tr class="report-total"><td colspan="9">Importe bruto venta</td><td>${moneyValue(sellerLinesTotal)}</td></tr></tbody></table></div>
        ${isDirectOperation(operation) ? detailReport : ""}
        ${frigoReport}
        ${hasPartialBilling ? "" : dueReport(sellerDueRows)}
        ${sellerLiquidationSummary}
        ${calc.efectivoProd || calc.cashExpenseProd || calc.comEfProd ? `<div class="report-section"><h3>Efectivo</h3><table class="report-table"><tbody>
          <tr><th>${frigoCalc ? "Efectivo + IVA" : "Efectivo"}</th><td>${moneyValue(frigoCalc ? calc.cashWithIvaProd : calc.efectivoProd)}</td><th></th><td></td></tr>
          ${calc.cashExpenseProd ? `<tr><th>Gasto descontado efectivo</th><td>${moneyValue(calc.cashExpenseProd)}</td><th>Concepto</th><td>${escapeHtml($("#liq-cash-exp-concept-prod").value || "-")}</td></tr>` : ""}
        ${calc.comEfProd ? `<tr><th>Comision sobre efectivo</th><td>${moneyValue(calc.comEfProd)}</td><th></th><td></td></tr>` : ""}
        </tbody></table></div>` : ""}
        <div class="report-net seller-net total"><span>NETO TOTAL OPERACION</span><strong>${moneyValue(sellerFinalNet)}</strong></div>
        ${reportExportButton("seller")}
      </section>
      <section class="report-page-block buyer-report">
        ${reportHeader("REPORTE FINAL PARA COMPRADOR")}
        ${operationData("Comprador", operation.comprador, buyerCuit, operation.vendedor, sellerCuit)}
        ${operationNote}
        ${partyNote("Observaciones comprador", buyerObservation)}
        <div class="report-section"><h3>Carga real comprador</h3><table class="report-table control-table">${loadTableHead}<tbody>${buyerLines}${kgTotalReportRow}<tr class="report-total"><td colspan="9">Importe bruto venta</td><td>${moneyValue(buyerLinesTotal)}</td></tr></tbody></table></div>
        ${detailReport}
        ${hasPartialBilling ? "" : dueReport(buyerDueRows)}
        ${buyerLiquidationSummary}
        ${calc.efectivoComp || calc.comEfComp ? `<div class="report-section"><h3>Efectivo</h3><table class="report-table"><tbody>
          <tr><th>Efectivo</th><td>${moneyValue(calc.efectivoComp)}</td><th>Comision sobre efectivo</th><td>${moneyValue(calc.comEfComp)}</td></tr>
        </tbody></table></div>` : ""}
        <div class="report-net buyer-net total"><span>NETO TOTAL OPERACION</span><strong>${moneyValue(buyerFinalNet)}</strong></div>
        ${reportExportButton("buyer")}
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
  $("#client-maintenance-panel").hidden = true;
  $("#client-maintenance-message").textContent = "";
  $("#client-merge-target").value = "";
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
  $("#client-maintenance-panel").hidden = false;
  $("#client-maintenance-message").textContent = "";
  $("#client-merge-target").value = "";
  populateClientMergeTargets();
  setClientMessage("Editando cliente existente.");
  setRenspaMessage("");
  await loadRenspas(client.id);
}

async function applyClientMaintenance() {
  if (!state.selectedClientId) {
    $("#client-maintenance-message").textContent = "Primero seleccione un cliente.";
    $("#client-maintenance-message").className = "form-message error";
    return;
  }
  const action = $("#client-maintenance-action").value;
  const currentName = $("#client-name").value;
  try {
    if (action === "MERGE") {
      const targetName = $("#client-merge-target").value;
      const matches = state.clientes.filter((client) => normalizeSearch(client.nombre) === normalizeSearch(targetName) && String(client.id) !== String(state.selectedClientId));
      const target = matches[0] || state.clientes.find((client) => normalizeSearch(client.nombre).includes(normalizeSearch(targetName)) && String(client.id) !== String(state.selectedClientId));
      if (!targetName || !target) {
        throw new Error("Indique el cliente correcto de destino.");
      }
      const confirmed = window.confirm(`Se fusionara "${currentName}" dentro de "${target.nombre}". Las operaciones y cuenta corriente pasaran al cliente correcto. ¿Continuar?`);
      if (!confirmed) return;
      await fetchJson(`/api/clientes/${encodeURIComponent(state.selectedClientId)}/fusionar`, {
        method: "POST",
        body: JSON.stringify({ targetName: target.nombre, targetId: target.id })
      });
      $("#client-search").value = target.nombre;
    } else {
      const confirmed = window.confirm(`Se intentara eliminar "${currentName}". Solo se permite si no tiene operaciones ni movimientos. ¿Continuar?`);
      if (!confirmed) return;
      await fetchJson(`/api/clientes/${encodeURIComponent(state.selectedClientId)}`, { method: "DELETE" });
      $("#client-search").value = "";
    }
    const [clientes, operaciones, cuenta] = await Promise.all([
      fetchJson("/api/clientes"),
      fetchJson("/api/operaciones"),
      fetchJson("/api/cuenta-corriente/resumen")
    ]);
    state.clientes = clientes.items || [];
    state.operaciones = operaciones.items || [];
    state.cuenta = cuenta;
    resetClientForm();
    renderClientes();
    renderOperaciones();
    renderMetrics();
    populateCurrentAccountClients();
    $("#client-maintenance-message").textContent = "";
    setClientMessage("Depuracion aplicada correctamente.", "ok");
  } catch (error) {
    $("#client-maintenance-message").textContent = error.message;
    $("#client-maintenance-message").className = "form-message error";
  }
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
  window.history.replaceState({ view: state.vista }, "", `#${state.vista}`);
  window.addEventListener("popstate", (event) => {
    const view = event.state?.view || preferredInitialView();
    state.restoringHistory = true;
    setView(view);
    state.restoringHistory = false;
  });
  $all("nav button").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  $("#mobile-refresh").addEventListener("click", reloadAppData);
  $("#download-backup").addEventListener("click", downloadBackup);
  $("#dashboard-period-run").addEventListener("click", renderPeriodStats);
  $("#operation-search-run").addEventListener("click", renderOperationSearch);
  $("#real-commission-run").addEventListener("click", renderRealCommissionSummary);
  ["#real-commission-from", "#real-commission-to", "#real-commission-client", "#real-commission-status", "#real-commission-kind"].forEach((selector) => {
    $(selector).addEventListener("input", renderRealCommissionSummary);
    $(selector).addEventListener("change", renderRealCommissionSummary);
  });
  ["#calc-weight-shrink", "#calc-weight-heads", "#calc-weight-adjust"].forEach((selector) => {
    $(selector).addEventListener("input", renderWeightCalculator);
  });
  $("#calc-ticket-add").addEventListener("click", addWeightTicket);
  $("#calc-ticket-kg").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addWeightTicket();
    }
  });
  $("#calc-ticket-clear").addEventListener("click", () => {
    state.weightTickets = [];
    renderWeightCalculator();
  });
  $("#calc-ticket-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-calc-ticket-remove]");
    if (!button) return;
    state.weightTickets = state.weightTickets.filter((ticket) => String(ticket.id) !== String(button.dataset.calcTicketRemove));
    renderWeightCalculator();
  });
  ["#period-type-filter", "#period-destination-filter", "#period-category-filter", "#period-client-filter"].forEach((selector) => {
    $(selector).addEventListener("input", renderPeriodStats);
    $(selector).addEventListener("change", renderPeriodStats);
  });
  ["#operation-search-from", "#operation-search-to", "#operation-search-client", "#operation-search-type", "#operation-search-category", "#operation-search-text"].forEach((selector) => {
    $(selector).addEventListener("change", renderOperationSearch);
  });
  $("#commissionist-load").addEventListener("click", loadCommissionistOperations);
  $("#commissionist-generate").addEventListener("click", generateCommissionistMovement);
  $("#commissionist-percent").addEventListener("input", renderCommissionistRows);
  $("#commissionist-client").addEventListener("input", renderCommissionistStatus);
  $("#commissionist-client").addEventListener("change", renderCommissionistStatus);
  $("#commissionist-body").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-commissionist-row]");
    if (!checkbox) return;
    const row = state.commissionistRows.find((item) => String(item.id) === String(checkbox.dataset.commissionistRow));
    if (row) row.selected = checkbox.checked;
    renderCommissionistRows();
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
    if (label) {
      const mode = $("#cc-view-mode").value;
      label.childNodes[0].nodeValue = mode === "CONSIGNATARIA" ? "Buscar consignataria" : mode === "COMISIONISTA" ? "Buscar comisionista" : "Buscar cliente";
    }
    renderCuentaCorriente();
  });
  $("#cc-status-filter").addEventListener("change", renderCuentaCorriente);
  $("#cc-concept-filter").addEventListener("change", renderCuentaCorriente);
  $("#cc-due-filter").addEventListener("change", renderCuentaCorriente);
  $("#cc-date-from").addEventListener("change", renderCuentaCorriente);
  $("#cc-date-to").addEventListener("change", renderCuentaCorriente);
  $("#cc-print-report").addEventListener("click", () => printCurrentAccountReport());
  $("#cc-print-due-report").addEventListener("click", printCurrentAccountDueReport);
  $("#cc-export-calendar").addEventListener("click", exportCurrentAccountCalendar);
  $("#cc-calendar-range").addEventListener("change", () => {
    const mode = $("#cc-calendar-range").value;
    const range = calendarRangeDates();
    if (mode !== "CUSTOM") {
      $("#cc-calendar-from").value = range.from ? dateToInputValue(range.from) : "";
      $("#cc-calendar-to").value = range.to ? dateToInputValue(range.to) : "";
    }
  });
  $("#dashboard-print-next7").addEventListener("click", () => printCurrentAccountDueReport({ range: "NEXT_7", all: true }));
  $("#dashboard-print-next-week").addEventListener("click", () => printCurrentAccountDueReport({ range: "NEXT_WEEK", all: true }));
  $("#cash-form").addEventListener("submit", saveCashMovement);
  $("#cash-clear").addEventListener("click", resetCashForm);
  $("#cash-print").addEventListener("click", printCashReport);
  $("#cash-amount").addEventListener("focus", (event) => unformatMoneyInput(event.target));
  $("#cash-amount").addEventListener("blur", (event) => formatMoneyInput(event.target));
  $all("[data-cash-tab]").forEach((button) => {
    button.addEventListener("click", () => setCashTab(button.dataset.cashTab));
  });
  $("#cash-rec-form").addEventListener("submit", saveCashReconciliation);
  $("#cash-rec-clear").addEventListener("click", resetCashReconciliationForm);
  $("#cash-rec-amount").addEventListener("focus", (event) => unformatMoneyInput(event.target));
  $("#cash-rec-amount").addEventListener("blur", (event) => {
    formatMoneyInput(event.target);
    renderCashReconciliationBreakdown();
    renderCashReconciliationApplications();
  });
  $("#cash-rec-break-amount").addEventListener("focus", (event) => unformatMoneyInput(event.target));
  $("#cash-rec-break-amount").addEventListener("blur", (event) => formatMoneyInput(event.target));
  $("#cash-rec-break-add").addEventListener("click", addCashReconciliationBreakdown);
  $("#cash-rec-app-amount").addEventListener("focus", (event) => unformatMoneyInput(event.target));
  $("#cash-rec-app-amount").addEventListener("blur", (event) => formatMoneyInput(event.target));
  $("#cash-rec-app-add").addEventListener("click", addCashReconciliationApplication);
  $("#cash-rec-pay-amount").addEventListener("focus", (event) => unformatMoneyInput(event.target));
  $("#cash-rec-pay-amount").addEventListener("blur", (event) => formatMoneyInput(event.target));
  $("#cash-rec-pay-save").addEventListener("click", applyCashReconciliationPayment);
  $("#cash-rec-print").addEventListener("click", () => printCashReconciliationReport());
  $("#cash-rec-app-body").addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-cash-rec-app-remove]");
    if (!removeButton) return;
    cashReconciliationApplications = cashReconciliationApplications.filter((item) => item.id !== removeButton.dataset.cashRecAppRemove);
    renderCashReconciliationApplications();
  });
  $("#cash-rec-break-body").addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-cash-rec-break-remove]");
    if (!removeButton) return;
    cashReconciliationBreakdown = cashReconciliationBreakdown.filter((item) => item.id !== removeButton.dataset.cashRecBreakRemove);
    renderCashReconciliationBreakdown();
  });
  $("#cash-rec-body").addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-cash-rec-edit]");
    const deleteButton = event.target.closest("[data-cash-rec-delete]");
    const printButton = event.target.closest("[data-cash-rec-print]");
    if (printButton) printCashReconciliationReport(printButton.dataset.cashRecPrint);
    if (editButton) {
      const item = (state.cajaConciliaciones.items || []).find((row) => row.id === editButton.dataset.cashRecEdit);
      if (item) fillCashReconciliationForm(item);
    }
    if (deleteButton) deleteCashReconciliation(deleteButton.dataset.cashRecDelete);
  });
  $("#cash-body").addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-cash-edit]");
    const deleteButton = event.target.closest("[data-cash-delete]");
    if (editButton) {
      const item = (state.caja.items || []).find((row) => row.id === editButton.dataset.cashEdit);
      if (item) fillCashForm(item);
    }
    if (deleteButton) deleteCashMovement(deleteButton.dataset.cashDelete);
  });
  $("#document-form").addEventListener("submit", saveDocument);
  $("#document-clear").addEventListener("click", resetDocumentForm);
  $("#document-show-all").addEventListener("click", () => {
    documentFilterIds = [];
    clearDocumentPreview();
    renderDocumentos();
    setDocumentMessage("");
  });
  $("#document-body").addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-document-view]");
    if (viewButton) {
      showDocumentPreview(viewButton.dataset.documentView);
      return;
    }
    const deleteButton = event.target.closest("[data-document-delete]");
    if (deleteButton) deleteDocument(deleteButton.dataset.documentDelete);
  });
  $("#cc-open-external").addEventListener("click", () => openCurrentAccountPanel("#cc-external-panel"));
  $("#cc-close-external").addEventListener("click", () => {
    state.editingExternalMovementId = "";
    $("#cc-external-panel").hidden = true;
  });
  $("#cc-save-external").addEventListener("click", saveExternalCurrentAccountMovement);
  $("#cc-external-concept").addEventListener("change", syncExternalConceptFields);
  $("#cc-external-multiple-due").addEventListener("change", toggleExternalDuePanel);
  $("#cc-external-due-add").addEventListener("click", addExternalDueRow);
  $("#cc-external-due-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cc-remove-external-due]");
    if (!button) return;
    state.externalDueRows = state.externalDueRows.filter((item) => item.id !== button.dataset.ccRemoveExternalDue);
    renderExternalDueRows();
  });
  $("#cc-external-amount").addEventListener("input", renderExternalDueRows);
  $("#cc-external-mag-net").addEventListener("input", renderExternalDueRows);
  $("#cc-external-mag-iva").addEventListener("input", renderExternalDueRows);
  $("#cc-external-commission-base").addEventListener("input", syncExternalCommissionAmount);
  $("#cc-external-commission-percent").addEventListener("input", syncExternalCommissionAmount);
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
  $("#cc-discount-only").addEventListener("change", refreshPrimaryImputationSummary);
  $("#cc-counterparty-body").addEventListener("change", (event) => {
    if (event.target.matches("[data-cc-counterparty-impute]")) refreshCounterpartyImputationSummary();
  });
  $("#cc-movements-body").addEventListener("click", async (event) => {
    const attachDocumentButton = event.target.closest("[data-document-attach]");
    if (attachDocumentButton) {
      fillDocumentFormFromMovement(JSON.parse(decodeURIComponent(attachDocumentButton.dataset.documentAttach)));
      return;
    }
    const listDocumentButton = event.target.closest("[data-document-list]");
    if (listDocumentButton) {
      openDocumentsForMovement(JSON.parse(decodeURIComponent(listDocumentButton.dataset.documentList)));
      return;
    }
    const receiptButton = event.target.closest("[data-cc-payment-receipt]");
    if (receiptButton) {
      const payment = (state.cuenta.pagos || []).find((item) => item.id === receiptButton.dataset.ccPaymentReceipt);
      if (payment) printCurrentAccountReceipt(payment);
      return;
    }
    const printPaymentButton = event.target.closest("[data-cc-payment-print]");
    if (printPaymentButton) {
      const payment = (state.cuenta.pagos || []).find((item) => item.id === printPaymentButton.dataset.ccPaymentPrint);
      if (payment) printCurrentAccountReceipt(payment, true);
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
    if (reportButton) {
      setView("operaciones");
      await openSale(reportButton.dataset.ccOperationReport, "report");
      return;
    }
    const editExternalButton = event.target.closest("[data-cc-edit-external]");
    if (editExternalButton) {
      openExternalMovementEdit(editExternalButton.dataset.ccEditExternal);
      return;
    }
    const deleteExternalButton = event.target.closest("[data-cc-delete-external]");
    if (deleteExternalButton) {
      const confirmed = window.confirm("Se eliminara este movimiento externo. Si es Venta MAG, tambien se elimina su renglon asociado. ¿Continuar?");
      if (!confirmed) return;
      await fetchJson(`/api/cuenta-corriente/movimientos-externos/${encodeURIComponent(deleteExternalButton.dataset.ccDeleteExternal)}`, { method: "DELETE" });
      await reloadCurrentAccount();
    }
  });
  $("#cc-due-body").addEventListener("click", (event) => {
    const editExternalButton = event.target.closest("[data-cc-edit-external]");
    if (editExternalButton) {
      openExternalMovementEdit(editExternalButton.dataset.ccEditExternal);
      return;
    }
    const deleteExternalButton = event.target.closest("[data-cc-delete-external]");
    if (deleteExternalButton) {
      const confirmed = window.confirm("Se eliminara este movimiento externo. Si es Venta MAG, tambien se elimina su renglon asociado. ¿Continuar?");
      if (!confirmed) return;
      fetchJson(`/api/cuenta-corriente/movimientos-externos/${encodeURIComponent(deleteExternalButton.dataset.ccDeleteExternal)}`, { method: "DELETE" })
        .then(reloadCurrentAccount)
        .catch((error) => window.alert(error.message));
    }
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
  $("#sale-line-cancel-edit").addEventListener("click", () => {
    resetSaleLineForm();
    setSaleMessage("Edicion cancelada.");
  });
  $("#sale-lines-body").addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-sale-line]");
    if (editButton) {
      const line = (state.currentOperation && state.currentOperation.saleLines || [])
        .find((item) => String(item.id) === String(editButton.dataset.editSaleLine));
      if (line) fillSaleLineForm(line);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-sale-line]");
    if (deleteButton) deleteSaleLine(deleteButton.dataset.deleteSaleLine);
  });
  $("#partial-save").addEventListener("click", savePartialBilling);
  $("#partial-date").addEventListener("change", () => {
    if (!$("#partial-due").value) $("#partial-due").value = $("#partial-date").value;
  });
  $("#partial-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-partial-delete]");
    if (button) deletePartialBilling(button.dataset.partialDelete);
  });
  $("#liquidation-form").addEventListener("submit", saveLiquidation);
  $("#sale-buyer-different").addEventListener("change", syncBuyerDiff);
  $("#sale-buyer-different-faena").addEventListener("change", syncBuyerDiff);
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
    state.liquidationFacturadoTouched = true;
    syncAutomaticLiquidationIva();
    syncLiquidationCashFromFacturado();
    renderLiquidationDetail(buildDetailFromSaleLines());
    renderLiquidationTotals();
  });
  $("#frigo-neto-final").addEventListener("input", () => {
    if (!state.frigoBrutoSinIvaTouched && document.activeElement !== $("#frigo-bruto-sin-iva")) {
      const netoFinal = numberValue("#frigo-neto-final");
      setMoneyInput("#frigo-bruto-sin-iva", netoFinal ? netoFinal / 1.105 : 0);
    }
    syncLiquidationCashFromFacturado();
    renderLiquidationTotals();
  });
  $("#frigo-bruto-sin-iva").addEventListener("input", () => {
    state.frigoBrutoSinIvaTouched = String($("#frigo-bruto-sin-iva").value || "").trim() !== "";
    if (!state.frigoBrutoSinIvaTouched) {
      const netoFinal = numberValue("#frigo-neto-final");
      setMoneyInput("#frigo-bruto-sin-iva", netoFinal ? netoFinal / 1.105 : 0);
    }
    syncLiquidationCashFromFacturado();
    renderLiquidationTotals();
  });
  $all("#liquidation-form select").forEach((select) => {
    select.addEventListener("change", renderLiquidationTotals);
  });
  $("#liq-direct-no-iva").addEventListener("change", () => {
    state.liquidationIvaProdTouched = false;
    state.liquidationIvaCompTouched = false;
    syncAutomaticLiquidationIva();
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
    state.liquidationIvaProdTouched = true;
    syncLiquidationReceipts("prod");
    if (isFrigorificoIvaOperation()) syncLiquidationCashFromFacturado();
  });
  $("#liq-iva-comp").addEventListener("input", () => {
    state.liquidationIvaCompTouched = true;
    syncLiquidationReceipts("comp");
    if (isFrigorificoIvaOperation()) syncLiquidationCashFromFacturado();
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
  $("#client-merge").addEventListener("click", applyClientMaintenance);
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
  $("#operation-search-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-operation-search]");
    if (!button) return;
    setView("operaciones");
    openSale(button.dataset.openOperationSearch);
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
  $("#print-report").addEventListener("click", printReportSheet);
  $("#report-control-mode").addEventListener("click", () => {
    state.reportMode = "control";
    renderReport();
  });
  $("#report-final-mode").addEventListener("click", () => {
    state.reportMode = "final";
    renderReport();
  });
  $("#report-sheet").addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-party-pdf]");
    if (button) printReportParty(button.dataset.reportPartyPdf);
  });

  const health = await fetchJson("/api/health");
  $("#status").textContent = health.modo === "postgres" ? "PostgreSQL conectado" : "Backup local";

  await reloadAppData();
  setSelectOptions("#operation-renspa-origin-select", [], "Elegir RENSPA origen");
  setSelectOptions("#operation-renspa-destination-select", [], "Elegir RENSPA destino");
  $("#operation-date").value = new Date().toISOString().slice(0, 10);
  $("#operation-load-date").value = $("#operation-date").value;
  const today = new Date().toISOString().slice(0, 10);
  $("#dashboard-period-from").value = today.slice(0, 8) + "01";
  $("#dashboard-period-to").value = today;
  $("#operation-search-from").value = today.slice(0, 8) + "01";
  $("#operation-search-to").value = today;
  $("#cash-rec-report-from").value = today.slice(0, 8) + "01";
  $("#cash-rec-report-to").value = today;
  $("#cc-calendar-from").value = dateToInputValue(new Date());
  $("#cc-calendar-to").value = dateToInputValue(addDateDays(new Date(), 7));
  $("#real-commission-from").value = today.slice(0, 8) + "01";
  $("#real-commission-to").value = today;
  $("#commissionist-from").value = today.slice(0, 8) + "01";
  $("#commissionist-to").value = today;
  $("#commissionist-due").value = today;
  renderOperationSearch();
  renderRealCommissionSummary();
  renderCommissionistStatus();
  resetCashForm();
  resetCashReconciliationForm();
  setCashTab("diaria");
  syncOperationType();
  setOperationModeNew();
  showOperationWorkspace();
  setOperationStep("operation");
  setView(preferredInitialView());
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
