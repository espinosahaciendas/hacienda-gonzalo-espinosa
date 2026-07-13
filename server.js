const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { createDataSource } = require("./data-source");

const PORT = Number(process.env.PORT || 4100);
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "1";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const BACKUP_DOWNLOAD_ENABLED = process.env.BACKUP_DOWNLOAD_ENABLED === "1";
const CONSULTA_DOCUMENTS_ENABLED = process.env.CONSULTA_DOCUMENTS_ENABLED === "1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const LOCAL_DOCUMENTS_DIR = path.join(ROOT, "data", "documentos");
assertProductionConfig();
const dataSource = createDataSource();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendJsonDownload(res, filename, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(200, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendBinaryDownload(res, filename, mimeType, content) {
  res.writeHead(200, {
    ...securityHeaders(),
    "Content-Type": mimeType || "application/octet-stream",
    "Content-Disposition": `inline; filename="${String(filename || "documento.pdf").replace(/"/g, "")}"`,
    "Content-Length": Buffer.byteLength(content)
  });
  res.end(content);
}

function parseCookies(req) {
  return String(req.headers.cookie || "").split(";").reduce((result, item) => {
    const index = item.indexOf("=");
    if (index < 0) return result;
    result[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
    return result;
  }, {});
}

function setSessionCookie(res, token, maxAge = 43200) {
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `hacienda_session=${encodeURIComponent(token || "")}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}

function assertProductionConfig() {
  if (!IS_PRODUCTION) return;
  const missing = [];
  if (process.env.AUTH_REQUIRED !== "1") missing.push("AUTH_REQUIRED=1");
  if (process.env.COOKIE_SECURE !== "1") missing.push("COOKIE_SECURE=1");
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new Error(`Configuracion insegura de produccion. Falta: ${missing.join(", ")}`);
  }
}

function securityHeaders() {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
  if (IS_PRODUCTION) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

function userCanReadDocuments(session) {
  if (!session) return false;
  if (session.rol === "ADMIN") return true;
  return session.rol === "CONSULTA" && CONSULTA_DOCUMENTS_ENABLED;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("El pedido es demasiado grande."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("JSON invalido."));
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req, limit = 25_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (chunk) => {
      length += chunk.length;
      if (length > limit) {
        reject(new Error("El archivo es demasiado grande. Maximo permitido: 25 MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);
  while (index >= 0) {
    parts.push(buffer.slice(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

async function parseMultipartForm(req) {
  const contentType = req.headers["content-type"] || "";
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    const error = new Error("Formato de carga invalido.");
    error.statusCode = 400;
    throw error;
  }
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const raw = await readRawBody(req);
  const fields = {};
  const files = {};
  splitBuffer(raw, boundary).forEach((part) => {
    let chunk = part;
    if (chunk.slice(0, 2).toString() === "\r\n") chunk = chunk.slice(2);
    if (!chunk.length || chunk.toString("utf8", 0, 2) === "--") return;
    const headerEnd = chunk.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) return;
    const headerText = chunk.slice(0, headerEnd).toString("utf8");
    let content = chunk.slice(headerEnd + 4);
    if (content.slice(-2).toString() === "\r\n") content = content.slice(0, -2);
    const name = (headerText.match(/name="([^"]+)"/) || [])[1];
    if (!name) return;
    const filename = (headerText.match(/filename="([^"]*)"/) || [])[1];
    const type = (headerText.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || "application/octet-stream";
    if (filename !== undefined && filename !== "") {
      files[name] = { filename, mimeType: type.trim(), content };
    } else {
      fields[name] = content.toString("utf8");
    }
  });
  return { fields, files };
}

function storageConfig() {
  return {
    provider: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE" : "LOCAL",
    url: String(process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "comprobantes"
  };
}

function storagePathEncode(value) {
  return String(value || "").split("/").map(encodeURIComponent).join("/");
}

function safeFileName(value) {
  return String(value || "documento.pdf")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "documento.pdf";
}

function documentStoragePath(fields, id, filename) {
  const year = new Date().getFullYear();
  const entityType = safeFileName(fields.entidadTipo || "general").toLowerCase();
  const entityId = safeFileName(fields.entidadId || fields.operacion || fields.movimientoId || "sin-referencia");
  return `${year}/${entityType}/${entityId}/${id}-${safeFileName(filename)}`;
}

async function uploadDocumentFile(storagePath, file) {
  const config = storageConfig();
  if (config.provider === "SUPABASE") {
    const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${storagePathEncode(storagePath)}`, {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": file.mimeType || "application/pdf",
        "x-upsert": "false"
      },
      body: file.content
    });
    if (!response.ok) throw new Error(`No se pudo subir el PDF a Supabase Storage: ${await response.text()}`);
    return { provider: config.provider, bucket: config.bucket, path: storagePath };
  }
  const localPath = path.join(LOCAL_DOCUMENTS_DIR, storagePath);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, file.content);
  return { provider: config.provider, bucket: "local", path: storagePath };
}

