const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { createDataSource } = require("./data-source");

const PORT = Number(process.env.PORT || 4100);
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
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
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
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
    res.writeHead(200, { "Content-Type": type });
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
        "/api/cuenta-corriente/resumen"
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

  if (parsed.pathname === "/api/cuenta-corriente/movimientos-externos" && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, { item: await dataSource.saveMovimientoExterno(body) });
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
