const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function encodeStoragePath(value) {
  return String(value || "").split("/").map(encodeURIComponent).join("/");
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("El backup no contiene un objeto de datos valido.");
  }
  const requiredArrays = ["clients", "operations", "currentAccountPayments", "currentAccountManualMovements"];
  requiredArrays.forEach((field) => {
    if (!Array.isArray(snapshot[field])) throw new Error(`El backup no contiene la coleccion ${field}.`);
  });
  return {
    clientes: snapshot.clients.length,
    operaciones: snapshot.operations.length,
    pagosCobros: snapshot.currentAccountPayments.length,
    movimientosExternos: snapshot.currentAccountManualMovements.length,
    contratosCampos: Array.isArray(snapshot.fieldContracts) ? snapshot.fieldContracts.length : 0,
    calculosCampos: Array.isArray(snapshot.fieldLeases) ? snapshot.fieldLeases.length : 0,
    documentos: Array.isArray(snapshot.documentos) ? snapshot.documentos.length : 0
  };
}

function createBackupAutomation({ dataSource, storageConfig, auditEvent = async () => {}, fetchImpl = fetch }) {
  const enabled = process.env.BACKUP_AUTOMATION_ENABLED === "1";
  const intervalHours = positiveInteger(process.env.BACKUP_INTERVAL_HOURS, 24);
  const retentionCount = positiveInteger(process.env.BACKUP_RETENTION_COUNT, 35);
  const restoreEveryDays = positiveInteger(process.env.BACKUP_RESTORE_TEST_DAYS, 7);
  const initialDelayMs = positiveInteger(process.env.BACKUP_INITIAL_DELAY_MS, 30_000);
  const state = {
    enabled,
    running: false,
    frequencyHours: intervalHours,
    retentionCount,
    restoreEveryDays,
    backupBucket: process.env.SUPABASE_BACKUP_BUCKET || "backups-hacienda",
    nextRunAt: "",
    lastRunAt: "",
    lastBackupAt: "",
    lastBackupPath: "",
    lastRestoreTestAt: "",
    lastRestoreTestOk: null,
    lastRestoreBackupPath: "",
    lastCounts: null,
    lastError: ""
  };
  let timer = null;

  function config() {
    const base = storageConfig();
    const secret = String(process.env.BACKUP_ENCRYPTION_KEY || "");
    if (base.provider !== "SUPABASE") throw new Error("El backup automatico requiere Supabase Storage.");
    if (!secret || secret.length < 32) throw new Error("Falta BACKUP_ENCRYPTION_KEY con al menos 32 caracteres.");
    return { ...base, bucket: state.backupBucket, secret };
  }

  function authHeaders(cfg, extra = {}) {
    return { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, ...extra };
  }

  async function ensureBucket(cfg) {
    const detail = await fetchImpl(`${cfg.url}/storage/v1/bucket/${encodeURIComponent(cfg.bucket)}`, {
      headers: authHeaders(cfg)
    });
    if (detail.ok) return;
    if (![400, 404].includes(detail.status)) throw new Error(`No se pudo consultar el bucket de backups (${detail.status}).`);
    const created = await fetchImpl(`${cfg.url}/storage/v1/bucket`, {
      method: "POST",
      headers: authHeaders(cfg, { "Content-Type": "application/json" }),
      body: JSON.stringify({ id: cfg.bucket, name: cfg.bucket, public: false })
    });
    if (!created.ok && created.status !== 409) {
      throw new Error(`No se pudo crear el bucket privado de backups (${created.status}).`);
    }
  }

  async function listObjects(cfg, prefix) {
    const response = await fetchImpl(`${cfg.url}/storage/v1/object/list/${encodeURIComponent(cfg.bucket)}`, {
      method: "POST",
      headers: authHeaders(cfg, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "desc" } })
    });
    if (!response.ok) throw new Error(`No se pudo listar el historial de backups (${response.status}).`);
    const items = await response.json();
    return (Array.isArray(items) ? items : [])
      .filter((item) => item && item.name && !String(item.name).endsWith(".emptyFolderPlaceholder"))
      .map((item) => ({ ...item, storagePath: String(item.name).startsWith(`${prefix}/`) ? item.name : `${prefix}/${item.name}` }))
      .sort((a, b) => String(b.name).localeCompare(String(a.name)));
  }

  async function uploadObject(cfg, storagePath, content, contentType = "application/octet-stream") {
    const response = await fetchImpl(`${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${encodeStoragePath(storagePath)}`, {
      method: "POST",
      headers: authHeaders(cfg, { "Content-Type": contentType, "x-upsert": "true" }),
      body: content
    });
    if (!response.ok) throw new Error(`No se pudo guardar ${storagePath} (${response.status}).`);
  }

  async function downloadObject(cfg, storagePath, optional = false) {
    const response = await fetchImpl(`${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${encodeStoragePath(storagePath)}`, {
      headers: authHeaders(cfg)
    });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`No se pudo descargar ${storagePath} (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }

  async function deleteObjects(cfg, storagePaths) {
    if (!storagePaths.length) return;
    const response = await fetchImpl(`${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}`, {
      method: "DELETE",
      headers: authHeaders(cfg, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: storagePaths })
    });
    if (!response.ok) throw new Error(`No se pudieron aplicar las reglas de retencion (${response.status}).`);
  }

  function encryptSnapshot(cfg, snapshot) {
    const createdAt = new Date().toISOString();
    const counts = validateSnapshot(snapshot);
    const payload = Buffer.from(JSON.stringify({ format: "hacienda-backup-v1", createdAt, counts, data: snapshot }), "utf8");
    const checksum = crypto.createHash("sha256").update(payload).digest("hex");
    const key = crypto.createHash("sha256").update(cfg.secret).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    return {
      counts,
      content: Buffer.from(JSON.stringify({
        format: "hacienda-encrypted-backup-v1",
        algorithm: "aes-256-gcm",
        createdAt,
        checksum,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: encrypted.toString("base64")
      }), "utf8")
    };
  }

  function decryptSnapshot(cfg, content) {
    const envelope = JSON.parse(content.toString("utf8"));
    if (envelope.format !== "hacienda-encrypted-backup-v1" || envelope.algorithm !== "aes-256-gcm") {
      throw new Error("El archivo no tiene el formato de backup cifrado esperado.");
    }
    const key = crypto.createHash("sha256").update(cfg.secret).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const payload = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
    const checksum = crypto.createHash("sha256").update(payload).digest("hex");
    if (checksum !== envelope.checksum) throw new Error("El checksum del backup no coincide.");
    const parsed = JSON.parse(payload.toString("utf8"));
    if (parsed.format !== "hacienda-backup-v1") throw new Error("El contenido restaurado no tiene el formato esperado.");
    return { snapshot: parsed.data, counts: validateSnapshot(parsed.data), checksum };
  }

  async function readRestoreMarker(cfg) {
    const content = await downloadObject(cfg, "verificaciones/ultima-restauracion.json", true);
    if (!content) return null;
    try {
      return JSON.parse(content.toString("utf8"));
    } catch (error) {
      return null;
    }
  }

  async function verifyRestore(cfg, backupPath) {
    const encrypted = await downloadObject(cfg, backupPath);
    const restored = decryptSnapshot(cfg, encrypted);
    const tempPath = path.join(os.tmpdir(), `hacienda-restore-test-${crypto.randomUUID()}.json`);
    try {
      fs.writeFileSync(tempPath, JSON.stringify(restored.snapshot), { encoding: "utf8", flag: "wx" });
      const reloaded = JSON.parse(fs.readFileSync(tempPath, "utf8"));
      const reloadedCounts = validateSnapshot(reloaded);
      if (JSON.stringify(reloadedCounts) !== JSON.stringify(restored.counts)) {
        throw new Error("Las cantidades restauradas no coinciden con el backup.");
      }
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
    const report = {
      ok: true,
      verifiedAt: new Date().toISOString(),
      backupPath,
      checksum: restored.checksum,
      counts: restored.counts
    };
    await uploadObject(cfg, "verificaciones/ultima-restauracion.json", Buffer.from(JSON.stringify(report, null, 2)), "application/json");
    return report;
  }

  async function runNow() {
    if (!enabled || state.running) return status();
    state.running = true;
    state.lastRunAt = new Date().toISOString();
    state.lastError = "";
    try {
      const cfg = config();
      await ensureBucket(cfg);
      let backups = await listObjects(cfg, "automaticos");
      const day = new Date().toISOString().slice(0, 10);
      let latest = backups.find((item) => String(item.name).includes(`backup-hacienda-${day}`));
      if (!latest) {
        const snapshot = await dataSource.exportBackup();
        const encrypted = encryptSnapshot(cfg, snapshot);
        const backupPath = `automaticos/backup-hacienda-${day}.json.enc`;
        await uploadObject(cfg, backupPath, encrypted.content, "application/json");
        state.lastBackupAt = new Date().toISOString();
        state.lastBackupPath = backupPath;
        state.lastCounts = encrypted.counts;
        await auditEvent("BACKUP_AUTOMATICO_OK", { backupPath, counts: encrypted.counts });
        backups = await listObjects(cfg, "automaticos");
        latest = backups.find((item) => item.storagePath === backupPath) || { storagePath: backupPath };
      } else {
        state.lastBackupPath = latest.storagePath;
      }

      await deleteObjects(cfg, backups.slice(retentionCount).map((item) => item.storagePath));

      const marker = await readRestoreMarker(cfg);
      const markerTime = marker?.verifiedAt ? new Date(marker.verifiedAt).getTime() : 0;
      if (!markerTime || markerTime < Date.now() - restoreEveryDays * DAY_MS) {
        const report = await verifyRestore(cfg, latest.storagePath);
        state.lastRestoreTestAt = report.verifiedAt;
        state.lastRestoreTestOk = true;
        state.lastRestoreBackupPath = report.backupPath;
        state.lastCounts = report.counts;
        await auditEvent("RESTAURACION_PRUEBA_OK", report);
      } else {
        state.lastRestoreTestAt = marker.verifiedAt;
        state.lastRestoreTestOk = Boolean(marker.ok);
        state.lastRestoreBackupPath = marker.backupPath || "";
        state.lastCounts = marker.counts || state.lastCounts;
      }
    } catch (error) {
      state.lastError = error.message;
      state.lastRestoreTestOk = false;
      console.error("BACKUP_AUTOMATION_ERROR", error);
      await auditEvent("BACKUP_AUTOMATICO_ERROR", { error: error.message }).catch(() => {});
    } finally {
      state.running = false;
    }
    return status();
  }

  function status() {
    return { ...state, lastCounts: state.lastCounts ? { ...state.lastCounts } : null };
  }

  function scheduleNext(delayMs) {
    state.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    timer = setTimeout(async () => {
      await runNow();
      scheduleNext(intervalHours * 60 * 60 * 1000);
    }, delayMs);
    timer.unref?.();
  }

  function start() {
    if (!enabled || timer) return;
    scheduleNext(initialDelayMs);
  }

  return { runNow, start, status };
}

module.exports = { createBackupAutomation, validateSnapshot };