async function downloadDocumentFile(documento) {
  if (documento.storageProvider === "SUPABASE") {
    const config = storageConfig();
    const response = await fetch(`${config.url}/storage/v1/object/${documento.storageBucket}/${storagePathEncode(documento.storagePath)}`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`
      }
    });
    if (!response.ok) throw new Error(`No se pudo leer el PDF original: ${await response.text()}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return fs.readFileSync(path.join(LOCAL_DOCUMENTS_DIR, documento.storagePath));
}

async function exportBackupWithDocumentFiles() {
  const backup = await dataSource.exportBackup();
  const documentos = Array.isArray(backup.documentos) ? backup.documentos : [];
  const archivos = [];
  for (const documento of documentos) {
    try {
      const content = await downloadDocumentFile(documento);
      archivos.push({
        id: documento.id,
        nombreOriginal: documento.nombreOriginal,
        mimeType: documento.mimeType,
        storageProvider: documento.storageProvider,
        storageBucket: documento.storageBucket,
        storagePath: documento.storagePath,
        base64: content.toString("base64")
      });
    } catch (error) {
      archivos.push({
        id: documento.id,
        nombreOriginal: documento.nombreOriginal,
        storageProvider: documento.storageProvider,
        storageBucket: documento.storageBucket,
        storagePath: documento.storagePath,
        error: error.message
      });
    }
  }
  return {
    ...backup,
    documentosIncluidos: true,
    documentosArchivos: archivos,
    documentosCantidad: documentos.length,
    documentosArchivosIncluidos: archivos.filter((item) => item.base64).length
  };
}

async function deleteDocumentFile(documento) {
  if (!documento) return;
  if (documento.storageProvider === "SUPABASE") {
    const config = storageConfig();
    await fetch(`${config.url}/storage/v1/object/${documento.storageBucket}`, {
      method: "DELETE",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prefixes: [documento.storagePath] })
    });
    return;
  }
  fs.rmSync(path.join(LOCAL_DOCUMENTS_DIR, documento.storagePath), { force: true });
}

function sendStatic(req, res) {
  const parsed = url.parse(req.url);
  const safePath = parsed.pathname === "/" ? "/index.html" : decodeURIComponent(parsed.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Ruta no permitida" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "Archivo no encontrado" });
      return;
    }
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": type,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    res.end(content);
  });
}

async function handleApi(req, res) {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === "/api" || parsed.pathname === "/api/") {
    sendJson(res, 200, {
      ok: true,
      mensaje: "La API esta funcionando. Para usar el sistema abrir http://localhost:4100",
      rutas: [
        "/api/health",
        "/api/clientes",
        "/api/operaciones",
        "/api/categorias",
        "/api/tabs",
        "/api/cuenta-corriente/resumen",
        "/api/caja-diaria",
        "/api/caja-conciliaciones",
        "/api/documentos",
        "/api/campos/contratos",
        "/api/campos/arrendamientos"
      ]
    });
    return;
  }

  if (parsed.pathname === "/api/health") {
    sendJson(res, 200, await dataSource.health());
    return;
  }

  if (parsed.pathname === "/api/auth/login" && req.method === "POST") {
    if (!AUTH_REQUIRED) {
      sendJson(res, 200, { usuario: { nombre: "Modo local", email: "", rol: "ADMIN" } });
      return;
    }
    const body = await readBody(req);
    const session = await dataSource.createSession(body.email, body.password);
    if (!session) {
      sendJson(res, 401, { error: "Correo o contraseña incorrectos." });
      return;
    }
    setSessionCookie(res, session.token);
    sendJson(res, 200, { usuario: session.usuario });
    return;
  }

  if (parsed.pathname === "/api/auth/logout" && req.method === "POST") {
    const token = parseCookies(req).hacienda_session;
    if (AUTH_REQUIRED) await dataSource.deleteSession(token);
    setSessionCookie(res, "", 0);
    sendJson(res, 200, { ok: true });
    return;
  }

  const session = AUTH_REQUIRED
    ? await dataSource.getSession(parseCookies(req).hacienda_session)
    : { nombre: "Modo local", email: "", rol: "ADMIN" };

  if (parsed.pathname === "/api/auth/session") {
    if (!session) {
      sendJson(res, 401, { error: "Debe iniciar sesión." });
      return;
    }
    sendJson(res, 200, { usuario: session });
    return;
  }

  if (!session) {
    sendJson(res, 401, { error: "Debe iniciar sesión." });
    return;
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && session.rol !== "ADMIN") {
    sendJson(res, 403, { error: "Este usuario tiene acceso de solo consulta." });
    return;
  }

  if (parsed.pathname === "/api/backup/download" && req.method === "GET") {
    if (session.rol !== "ADMIN") {
      sendJson(res, 403, { error: "Solo un usuario administrador puede descargar backups." });
      return;
    }
    if (IS_PRODUCTION && !BACKUP_DOWNLOAD_ENABLED) {
      sendJson(res, 403, { error: "La descarga de backups completos esta deshabilitada por seguridad." });
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    sendJsonDownload(res, `backup-completo-hacienda-gonzalo-espinosa-${stamp}.json`, await exportBackupWithDocumentFiles());
    return;
  }

  if (parsed.pathname === "/api/clientes") {
    if (req.method === "GET") {
      sendJson(res, 200, { items: await dataSource.getClientes() });
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, { item: await dataSource.saveCliente(body) });
      return;
    }
  }

  const clienteMatch = parsed.pathname.match(/^\/api\/clientes\/([^/]+)$/);
  if (clienteMatch) {
    if (req.method === "PUT") {
      const body = await readBody(req);
      sendJson(res, 200, { item: await dataSource.saveCliente({ ...body, id: decodeURIComponent(clienteMatch[1]) }) });
      return;
    }
    if (req.method === "DELETE") {
      sendJson(res, 200, { item: await dataSource.deleteCliente(decodeURIComponent(clienteMatch[1])) });
      return;
    }
  }

  const clienteMergeMatch = parsed.pathname.match(/^\/api\/clientes\/([^/]+)\/fusionar$/);
  if (clienteMergeMatch && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, { item: await dataSource.mergeCliente(decodeURIComponent(clienteMergeMatch[1]), body) });
    return;
  }

  const establecimientosMatch = parsed.pathname.match(/^\/api\/clientes\/([^/]+)\/establecimientos$/);
  if (establecimientosMatch) {
    const clienteId = decodeURIComponent(establecimientosMatch[1]);
    if (req.method === "GET") {
      sendJson(res, 200, { items: await dataSource.getEstablecimientos(clienteId) });
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, { item: await dataSource.saveEstablecimiento(clienteId, body) });
      return;
    }
    return;
  }

  if (parsed.pathname === "/api/campos/contratos") {
    if (req.method === "GET") {
      sendJson(res, 200, { items: await dataSource.getFieldContracts() });
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const item = await dataSource.saveFieldContract(body);
      sendJson(res, 200, { item, items: await dataSource.getFieldContracts() });
      return;
    }
  }

  const fieldContractMatch = parsed.pathname.match(/^\/api\/campos\/contratos\/([^/]+)$/);
  if (fieldContractMatch && req.method === "DELETE") {
    await dataSource.deleteFieldContract(decodeURIComponent(fieldContractMatch[1]));
    sendJson(res, 200, { items: await dataSource.getFieldContracts() });
    return;
  }

  if (parsed.pathname === "/api/campos/arrendamientos") {
    if (req.method === "GET") {
      sendJson(res, 200, { items: await dataSource.getFieldLeases() });
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const item = await dataSource.saveFieldLease(body);
      sendJson(res, 200, { item, items: await dataSource.getFieldLeases() });
      return;
    }
  }

  const fieldLeaseMatch = parsed.pathname.match(/^\/api\/campos\/arrendamientos\/([^/]+)$/);
  if (fieldLeaseMatch && req.method === "DELETE") {
    await dataSource.deleteFieldLease(decodeURIComponent(fieldLeaseMatch[1]));
    sendJson(res, 200, { items: await dataSource.getFieldLeases() });
    return;
  }

  if (parsed.pathname === "/api/operaciones") {
    if (req.method === "GET") {
      sendJson(res, 200, { items: await dataSource.getOperaciones() });
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, { item: await dataSource.saveOperacion(body) });
      return;
    }
    return;
  }

  if (parsed.pathname === "/api/categorias" && req.method === "GET") {
    sendJson(res, 200, { items: await dataSource.getCategorias() });
    return;
  }

  const categoriaMatch = parsed.pathname.match(/^\/api\/categorias\/([^/]+)$/);
  if (categoriaMatch) {
    const categoria = decodeURIComponent(categoriaMatch[1]);
    if (req.method === "PUT") {
      const body = await readBody(req);
      sendJson(res, 200, { item: await dataSource.saveCategoria(categoria, body) });
      return;
    }
    if (req.method === "DELETE") {
      sendJson(res, 200, { item: await dataSource.deleteCategoria(categoria) });
      return;
    }
  }

  if (parsed.pathname === "/api/tabs") {
    if (req.method === "GET") {
      sendJson(res, 200, { items: await dataSource.getTabRules() });
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, { item: await dataSource.saveTabRule(body) });
      return;
    }
  }

  const operacionDetalleMatch = parsed.pathname.match(/^\/api\/operaciones\/([^/]+)$/);
  if (operacionDetalleMatch && req.method === "GET") {
    sendJson(res, 200, { item: await dataSource.getOperacionDetalle(decodeURIComponent(operacionDetalleMatch[1])) });
    return;
  }

  const ventaLineaMatch = parsed.pathname.match(/^\/api\/operaciones\/([^/]+)\/venta-lineas$/);
  if (ventaLineaMatch && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, { item: await dataSource.saveVentaLinea(decodeURIComponent(ventaLineaMatch[1]), body) });
    return;
  }

  const ventaLineaItemMatch = parsed.pathname.match(/^\/api\/operaciones\/([^/]+)\/venta-lineas\/([^/]+)$/);
  if (ventaLineaItemMatch && req.method === "PUT") {
    const body = await readBody(req);
    sendJson(res, 200, {
      item: await dataSource.updateVentaLinea(
        decodeURIComponent(ventaLineaItemMatch[1]),
        decodeURIComponent(ventaLineaItemMatch[2]),
        body
      )
    });
    return;
  }
  if (ventaLineaItemMatch && req.method === "DELETE") {
    sendJson(res, 200, {
      item: await dataSource.deleteVentaLinea(
        decodeURIComponent(ventaLineaItemMatch[1]),
        decodeURIComponent(ventaLineaItemMatch[2])
      )
    });
    return;
  }

  const facturacionParcialMatch = parsed.pathname.match(/^\/api\/operaciones\/([^/]+)\/facturacion-parcial$/);
  if (facturacionParcialMatch && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, { item: await dataSource.saveFacturacionParcial(decodeURIComponent(facturacionParcialMatch[1]), body) });
    return;
  }

  const facturacionParcialItemMatch = parsed.pathname.match(/^\/api\/operaciones\/([^/]+)\/facturacion-parcial\/([^/]+)$/);
  if (facturacionParcialItemMatch && req.method === "DELETE") {
    sendJson(res, 200, {
      item: await dataSource.deleteFacturacionParcial(
        decodeURIComponent(facturacionParcialItemMatch[1]),
        decodeURIComponent(facturacionParcialItemMatch[2])
      )
    });
    return;
  }

  const liquidacionMatch = parsed.pathname.match(/^\/api\/operaciones\/([^/]+)\/liquidacion$/);
  if (liquidacionMatch && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, { item: await dataSource.saveLiquidacion(decodeURIComponent(liquidacionMatch[1]), body) });
    return;
  }

  if (parsed.pathname === "/api/cuenta-corriente/resumen") {
    sendJson(res, 200, await dataSource.getCuentaCorrienteResumen());
    return;
  }

  if (parsed.pathname === "/api/comisionistas/facturas" && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, { item: await dataSource.saveCommissionInvoice(body) });
    return;
  }

  if (parsed.pathname === "/api/caja-diaria") {
    if (req.method === "GET") {
      sendJson(res, 200, await dataSource.getCajaDiaria());
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, { item: await dataSource.saveCajaDiaria(body) });
      return;
    }
  }

  const cajaDiariaMatch = parsed.pathname.match(/^\/api\/caja-diaria\/([^/]+)$/);
  if (cajaDiariaMatch) {
    if (req.method === "PUT") {
      const body = await readBody(req);
      sendJson(res, 200, { item: await dataSource.saveCajaDiaria({ ...body, id: decodeURIComponent(cajaDiariaMatch[1]) }) });
      return;
    }
    if (req.method === "DELETE") {
      sendJson(res, 200, { item: await dataSource.deleteCajaDiaria(decodeURIComponent(cajaDiariaMatch[1])) });
      return;
    }
  }

  if (parsed.pathname === "/api/caja-conciliaciones") {
    if (req.method === "GET") {
      sendJson(res, 200, await dataSource.getCajaConciliaciones());
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, { item: await dataSource.saveCajaConciliacion(body) });
      return;
    }
  }

  if (parsed.pathname === "/api/caja-conciliaciones/aplicar-pago" && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, { item: await dataSource.applyCajaConciliacionPago(body) });
    return;
  }

  const cajaConciliacionMatch = parsed.pathname.match(/^\/api\/caja-conciliaciones\/([^/]+)$/);
  if (cajaConciliacionMatch) {
    if (req.method === "PUT") {
      const body = await readBody(req);
      sendJson(res, 200, { item: await dataSource.saveCajaConciliacion({ ...body, id: decodeURIComponent(cajaConciliacionMatch[1]) }) });
      return;
    }
    if (req.method === "DELETE") {
      sendJson(res, 200, { item: await dataSource.deleteCajaConciliacion(decodeURIComponent(cajaConciliacionMatch[1])) });
      return;
    }
  }

  if (parsed.pathname === "/api/documentos") {
    if (req.method === "GET") {
      if (!userCanReadDocuments(session)) {
        sendJson(res, 403, { error: "No tiene permiso para consultar documentos." });
        return;
      }
      sendJson(res, 200, { items: await dataSource.getDocumentos(parsed.query) });
      return;
    }
    if (req.method === "POST") {
      const { fields, files } = await parseMultipartForm(req);
      const file = files.archivo;
      if (!file || !file.content.length) {
        sendJson(res, 400, { error: "Falta seleccionar un PDF." });
        return;
      }
      if (file.mimeType !== "application/pdf" && !String(file.filename || "").toLowerCase().endsWith(".pdf")) {
        sendJson(res, 400, { error: "Solo se admiten archivos PDF." });
        return;
      }
      if (file.content.subarray(0, 5).toString("utf8") !== "%PDF-") {
        sendJson(res, 400, { error: "El archivo seleccionado no parece ser un PDF valido." });
        return;
      }
      const id = `DOC-${Date.now()}`;
      const storagePath = documentStoragePath(fields, id, file.filename);
      const stored = await uploadDocumentFile(storagePath, file);
      const item = await dataSource.saveDocumento({
        id,
        ...fields,
        nombreOriginal: file.filename,
        mimeType: file.mimeType,
        bytes: file.content.length,
        storageProvider: stored.provider,
        storageBucket: stored.bucket,
        storagePath: stored.path
      });
      sendJson(res, 200, { item });
      return;
    }
  }

  const documentoDownloadMatch = parsed.pathname.match(/^\/api\/documentos\/([^/]+)\/descargar$/);
  if (documentoDownloadMatch && req.method === "GET") {
    if (!userCanReadDocuments(session)) {
      sendJson(res, 403, { error: "No tiene permiso para descargar documentos." });
      return;
    }
    const documento = await dataSource.getDocumento(decodeURIComponent(documentoDownloadMatch[1]));
    if (!documento) {
      sendJson(res, 404, { error: "No se encontro el documento." });
      return;
    }
    const content = await downloadDocumentFile(documento);
    sendBinaryDownload(res, documento.nombreOriginal || `${documento.id}.pdf`, documento.mimeType || "application/pdf", content);
    return;
  }

  const documentoMatch = parsed.pathname.match(/^\/api\/documentos\/([^/]+)$/);
  if (documentoMatch && req.method === "DELETE") {
    const documento = await dataSource.getDocumento(decodeURIComponent(documentoMatch[1]));
    await deleteDocumentFile(documento);
    sendJson(res, 200, { item: await dataSource.deleteDocumento(decodeURIComponent(documentoMatch[1])) });
    return;
  }

  if (parsed.pathname === "/api/cuenta-corriente/movimientos-externos" && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, { item: await dataSource.saveMovimientoExterno(body) });
    return;
  }

  const movimientoExternoMatch = parsed.pathname.match(/^\/api\/cuenta-corriente\/movimientos-externos\/([^/]+)$/);
  if (movimientoExternoMatch && req.method === "PUT") {
    const body = await readBody(req);
    sendJson(res, 200, { item: await dataSource.updateMovimientoExterno(decodeURIComponent(movimientoExternoMatch[1]), body) });
    return;
  }
  if (movimientoExternoMatch && req.method === "DELETE") {
    sendJson(res, 200, { item: await dataSource.deleteMovimientoExterno(decodeURIComponent(movimientoExternoMatch[1])) });
    return;
  }

  if (parsed.pathname === "/api/cuenta-corriente/pagos-cobros" && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, { item: await dataSource.savePagoCobro(body) });
    return;
  }

  const anularPagoCobroMatch = parsed.pathname.match(/^\/api\/cuenta-corriente\/pagos-cobros\/([^/]+)\/anular$/);
  if (anularPagoCobroMatch && req.method === "POST") {
    sendJson(res, 200, { item: await dataSource.anularPagoCobro(decodeURIComponent(anularPagoCobroMatch[1])) });
    return;
  }

  sendJson(res, 404, { error: "API no encontrada" });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((error) => {
      sendJson(res, error.statusCode || 500, { error: error.message || "Error interno", code: error.code || "ERROR" });
    });
    return;
  }

  sendStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Gonzalo Espinosa Hacienda listo en http://localhost:${PORT}`);
  console.log(`Modo de datos: ${dataSource.mode()}`);
});
