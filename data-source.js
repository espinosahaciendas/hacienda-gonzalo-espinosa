const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_BACKUP_PATH = path.join(__dirname, "..", "database", "backup-gonzalo-espinosa-2026-05-29.json");
const DEFAULT_APP_DATA_PATH = path.join(__dirname, "data", "local-db.json");

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);
  return repairLegacyOperationAmounts(parsed.data || parsed);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function repairLegacyOperationAmounts(data) {
  asArray(data.operations).forEach((operation) => repairLegacyOperation(operation));
  return data;
}

function repairLegacyOperation(operation) {
  const draft = operation.draftData || {};
  const lines = asArray(draft.saleLines);
  if (!lines.length) {
    mirrorSinglePartyConsignedLiquidacion(operation);
    return;
  }

  lines.forEach((line) => {
    const tipoVend = normalizeText(line.tipoPrecioVend || draft.tipoPrecioVend || "KG").toUpperCase();
    const tipoComp = normalizeText(line.tipoPrecioComp || draft.tipoPrecioComp || tipoVend).toUpperCase();
    const cabezas = Number(line.cabezas || draft.cabezas || 0);
    const kgBruto = parseMoney(line.kgBruto || draft.kgBruto);
    const desbasteVend = parseMoney(line.desbasteVend || draft.desbasteVend);
    const desbasteComp = parseMoney(line.desbasteComp || draft.desbasteComp);
    const kgNetoVend = parseMoney(line.kgNetoVend) || roundCommercial(kgBruto * (1 - desbasteVend / 100));
    const kgComp = parseMoney(line.kgComp) || roundCommercial(kgBruto * (1 - desbasteComp / 100));
    const kgCalculoVend = parseMoney(line.kgCalculoVend) || kgNetoVend;
    const kgCalculoComp = parseMoney(line.kgCalculoComp) || kgComp || kgCalculoVend;
    const precioFinalVend = parseMoney(line.precioFinalManualVend || line.precioFinalVend);
    const precioFinalComp = parseMoney(line.precioFinalManualComp || line.precioFinalComp) || precioFinalVend;
    const precioBaseVend = parseMoney(line.precioVend || draft.precioVend) || precioFinalVend;
    const precioBaseComp = parseMoney(line.precioComp || draft.precioComp) || precioFinalComp || precioBaseVend;

    if (precioFinalVend && !Number(line.importeVend || 0)) {
      line.precioVend = precioBaseVend;
      line.precioFinalVend = precioFinalVend;
      line.importeVend = tipoVend === "CAB" ? cabezas * precioFinalVend : kgCalculoVend * precioFinalVend;
    }
    if (precioFinalComp && !Number(line.importeComp || 0)) {
      line.precioComp = precioBaseComp;
      line.precioFinalComp = precioFinalComp;
      line.importeComp = tipoComp === "CAB" ? cabezas * precioFinalComp : kgCalculoComp * precioFinalComp;
    }
  });

  const totalVend = lines.reduce((sum, line) => sum + Number(line.importeVend || 0), 0);
  const totalComp = lines.reduce((sum, line) => sum + Number(line.importeComp || line.importeVend || 0), 0);
  if (totalVend) {
    draft.totalVentaVend = totalVend;
    operation.total = formatMoney(totalVend);
  }

  const liq = draft.liquidacion;
  if (liq && totalVend) {
    liq.brutoVend = totalVend;
    liq.brutoComp = totalComp || totalVend;
    const detailIsEmpty = !asArray(liq.detalleLiquidar).length
      || asArray(liq.detalleLiquidar).every((item) => !Number(item.importeNeto || 0) && !Number(item.precioCabeza || 0));
    if (detailIsEmpty) liq.detalleLiquidar = buildDetalleLiquidar(lines, parseMoney(liq.importeFacturado || totalVend));
  }
  mirrorSinglePartyConsignedLiquidacion(operation);
}

function mirrorSinglePartyConsignedLiquidacion(operation) {
  const draft = operation.draftData || {};
  const liq = draft.liquidacion;
  if (!liq) return;
  const operationType = normalizeKey(operation.tipo || draft.tipo);
  const consigned = operationType === "CONSIGNADA"
    || (operationType.includes("ANTICIPADA") && Boolean(operation.consignataria || draft.consignataria));
  if (!consigned) return;
  const settledParty = normalizeKey(liq.liquidacionConsignatariaA || draft.liquidacionConsignatariaA || "VENDEDOR");
  liq.liquidacionConsignatariaA = settledParty;
  if (settledParty === "VENDEDOR") {
    liq.netoLiquidacionComp = liq.netoLiquidacionProd;
    liq.netoTotalComp = liq.netoTotalProd;
  }
  if (settledParty === "COMPRADOR") {
    liq.netoLiquidacionProd = liq.netoLiquidacionComp;
    liq.netoTotalProd = liq.netoTotalComp;
  }
}

function normalizeKey(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeCuit(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizePartialText(value) {
  const text = normalizeText(value);
  return text === "-" ? "" : text;
}

function partialBillingKey(line) {
  return [
    normalizePartialText(line.fecha).toUpperCase(),
    normalizePartialText(line.planVencimientos || line.vencimiento).toUpperCase(),
    normalizePartialText(line.comprobante).toUpperCase(),
    Number(parseMoney(line.cantidad) || 0).toFixed(2),
    Number(parseMoney(line.importeBruto) || 0).toFixed(2),
    Number(parseMoney(line.importeNeto) || 0).toFixed(2),
    Number(parseMoney(line.iva) || 0).toFixed(2)
  ].join("|");
}

function mergePartialParty(current, incoming) {
  const a = normalizeKey(current || "");
  const b = normalizeKey(incoming || "");
  if (!a) return incoming || "";
  if (!b || a === b) return current || incoming || "";
  if (a === "AMBAS" || b === "AMBAS") return "AMBAS";
  if ((a === "VENDEDOR" && b === "COMPRADOR") || (a === "COMPRADOR" && b === "VENDEDOR")) return "AMBAS";
  return current || incoming || "";
}

function dedupePartialBillingLines(lines = []) {
  const result = [];
  lines.forEach((line) => {
    const key = partialBillingKey(line);
    const existing = result.find((item) => partialBillingKey(item) === key);
    if (existing) {
      existing.parteCuenta = mergePartialParty(existing.parteCuenta, line.parteCuenta);
      if (!existing.comprobante && line.comprobante) existing.comprobante = line.comprobante;
      if (!existing.vencimiento && line.vencimiento) existing.vencimiento = line.vencimiento;
      if (!existing.planVencimientos && line.planVencimientos) existing.planVencimientos = line.planVencimientos;
      return;
    }
    result.push({ ...line });
  });
  return result;
}

function operationPartialBillingLines(operation = {}) {
  const draft = operation.draftData || {};
  return dedupePartialBillingLines([
    ...asArray(operation.facturacionParcial),
    ...asArray(draft.facturacionParcial)
  ]);
}

function parseMoney(value) {
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

function parseDecimal(value) {
  return parseMoney(value);
}

function normalizeFrigorificoEfectivoSinIva(value, expectedWithoutIva, frigo) {
  const parsed = parseMoney(value);
  if (!frigo || !parsed) return parsed;
  const expected = Math.max(Number(expectedWithoutIva || 0), 0);
  const expectedWithIva = expected * 1.105;
  const tolerance = Math.max(2, expectedWithIva * 0.002);
  return Math.abs(parsed - expectedWithIva) <= tolerance ? expected : parsed;
}

function formatDateFromDb(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

function formatDateForDisplay(value) {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return text;
}

function formatDateForDb(value) {
  const text = String(value || "").trim();
  const ar = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ar) return `${ar[3]}-${ar[2].padStart(2, "0")}-${ar[1].padStart(2, "0")}`;
  return text;
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2
  }).format(Number(value || 0));
}

function parseDateLoose(value) {
  const text = String(value || "").trim();
  const ar = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ar) return new Date(Number(ar[3]), Number(ar[2]) - 1, Number(ar[1]));
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function parsePlanItems(plan, baseAmount, baseDate) {
  const amount = Math.abs(Number(baseAmount || 0));
  if (!amount) return [];
  const date = parseDateLoose(baseDate) || new Date();
  const text = String(plan || "0").trim();
  if (!text) return [{ vencimiento: formatDateLocal(date), porcentaje: 100, importe: amount }];

  const parts = text.split("-").map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return [{ vencimiento: formatDateLocal(date), porcentaje: 100, importe: amount }];

  if (parts.some((part) => part.includes("@"))) {
    const parsed = parts.map((part) => {
      const [valueRaw, daysRaw] = part.split("@");
      return {
        value: String(valueRaw || "").includes("$") ? parseMoney(valueRaw) : parseDecimal(valueRaw),
        days: parseDecimal(daysRaw),
        manual: String(valueRaw || "").includes("$")
      };
    });
    const valuesAreAmounts = parsed.some((item) => item.manual) || parsed.reduce((sum, item) => sum + item.value, 0) > 100.001;
    return parsed.map((item) => {
      const importe = valuesAreAmounts ? item.value : amount * item.value / 100;
      return {
        vencimiento: formatDateLocal(addDays(date, item.days)),
        porcentaje: valuesAreAmounts && amount ? importe / amount * 100 : item.value,
        importe
      };
    });
  }

  const percent = 100 / parts.length;
  return parts.map((daysRaw) => ({
    vencimiento: formatDateLocal(addDays(date, parseDecimal(daysRaw))),
    porcentaje: percent,
    importe: amount * percent / 100
  }));
}

function signedExternalMovement(item) {
  const direction = normalizeKey(item.direccion);
  const amount = Math.abs(parseMoney(item.importe));
  return direction === "COBRAR" ? amount : -amount;
}

function signedPayment(item) {
  if (item.importeFirmado !== undefined && item.importeFirmado !== "") return parseMoney(item.importeFirmado);
  const type = normalizeKey(item.tipo);
  const amount = Math.abs(parseMoney(item.importe));
  if (type === "COMPENSACION") return amount;
  return type === "PAGO" ? amount : -amount;
}

function externalMovementBaseId(id) {
  return normalizeText(id).replace(/-(NETO(?:-\d+)?|IVA|VTO-\d+)$/i, "");
}

function parseExternalDueRows(input) {
  return asArray(input.vencimientos)
    .map((item) => ({
      vencimiento: formatDateForDisplay(item.vencimiento),
      importe: Math.abs(parseMoney(item.importe))
    }))
    .filter((item) => item.vencimiento && item.importe > 0);
}

function assertExternalDueTotal(rows, expectedAmount) {
  if (!rows.length) return;
  const total = rows.reduce((sum, item) => sum + Number(item.importe || 0), 0);
  if (!approxMoney(total, expectedAmount)) {
    const error = new Error(`La suma de los vencimientos (${formatMoney(total)}) debe coincidir con el neto que impacta en cuenta corriente (${formatMoney(expectedAmount)}).`);
    error.statusCode = 400;
    throw error;
  }
}

function commissionFieldsForSplit(common, index) {
  if (index === 0) {
    return {
      comisionista: common.comisionista,
      baseComision: common.baseComision,
      porcComision: common.porcComision,
      importeComision: common.importeComision
    };
  }
  return {
    comisionista: "",
    baseComision: 0,
    porcComision: 0,
    importeComision: 0
  };
}

function buildExternalMovementItems(input, baseId) {
  const cliente = normalizeText(input.cliente);
  const importe = Math.abs(parseMoney(input.importe));
  const ivaFiscal = Math.abs(parseMoney(input.ivaFiscal));
  const concepto = normalizeText(input.concepto || "Movimiento externo");
  const isVentaMag = normalizeKey(concepto) === "VENTA MAG";
  const vencimientos = parseExternalDueRows(input);
  if (!cliente || (!importe && !ivaFiscal)) {
    const error = new Error("Falta seleccionar cliente o cargar un importe mayor a cero.");
    error.statusCode = 400;
    throw error;
  }
  if (isVentaMag && ivaFiscal > importe) {
    const error = new Error("En Venta MAG, el IVA no puede ser mayor al Importe Neto.");
    error.statusCode = 400;
    throw error;
  }
  const common = {
    cliente,
    direccion: normalizeText(input.direccion || "PAGAR"),
    comprobante: normalizeText(input.comprobante),
    fechaVenta: formatDateForDisplay(input.fechaVenta),
    vencimiento: formatDateForDisplay(input.vencimiento),
    comisionista: normalizeText(input.comisionista),
    baseComision: parseMoney(input.baseComision),
    porcComision: parseMoney(input.porcComision),
    importeComision: parseMoney(input.importeComision),
    observacion: normalizeText(input.observacion)
  };
  if (isVentaMag) {
    const netoACobrar = Math.max(importe - ivaFiscal, 0);
    const netRows = [netoACobrar ? {
        id: `${baseId}-NETO`,
        ...common,
        concepto: "Venta MAG - Neto a cobrar",
        importe: netoACobrar,
        tipoDesglose: "NETO"
      } : null].filter(Boolean);
    return [
      ...netRows,
      ivaFiscal ? {
        id: `${baseId}-IVA`,
        ...common,
        concepto: "Venta MAG - IVA fiscal",
        importe: ivaFiscal,
        tipoDesglose: "IVA_FISCAL",
        comisionista: "",
        baseComision: 0,
        porcComision: 0,
        importeComision: 0
      } : null
    ].filter(Boolean);
  }
  assertExternalDueTotal(vencimientos, importe);
  if (vencimientos.length) {
    return vencimientos.map((row, index) => ({
      id: `${baseId}-VTO-${index + 1}`,
      ...common,
      ...commissionFieldsForSplit(common, index),
      vencimiento: row.vencimiento,
      concepto,
      importe: row.importe,
      tipoDesglose: "VENCIMIENTO"
    }));
  }
  return [{
    id: baseId,
    ...common,
    concepto,
    importe
  }];
}

function pushMovement(list, movement) {
  if (!movement.cliente || (!Number(movement.importe) && movement.estado !== "ANULADO")) return;
  list.push({
    id: movement.id,
    cliente: normalizeText(movement.cliente),
    fecha: movement.fecha || "",
    vencimiento: movement.vencimiento || movement.fecha || "",
    origen: movement.origen || "",
    concepto: movement.concepto || "",
    comprobante: movement.comprobante || "",
    operacion: movement.operacion || "",
    paymentId: movement.paymentId || "",
    contraparte: movement.contraparte || "",
    vendedor: movement.vendedor || "",
    comprador: movement.comprador || "",
    consignataria: movement.consignataria || "",
    liquidacionConsignatariaA: movement.liquidacionConsignatariaA || "",
    tipoOperacion: movement.tipoOperacion || "",
    destinoOperacion: movement.destinoOperacion || "",
    consignatariaCuenta: Boolean(movement.consignatariaCuenta),
    comisionista: movement.comisionista || "",
    baseComision: Number(movement.baseComision || 0),
    porcComision: Number(movement.porcComision || 0),
    importeComision: Number(movement.importeComision || 0),
    tipoDesglose: movement.tipoDesglose || "",
    importe: Math.round(Number(movement.importe || 0) * 100) / 100,
    estado: movement.estado || "PENDIENTE",
    observacion: movement.observacion || ""
  });
}

function pairedAccountMovementId(movementId, targetClient, movements) {
  const id = normalizeText(movementId);
  if (!id) return "";
  const replacements = [
    ["-VENDEDOR-FACT-", "-COMPRADOR-FACT-"],
    ["-COMPRADOR-FACT-", "-VENDEDOR-FACT-"],
    ["-VENDEDOR-EFEC-", "-COMPRADOR-EFEC-"],
    ["-COMPRADOR-EFEC-", "-VENDEDOR-EFEC-"],
    ["-FP-VENDEDOR", "-FP-COMPRADOR"],
    ["-FP-COMPRADOR", "-FP-VENDEDOR"]
  ];
  for (const [from, to] of replacements) {
    if (!id.includes(from)) continue;
    const candidateId = id.replace(from, to);
    const candidate = movements.find((movement) => String(movement.id) === candidateId);
    if (candidate && (!targetClient || normalizeKey(candidate.cliente) === normalizeKey(targetClient))) {
      return candidateId;
    }
  }
  return "";
}

function mirrorPaymentPairImputations(primary, counterparty, movements) {
  if (!primary || !counterparty) return;
  const primaryItems = asArray(primary.imputaciones);
  const counterpartyItems = asArray(counterparty.imputaciones);
  const copyFrom = (sourceItems, targetPayment) => sourceItems
    .map((item) => {
      const movementId = pairedAccountMovementId(item.movementId || item.rowId, targetPayment.cliente, movements);
      return movementId ? { movementId, importe: Math.abs(parseMoney(item.importe)) } : null;
    })
    .filter(Boolean);
  if (!primaryItems.length && counterpartyItems.length) primary.imputaciones = copyFrom(counterpartyItems, primary);
  if (!counterpartyItems.length && primaryItems.length) counterparty.imputaciones = copyFrom(primaryItems, counterparty);
}

function repairPaymentPairImputations(payments, movements) {
  const cloned = asArray(payments).map((payment) => ({
    ...payment,
    instrumentos: asArray(payment.instrumentos).map((item) => ({ ...item })),
    imputaciones: asArray(payment.imputaciones).map((item) => ({ ...item }))
  }));
  const byId = new Map(cloned.map((payment) => [payment.id, payment]));
  cloned.forEach((payment) => {
    if (String(payment.id || "").endsWith("-CP")) return;
    mirrorPaymentPairImputations(payment, byId.get(`${payment.id}-CP`), movements);
  });
  return cloned;
}

function buildOperationAccountMovements(operation) {
  const draft = operation.draftData || {};
  const liq = draft.liquidacion || {};
  const liquidationConfirmed = Boolean(draft.liquidacionConfirmada) || normalizeKey(operation.liquidacionEstado) === "CONFIRMADA";
  if (!liquidationConfirmed) return [];
  const operationDate = operation.fecha || draft.fecha || "";
  const dueBaseDate = draft.fechaCarga || operationDate;
  const typeText = `${operation.tipo || draft.tipo || "Operacion"} ${operation.destino || draft.destino || ""}`.trim();
  const operationConsignee = operation.consignataria || draft.consignataria || "";
  const settledByConsignee = normalizeKey(liq.liquidacionConsignatariaA || draft.liquidacionConsignatariaA || "VENDEDOR");
  const frigo = normalizeKey(draft.calculoFrigorificoComp || liq.calculoFrigorificoComp) === "SI";
  const frigoNetoFinal = parseMoney(liq.netoFinalFrigorificoComp || draft.netoFinalFrigorificoComp || liq.brutoVend || operationTotal(operation));
  const frigoBrutoSinIva = parseMoney(liq.brutoSinIvaFrigorificoComp || draft.brutoSinIvaFrigorificoComp);
  const frigoFacturado = parseMoney(liq.importeFacturado);
  const frigoEfectivoBase = frigo && frigoNetoFinal
    ? Math.max((frigoBrutoSinIva || frigoNetoFinal / 1.105) - frigoFacturado, 0)
    : 0;
  const efectivoProdSinIva = normalizeFrigorificoEfectivoSinIva(liq.efectivoProd, frigoEfectivoBase, frigo);
  const efectivoProdCuenta = frigo ? efectivoProdSinIva * 1.105 : efectivoProdSinIva;
  const movements = [];
  const partialAccountLines = operationPartialBillingLines(operation).filter((line) => {
    const parteCuenta = normalizeKey(line.parteCuenta || "NINGUNA");
    const amount = Math.abs(parseMoney(line.importeNeto) || (parseMoney(line.importeBruto) + parseMoney(line.iva)));
    return ["VENDEDOR", "COMPRADOR", "AMBAS"].includes(parteCuenta) && amount;
  });
  const accountByPartialBillingProd = partialAccountLines.some((line) => {
    const parteCuenta = normalizeKey(line.parteCuenta || "NINGUNA");
    return parteCuenta === "VENDEDOR" || parteCuenta === "AMBAS";
  });
  const accountByPartialBillingComp = partialAccountLines.some((line) => {
    const parteCuenta = normalizeKey(line.parteCuenta || "NINGUNA");
    return parteCuenta === "COMPRADOR" || parteCuenta === "AMBAS";
  });
  const conceptWithCounterpart = (suffix, counterpart) => `${typeText} - ${suffix}${counterpart ? ` - por ${counterpart}` : ""}`;
  const consigneeAppliesToRole = (role) => {
    if (!operationConsignee) return false;
    if (settledByConsignee === "AMBAS") return true;
    if (String(role || "").startsWith("VENDEDOR")) return settledByConsignee === "VENDEDOR";
    if (String(role || "").startsWith("COMPRADOR")) return settledByConsignee === "COMPRADOR";
    return false;
  };
  const counterpartForRole = (role, fallback) => consigneeAppliesToRole(role) ? operationConsignee : fallback;

  const addPlan = ({ cliente, role, amount, plan, comprobante, counterpart, conceptSuffix }) => {
    parsePlanItems(plan, amount, dueBaseDate).forEach((item, index) => {
      const signedAmount = amount < 0 ? -item.importe : item.importe;
      pushMovement(movements, {
        id: `${operation.id}-${role}-${index}`,
        cliente,
        fecha: operationDate,
        vencimiento: item.vencimiento,
        origen: "OPERACION",
        concepto: conceptWithCounterpart(conceptSuffix, counterpart),
        comprobante,
        operacion: operation.id,
        parte: String(role || "").startsWith("VENDEDOR") ? "VENDEDOR" : String(role || "").startsWith("COMPRADOR") ? "COMPRADOR" : "",
        contraparte: counterpart,
        vendedor: operation.vendedor || draft.vendedor || "",
        comprador: operation.comprador || draft.comprador || "",
        consignataria: operationConsignee,
        tipoOperacion: operation.tipo || draft.tipo || "",
        destinoOperacion: operation.destino || draft.destino || "",
        consignatariaCuenta: consigneeAppliesToRole(role),
        importe: signedAmount,
        estado: "PENDIENTE"
      });
    });
  };

  if (!accountByPartialBillingProd && liq.netoLiquidacionProd) {
    addPlan({
      cliente: operation.vendedor || draft.vendedor,
      role: "VENDEDOR-FACT",
      amount: -Math.abs(Number(liq.netoLiquidacionProd || 0)),
      plan: draft.planFacturadoProd || liq.planFacturadoProd || "0",
      comprobante: liq.comprobanteProd || draft.comprobanteProd,
      counterpart: counterpartForRole("VENDEDOR-FACT", operation.comprador || draft.comprador || operationConsignee),
      conceptSuffix: "liquidacion vendedor"
    });
  }
  if (efectivoProdCuenta) {
    addPlan({
      cliente: operation.vendedor || draft.vendedor,
      role: "VENDEDOR-EFEC",
      amount: -Math.abs(Number(efectivoProdCuenta || 0)),
      plan: draft.planEfectivoProd || liq.planEfectivoProd || "0",
      comprobante: liq.comprobanteProd || draft.comprobanteProd,
      counterpart: counterpartForRole("VENDEDOR-EFEC", operation.comprador || draft.comprador || operationConsignee),
      conceptSuffix: "efectivo vendedor"
    });
  }
  if (!accountByPartialBillingComp && liq.netoLiquidacionComp) {
    addPlan({
      cliente: operation.comprador || draft.comprador,
      role: "COMPRADOR-FACT",
      amount: Math.abs(Number(liq.netoLiquidacionComp || 0)),
      plan: draft.planFacturadoComp || liq.planFacturadoComp || "0",
      comprobante: liq.comprobanteComp || draft.comprobanteComp,
      counterpart: counterpartForRole("COMPRADOR-FACT", operation.vendedor || draft.vendedor || operationConsignee),
      conceptSuffix: "liquidacion comprador"
    });
  }
  if (liq.efectivoComp) {
    addPlan({
      cliente: operation.comprador || draft.comprador,
      role: "COMPRADOR-EFEC",
      amount: Math.abs(Number(liq.efectivoComp || 0)),
      plan: draft.planEfectivoComp || liq.planEfectivoComp || "0",
      comprobante: liq.comprobanteComp || draft.comprobanteComp,
      counterpart: counterpartForRole("COMPRADOR-EFEC", operation.vendedor || draft.vendedor || operationConsignee),
      conceptSuffix: "efectivo comprador"
    });
  }

  const addCommission = ({ cliente, role, amount, comprobante, counterpart, conceptSuffix }) => {
    if (!Number(amount)) return;
    if (operationConsignee) {
      if (settledByConsignee === "VENDEDOR" && !String(role || "").startsWith("VENDEDOR")) return;
      if (settledByConsignee === "COMPRADOR" && !String(role || "").startsWith("COMPRADOR")) return;
      if (settledByConsignee === "NINGUNA") return;
    }
    pushMovement(movements, {
      id: `${operation.id}-${role}`,
      cliente,
      fecha: operationDate,
      vencimiento: dueBaseDate,
      origen: "COMISION",
      concepto: conceptWithCounterpart(conceptSuffix, counterpart),
      comprobante,
      operacion: operation.id,
      parte: String(role || "").startsWith("VENDEDOR") ? "VENDEDOR" : String(role || "").startsWith("COMPRADOR") ? "COMPRADOR" : "",
      contraparte: counterpart,
      vendedor: operation.vendedor || draft.vendedor || "",
      comprador: operation.comprador || draft.comprador || "",
      consignataria: operationConsignee,
      tipoOperacion: operation.tipo || draft.tipo || "",
      destinoOperacion: operation.destino || draft.destino || "",
      consignatariaCuenta: false,
      importe: Math.abs(Number(amount || 0)),
      estado: "PENDIENTE"
    });
  };
  addCommission({
    cliente: operation.vendedor || draft.vendedor,
    role: "VENDEDOR-COM-FACT",
    amount: liq.comisionFacturadoProd,
    comprobante: liq.comprobanteProd || draft.comprobanteProd,
    counterpart: counterpartForRole("VENDEDOR-COM-FACT", operation.comprador || draft.comprador || operationConsignee),
    conceptSuffix: "comision sobre facturado vendedor"
  });
  addCommission({
    cliente: operation.vendedor || draft.vendedor,
    role: "VENDEDOR-COM-EFEC",
    amount: liq.comisionEfectivoProd,
    comprobante: liq.comprobanteProd || draft.comprobanteProd,
    counterpart: counterpartForRole("VENDEDOR-COM-EFEC", operation.comprador || draft.comprador || operationConsignee),
    conceptSuffix: "comision sobre efectivo vendedor"
  });
  addCommission({
    cliente: operation.comprador || draft.comprador,
    role: "COMPRADOR-COM-FACT",
    amount: liq.comisionFacturadoComp,
    comprobante: liq.comprobanteComp || draft.comprobanteComp,
    counterpart: counterpartForRole("COMPRADOR-COM-FACT", operation.vendedor || draft.vendedor || operationConsignee),
    conceptSuffix: "comision sobre facturado comprador"
  });
  addCommission({
    cliente: operation.comprador || draft.comprador,
    role: "COMPRADOR-COM-EFEC",
    amount: liq.comisionEfectivoComp,
    comprobante: liq.comprobanteComp || draft.comprobanteComp,
    counterpart: counterpartForRole("COMPRADOR-COM-EFEC", operation.vendedor || draft.vendedor || operationConsignee),
    conceptSuffix: "comision sobre efectivo comprador"
  });

  partialAccountLines.forEach((line) => {
    const parteCuenta = normalizeKey(line.parteCuenta || "NINGUNA");
    if (!["VENDEDOR", "COMPRADOR", "AMBAS"].includes(parteCuenta)) return;
    const amount = Math.abs(parseMoney(line.importeNeto) || (parseMoney(line.importeBruto) + parseMoney(line.iva)));
    if (!amount) return;
    const fecha = line.fecha || operationDate;
    const planVencimientos = normalizePartialText(line.planVencimientos);
    const planItems = parsePlanItems(planVencimientos, amount, planVencimientos ? fecha : line.vencimiento || line.fecha || dueBaseDate);
    const comprobante = normalizePartialText(line.comprobante) || `Parcial ${line.id || ""}`.trim();
    const baseConcept = `facturacion parcial${line.cantidad ? ` ${line.cantidad} cab.` : ""} sobre operacion total`;
    const pushPartial = ({ role, cliente, counterpart, sign }) => {
      if (!cliente) return;
      planItems.forEach((item, index) => {
        const multiple = planItems.length > 1 || Boolean(planVencimientos);
        pushMovement(movements, {
          id: `${operation.id}-${line.id}-${role}${multiple ? `-${index}` : ""}`,
          cliente,
          fecha,
          vencimiento: item.vencimiento || line.vencimiento || line.fecha || dueBaseDate,
          origen: "FACTURACION_PARCIAL",
          concepto: conceptWithCounterpart(`${baseConcept}${multiple ? ` cuota ${index + 1}` : ""}`, counterpart),
          comprobante,
          operacion: operation.id,
          parte: String(role || "").includes("VENDEDOR") ? "VENDEDOR" : String(role || "").includes("COMPRADOR") ? "COMPRADOR" : "",
          contraparte: counterpart,
          vendedor: operation.vendedor || draft.vendedor || "",
          comprador: operation.comprador || draft.comprador || "",
          consignataria: operationConsignee,
          tipoOperacion: operation.tipo || draft.tipo || "",
          destinoOperacion: operation.destino || draft.destino || "",
          consignatariaCuenta: false,
          importe: sign * Math.abs(Number(item.importe || 0)),
          estado: "PENDIENTE"
        });
      });
    };
    if (parteCuenta === "VENDEDOR" || parteCuenta === "AMBAS") {
      pushPartial({
        role: "FP-VENDEDOR",
        cliente: operation.vendedor || draft.vendedor,
        counterpart: operation.comprador || draft.comprador || operationConsignee,
        sign: -1
      });
    }
    if (parteCuenta === "COMPRADOR" || parteCuenta === "AMBAS") {
      pushPartial({
        role: "FP-COMPRADOR",
        cliente: operation.comprador || draft.comprador,
        counterpart: operation.vendedor || draft.vendedor || operationConsignee,
        sign: 1
      });
    }
  });

  const totalCobrarConsignataria = Number(liq.totalCobrarConsignataria || draft.totalCobrarConsignataria || draft.ajusteConsignataria || 0);
  if (operationConsignee && totalCobrarConsignataria) {
    const consigneeCounterpart = settledByConsignee === "COMPRADOR"
      ? operation.comprador || draft.comprador || operation.vendedor || draft.vendedor
      : operation.vendedor || draft.vendedor || operation.comprador || draft.comprador;
    pushMovement(movements, {
      id: `${operation.id}-CONSIGNATARIA`,
      cliente: operationConsignee,
      fecha: operationDate,
      vencimiento: dueBaseDate,
      origen: "CONSIGNATARIA",
      concepto: conceptWithCounterpart("comision/diferencia consignataria", consigneeCounterpart),
      comprobante: liq.comprobanteProd || draft.comprobanteProd || liq.comprobanteComp || draft.comprobanteComp,
      operacion: operation.id,
      parte: "CONSIGNATARIA",
      contraparte: consigneeCounterpart,
      consignataria: operationConsignee,
      liquidacionConsignatariaA: settledByConsignee,
      consignatariaCuenta: true,
      importe: Math.abs(totalCobrarConsignataria),
      estado: "PENDIENTE"
    });
  }

  return movements;
}

function buildAccountData(data) {
  const movements = [];
  const commissionInvoiceByMovement = new Map();
  asArray(data.commissionInvoices).forEach((invoice) => {
    if (invoice.anulado) return;
    asArray(invoice.movimientos).forEach((item) => {
      const movementId = normalizeText(item.movementId || item.id);
      if (!movementId) return;
      commissionInvoiceByMovement.set(movementId, {
        id: invoice.id,
        numero: invoice.numero,
        fecha: invoice.fecha,
        cliente: invoice.cliente,
        periodoDesde: invoice.periodoDesde,
        periodoHasta: invoice.periodoHasta
      });
    });
  });
  asArray(data.operations).forEach((operation) => {
    buildOperationAccountMovements(operation).forEach((movement) => pushMovement(movements, movement));
  });
  asArray(data.currentAccountManualMovements).forEach((item) => {
    pushMovement(movements, {
      id: item.id,
      cliente: item.cliente,
      fecha: item.fechaVenta,
      vencimiento: item.vencimiento,
      origen: "EXTERNO",
      concepto: item.concepto || "Movimiento externo",
      comprobante: item.comprobante,
      comisionista: item.comisionista,
      baseComision: item.baseComision,
      porcComision: item.porcComision,
      importeComision: item.importeComision,
      tipoDesglose: item.tipoDesglose,
      importe: signedExternalMovement(item),
      estado: "PENDIENTE",
      observacion: item.observacion
    });
  });
  const payments = repairPaymentPairImputations(data.currentAccountPayments, movements);
  const activePayments = payments.filter((payment) => !payment.anulado);
  const allocations = new Map();
  const paymentAllocations = new Map();
  const resolveMovementId = (rawId) => {
    const id = String(rawId || "");
    if (!id) return "";
    if (movements.some((row) => String(row.id) === id)) return id;
    const parts = id.split("|");
    const prefix = parts[0];
    if (prefix.startsWith("EXT-") && movements.some((row) => String(row.id) === prefix)) return prefix;
    if (!/^20\d{2}-\d{4}$/.test(prefix) || parts.length < 7) return id;
    const client = normalizeKey(parts[2]);
    const dueDate = formatDateLocal(parseDateLoose(parts[5]));
    const amount = Math.abs(Number(parts[6] || 0)) / 100;
    const match = movements.find((row) => row.operacion === prefix
      && normalizeKey(row.cliente) === client
      && formatDateLocal(parseDateLoose(row.vencimiento)) === dueDate
      && Math.abs(Math.abs(Number(row.importe || 0)) - amount) < 0.01);
    return match ? String(match.id) : id;
  };
  const addAllocation = (payment, movementId, amount) => {
    const resolvedId = resolveMovementId(movementId);
    if (!resolvedId || !Number(amount)) return;
    const movement = movements.find((row) => String(row.id) === resolvedId);
    const previous = allocations.get(resolvedId) || 0;
    const available = movement ? Math.max(Math.abs(movement.importe) - previous, 0) : Math.abs(Number(amount));
    const applied = Math.min(Math.abs(Number(amount)), available);
    if (!applied) return;
    allocations.set(resolvedId, previous + applied);
    if (!paymentAllocations.has(payment.id)) paymentAllocations.set(payment.id, []);
    paymentAllocations.get(payment.id).push({ movementId: resolvedId, importe: applied });
  };
  activePayments.forEach((payment) => {
    const items = asArray(payment.imputaciones);
    if (items.length) {
      items.forEach((item) => {
        const movement = movements.find((row) => String(row.id) === String(item.movementId || item.rowId || ""));
        addAllocation(payment, item.movementId || item.rowId, item.importe || (movement ? Math.abs(movement.importe) : 0));
      });
      return;
    }
    const operationMatch = String(payment.observacion || "").match(/\b20\d{2}-\d{4}\b/);
    if (!operationMatch) return;
    let remaining = Math.abs(signedPayment(payment));
    movements
      .filter((movement) => movement.operacion === operationMatch[0]
        && normalizeKey(movement.cliente) === normalizeKey(payment.cliente)
        && Math.sign(movement.importe) === -Math.sign(signedPayment(payment))
        && movement.origen !== "COMISION")
      .forEach((movement) => {
        const amount = Math.min(Math.abs(movement.importe), remaining);
        addAllocation(payment, movement.id, amount);
        remaining -= amount;
      });
  });
  movements.forEach((movement) => {
    const imputed = Math.min(Math.abs(movement.importe), allocations.get(String(movement.id)) || 0);
    movement.importeImputado = imputed;
    movement.importePendiente = Math.max(Math.abs(movement.importe) - imputed, 0);
    const commissionInvoice = commissionInvoiceByMovement.get(String(movement.id));
    if (commissionInvoice) {
      movement.facturaComisionId = commissionInvoice.id;
      movement.facturaComision = commissionInvoice.numero;
      movement.fechaFacturaComision = commissionInvoice.fecha;
      movement.estadoFacturacionComision = "FACTURADO";
    }
    if (imputed >= Math.abs(movement.importe) - 0.01) movement.estado = "IMPUTADO";
    else if (imputed > 0.01) movement.estado = "PARCIAL";
  });
  payments.forEach((item) => {
    pushMovement(movements, {
      id: item.id,
      cliente: item.cliente,
      fecha: item.fecha,
      vencimiento: item.fecha,
      origen: item.tipo || "PAGO/COBRO",
      concepto: item.tipo === "COMPENSACION"
        ? "COMPENSACION / aplicacion de saldo cobrado por fuera"
        : `${item.tipo || "Movimiento"} - ${item.medio || ""}`.trim(),
      comprobante: item.referencia,
      paymentId: item.id,
      importe: item.anulado ? 0 : signedPayment(item),
      estado: item.anulado ? "ANULADO" : "IMPUTADO",
      observacion: item.observacion
    });
  });

  const byClient = new Map();
  movements.forEach((movement) => {
    const key = normalizeKey(movement.cliente);
    if (!byClient.has(key)) {
      byClient.set(key, { cliente: movement.cliente, saldo: 0, movimientos: 0, vencido: 0, aVencer: 0 });
    }
    const row = byClient.get(key);
    row.saldo += movement.importe;
    row.movimientos += 1;
    const dueDate = parseDateLoose(movement.vencimiento);
    if (dueDate && dueDate < new Date()) row.vencido += movement.importe;
    else row.aVencer += movement.importe;
  });

  const clientes = Array.from(byClient.values()).sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));
  const vencimientos = movements
    .filter((movement) => movement.estado !== "IMPUTADO" && movement.vencimiento)
    .sort((a, b) => {
      const da = parseDateLoose(a.vencimiento);
      const db = parseDateLoose(b.vencimiento);
      return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
    });

  const pagos = payments.map((payment) => ({
    ...payment,
    imputaciones: asArray(paymentAllocations.get(payment.id)).map((item) => {
      const movement = movements.find((row) => String(row.id) === item.movementId);
      return {
        ...item,
        vencimiento: movement ? movement.vencimiento : "",
        comprobante: movement ? movement.comprobante : "",
        concepto: movement ? movement.concepto : "",
        importeOriginal: movement ? Math.abs(movement.importe) : item.importe,
        importeOriginalFirmado: movement ? movement.importe : item.importe,
        origen: movement ? movement.origen : "",
        saldoPendiente: movement ? movement.importePendiente : 0
      };
    })
  }));

  return { movimientos: movements, clientes, vencimientos, pagos };
}

function roundCommercial(value) {
  const number = Number(value || 0);
  if (number >= 0) return Math.floor(number + 0.5);
  return -Math.floor(Math.abs(number) + 0.5);
}

function getNextOperationCode(operations) {
  const year = "2026";
  const maxNumber = asArray(operations).reduce((max, operation) => {
    const match = String(operation.id || "").match(/^2026-(\d+)$/);
    if (!match) return max;
    return Math.max(max, Number(match[1] || 0));
  }, 0);
  return `${year}-${String(maxNumber + 1).padStart(4, "0")}`;
}

function findTabRule(tabRules, code) {
  const key = normalizeKey(code);
  return asArray(tabRules).find((rule) => normalizeKey(rule.codigo) === key);
}

function getTabDelta(tabRules, code, average) {
  const rule = findTabRule(tabRules, code);
  const prom = roundCommercial(average);
  if (!rule || prom <= 0) return 0;
  const min = Number(rule.promMin || 0);
  const max = Number(rule.promMax || 0);
  const step = Number(rule.pasoKg || 0);
  if (step <= 0 || prom < min) return 0;
  const applicableAverage = max > 0 ? Math.min(prom, max) : prom;
  const baseUnits = (applicableAverage - min) / step;
  if (baseUnits <= 0) return 0;
  const mode = normalizeKey(rule.modoCalculo);
  const units = mode === "DECIMAL" ? baseUnits : mode === "ENTERO_ARRIBA" ? Math.ceil(baseUnits) : Math.floor(baseUnits);
  return Math.round(Number(rule.ajustePorPaso || 0) * units);
}

function optionalNumber(value, fallback) {
  return value !== undefined && value !== null && String(value).trim() !== "" ? parseMoney(value) : fallback;
}

function calculateSaleLine(input, tabRules = []) {
  const cabezas = Number(input.cabezas || 0);
  const kgBruto = Number(input.kgBruto || 0);
  const desbasteVend = Number(input.desbasteVend || 0);
  const kgNetoVend = input.kgNetoVend !== undefined && input.kgNetoVend !== ""
    ? Number(input.kgNetoVend || 0)
    : roundCommercial(kgBruto * (1 - desbasteVend / 100));
  const tipoPrecioVend = input.tipoPrecioVend || "KG";
  const precioVend = Number(input.precioVend || 0);
  const usarKgRealVend = Boolean(input.usarKgRealVend);
  const kgCalculoVend = optionalNumber(input.kgCalculoVend, usarKgRealVend ? kgBruto * (1 - desbasteVend / 100) : kgNetoVend);
  const promUsadoVend = optionalNumber(input.promUsadoVend, cabezas ? kgCalculoVend / cabezas : 0);
  const tabVend = normalizeText(input.tabVend);
  const precioFinalVend = optionalNumber(input.precioFinalManualVend, Math.max(precioVend + (tipoPrecioVend === "CAB" ? 0 : getTabDelta(tabRules, tabVend, promUsadoVend)), 0));
  const importeVend = optionalNumber(input.importeManualVend, tipoPrecioVend === "CAB" ? cabezas * precioFinalVend : kgCalculoVend * precioFinalVend);

  const compradorDiferente = Boolean(input.compradorDiferente);
  const desbasteComp = compradorDiferente ? Number(input.desbasteComp || 0) : desbasteVend;
  const kgComp = compradorDiferente
    ? (input.kgComp !== undefined && input.kgComp !== "" ? Number(input.kgComp || 0) : roundCommercial(kgBruto * (1 - desbasteComp / 100)))
    : kgNetoVend;
  const tipoPrecioComp = compradorDiferente ? (input.tipoPrecioComp || tipoPrecioVend) : tipoPrecioVend;
  const precioComp = compradorDiferente ? Number(input.precioComp || 0) : precioVend;
  const usarKgRealComp = compradorDiferente ? Boolean(input.usarKgRealComp) : usarKgRealVend;
  const kgCalculoComp = compradorDiferente
    ? optionalNumber(input.kgCalculoComp, usarKgRealComp ? kgBruto * (1 - desbasteComp / 100) : kgComp)
    : kgCalculoVend;
  const promUsadoComp = compradorDiferente ? optionalNumber(input.promUsadoComp, cabezas ? kgCalculoComp / cabezas : 0) : promUsadoVend;
  const tabComp = compradorDiferente ? normalizeText(input.tabComp) : tabVend;
  const precioFinalComp = compradorDiferente
    ? optionalNumber(input.precioFinalManualComp, Math.max(precioComp + (tipoPrecioComp === "CAB" ? 0 : getTabDelta(tabRules, tabComp, promUsadoComp)), 0))
    : precioFinalVend;
  const importeComp = compradorDiferente
    ? optionalNumber(input.importeManualComp, tipoPrecioComp === "CAB" ? cabezas * precioFinalComp : kgCalculoComp * precioFinalComp)
    : importeVend;

  return {
    id: input.id || `LIN-${Date.now()}`,
    categoria: normalizeText(input.categoria),
    cabezas,
    kgBruto,
    desbasteVend,
    kgNetoVend,
    precioVend,
    precioFinalVend,
    tipoPrecioVend,
    tabVend,
    usarKgRealVend,
    kgCalculoVend: normalizeText(input.kgCalculoVend),
    promUsadoVend: normalizeText(input.promUsadoVend),
    precioFinalManualVend: normalizeText(input.precioFinalManualVend),
    importeManualVend: normalizeText(input.importeManualVend),
    importeVend,
    compradorDiferente,
    desbasteComp,
    kgComp,
    precioComp,
    precioFinalComp,
    tipoPrecioComp,
    tabComp,
    usarKgRealComp,
    kgCalculoComp: compradorDiferente ? normalizeText(input.kgCalculoComp) : normalizeText(input.kgCalculoVend),
    promUsadoComp: compradorDiferente ? normalizeText(input.promUsadoComp) : normalizeText(input.promUsadoVend),
    precioFinalManualComp: compradorDiferente ? normalizeText(input.precioFinalManualComp) : normalizeText(input.precioFinalManualVend),
    importeManualComp: compradorDiferente ? normalizeText(input.importeManualComp) : normalizeText(input.importeManualVend),
    importeComp
  };
}

function operationTotal(operation) {
  return asArray(operation.draftData && operation.draftData.saleLines)
    .reduce((sum, line) => sum + Number(line.importeVend || 0), 0);
}

function operationBuyerTotal(operation) {
  return asArray(operation.draftData && operation.draftData.saleLines)
    .reduce((sum, line) => sum + Number(line.importeComp || line.importeVend || 0), 0);
}

function saleInputForOperation(operation, input) {
  const isFaena = normalizeKey(operation.destino || operation.draftData.destino).includes("FAENA");
  if (!isFaena) return input;
  return {
    ...input,
    desbasteVend: 0,
    kgNetoVend: "",
    tipoPrecioVend: "KG",
    tabVend: "",
    compradorDiferente: Boolean(input.compradorDiferente),
    desbasteComp: 0,
    kgComp: "",
    tipoPrecioComp: "KG",
    tabComp: "",
    usarKgRealVend: false,
    usarKgRealComp: false,
    kgCalculoVend: "",
    kgCalculoComp: "",
    promUsadoVend: "",
    promUsadoComp: ""
  };
}

function approxMoney(a, b, tolerance = 0.02) {
  return Math.abs(parseMoney(a) - parseMoney(b)) <= tolerance;
}

function automaticFacturadoForOperation(operation, fallbackTotal = null) {
  const draft = operation.draftData || {};
  const total = fallbackTotal !== null ? parseMoney(fallbackTotal) : operationTotal(operation);
  const frigo = String(draft.calculoFrigorificoComp || "").toUpperCase() === "SI";
  const netoFinalFrigorifico = parseMoney(draft.netoFinalFrigorificoComp || total);
  const brutoSinIvaManual = Boolean(draft.brutoSinIvaFrigorificoManual);
  const brutoSinIvaFrigorifico = brutoSinIvaManual ? parseMoney(draft.brutoSinIvaFrigorificoComp) : 0;
  return frigo && netoFinalFrigorifico ? (brutoSinIvaFrigorifico || netoFinalFrigorifico / 1.105) : total;
}

function shouldRefreshAutoFacturado(liq, previousAutoFacturado) {
  if (liq && liq.importeFacturadoManual) return false;
  const currentFacturado = parseMoney(liq && liq.importeFacturado);
  if (!currentFacturado) return true;
  if (liq && liq.importeFacturadoManual === undefined) return true;
  const oldAuto = parseMoney(previousAutoFacturado);
  const oldBruto = parseMoney(liq && liq.brutoVend);
  return (oldAuto && approxMoney(currentFacturado, oldAuto)) || (oldBruto && approxMoney(currentFacturado, oldBruto));
}

function automaticIvaForLiquidacion(operation, liq) {
  const draft = operation.draftData || {};
  const operationType = normalizeKey(operation.tipo || draft.tipo);
  const consignada = operationType === "CONSIGNADA"
    || (operationType.includes("ANTICIPADA") && Boolean(operation.consignataria || draft.consignataria));
  const facturado = parseMoney(liq && liq.importeFacturado);
  const ivaDirectaSinIva = Boolean(liq && liq.ivaDirectaSinIva);
  const gastosBaseProd = parseMoney(liq && liq.comisionDetalleProd)
    + parseMoney(liq && liq.fondoGarantiaProd)
    + parseMoney(liq && liq.controlEntregaProd)
    + parseMoney(liq && liq.fondoCompGastosProd)
    + parseMoney(liq && liq.otrosGastosProd);
  const netoGravadoProd = consignada ? Math.max(facturado - gastosBaseProd, 0) : facturado;
  return {
    prod: ivaDirectaSinIva ? 0 : netoGravadoProd * 0.105,
    comp: ivaDirectaSinIva ? 0 : facturado * 0.105
  };
}

function touchOperationSale(operation, previousAutoFacturado = null) {
  const total = operationTotal(operation);
  operation.total = formatMoney(total);
  operation.estado = "BORRADOR";
  if (!operation.draftData) operation.draftData = {};
  const liq = operation.draftData.liquidacion;
  const totalComp = operationBuyerTotal(operation);
  if (liq) {
    const refreshFacturado = shouldRefreshAutoFacturado(liq, previousAutoFacturado);
    const newFacturado = automaticFacturadoForOperation(operation, total);
    const detailWasAuto = !asArray(liq.detalleLiquidar).length
      || approxMoney(
        asArray(liq.detalleLiquidar).reduce((sum, item) => sum + parseMoney(item.importeNeto), 0),
        parseMoney(liq.importeFacturado)
      );
    liq.brutoVend = total;
    liq.brutoComp = totalComp || total;
    if (refreshFacturado) {
      liq.importeFacturado = newFacturado;
      if (detailWasAuto) liq.detalleLiquidar = buildDetalleLiquidar(asArray(operation.draftData.saleLines), newFacturado);
    }
    const autoIva = automaticIvaForLiquidacion(operation, liq);
    if (!liq.ivaProdManual) liq.ivaProd = autoIva.prod;
    if (!liq.ivaCompManual) liq.ivaComp = autoIva.comp;
  }
  if (operation.draftData) operation.draftData.liquidacionConfirmada = false;
  operation.draftData.totalVentaVend = total;
  operation.liquidacionEstado = "BORRADOR";
  return total;
}

function calculateLiquidacion(operation, input = {}) {
  const draft = operation.draftData || {};
  const source = { ...draft, ...input };
  const brutoVend = operationTotal(operation);
  const brutoComp = operationBuyerTotal(operation);
  const frigo = String(source.calculoFrigorificoComp || "").toUpperCase() === "SI";
  const operationType = String(operation.tipo || draft.tipo || "").toUpperCase();
  const consignada = operationType === "CONSIGNADA"
    || (operationType.includes("ANTICIPADA") && Boolean(operation.consignataria || draft.consignataria));
  const netoFinalFrigorifico = parseMoney(source.netoFinalFrigorificoComp || brutoVend);
  const brutoSinIvaFrigorificoManual = Boolean(source.brutoSinIvaFrigorificoManual);
  const brutoSinIvaFrigorifico = brutoSinIvaFrigorificoManual ? parseMoney(source.brutoSinIvaFrigorificoComp) : 0;
  const brutoBaseProd = frigo && netoFinalFrigorifico
    ? (brutoSinIvaFrigorifico || netoFinalFrigorifico / 1.105)
    : brutoVend;
  const facturado = source.importeFacturado !== undefined && source.importeFacturado !== ""
    ? parseMoney(source.importeFacturado)
    : brutoBaseProd;
  const ivaDirectaSinIva = Boolean(source.ivaDirectaSinIva);
  const comisionDetalleProd = parseMoney(source.comisionDetalleProd);
  const fondoGarantiaProd = parseMoney(source.fondoGarantiaProd);
  const controlEntregaProd = parseMoney(source.controlEntregaProd);
  const fondoCompGastosProd = parseMoney(source.fondoCompGastosProd);
  const retIibbProd = parseMoney(source.retIibbProd);
  const retGananciasProd = parseMoney(source.retGananciasProd);
  const otrosGastosProd = parseMoney(source.otrosGastosProd);
  const ivaGastosProd = parseMoney(source.ivaGastosProd);
  const liquidacionConsignatariaA = normalizeText(source.liquidacionConsignatariaA || "VENDEDOR");
  let comprobanteProd = normalizeText(source.comprobanteProd);
  let comprobanteComp = normalizeText(source.comprobanteComp);
  if (consignada && liquidacionConsignatariaA === "VENDEDOR") comprobanteComp = comprobanteProd;
  if (consignada && liquidacionConsignatariaA === "COMPRADOR") comprobanteProd = comprobanteComp;
  const buyerExpensesApply = consignada && (liquidacionConsignatariaA === "COMPRADOR" || liquidacionConsignatariaA === "AMBAS");
  const gastoProcesamientoComp = parseMoney(source.gastoProcesamientoComp !== undefined ? source.gastoProcesamientoComp : source.gastoGuiasDteComp);
  const otrosGastosComp1 = parseMoney(source.otrosGastosComp1 !== undefined ? source.otrosGastosComp1 : source.gastoFleteComp);
  const otrosGastosComp2 = parseMoney(source.otrosGastosComp2 !== undefined ? source.otrosGastosComp2 : source.gastoPesadaComp);
  const totalGastosComp = buyerExpensesApply
    ? gastoProcesamientoComp + otrosGastosComp1 + otrosGastosComp2
    : 0;
  const gastosBaseProd = comisionDetalleProd + fondoGarantiaProd + controlEntregaProd + fondoCompGastosProd + otrosGastosProd;
  const netoGravadoProd = consignada ? Math.max(facturado - gastosBaseProd, 0) : facturado;
  const ivaProdAuto = ivaDirectaSinIva ? 0 : netoGravadoProd * 0.105;
  const ivaCompAuto = ivaDirectaSinIva ? 0 : facturado * 0.105;
  const ivaProd = source.ivaProd !== undefined && source.ivaProd !== "" ? parseMoney(source.ivaProd) : ivaProdAuto;
  const ivaComp = source.ivaComp !== undefined && source.ivaComp !== "" ? parseMoney(source.ivaComp) : ivaCompAuto;
  const efectivoProdBase = Math.max(brutoBaseProd - facturado, 0);
  const efectivoProd = source.efectivoProd !== undefined && source.efectivoProd !== ""
    ? normalizeFrigorificoEfectivoSinIva(source.efectivoProd, efectivoProdBase, frigo)
    : efectivoProdBase;
  const ivaCompFrigorificoControl = facturado * 0.105;
  const efectivoCompBase = frigo
    ? Math.max(brutoComp - (facturado + ivaCompFrigorificoControl), 0)
    : Math.max(brutoComp - facturado, 0);
  const efectivoComp = !frigo && source.efectivoComp !== undefined && source.efectivoComp !== ""
    ? parseMoney(source.efectivoComp)
    : efectivoCompBase;
  const hasInput = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const hasSource = (key) => Object.prototype.hasOwnProperty.call(source, key);
  const commissionApplies = (flagKey, percentKey, legacyPercentKey, amountKey) => {
    if (hasSource(flagKey)) return Boolean(source[flagKey]);
    const percent = parseMoney(source[percentKey] !== undefined ? source[percentKey] : source[legacyPercentKey]);
    return percent > 0 || parseMoney(source[amountKey]) > 0;
  };
  const aplicaComisionFacturadoProd = commissionApplies("aplicaComisionFacturadoProd", "comisionFacturadoProdPct", "comisionProd", "comisionFacturadoProd");
  const aplicaComisionFacturadoComp = commissionApplies("aplicaComisionFacturadoComp", "comisionFacturadoCompPct", "comisionComp", "comisionFacturadoComp");
  const aplicaComisionEfectivoProd = commissionApplies("aplicaComisionEfectivoProd", "comisionEfectivoProdPct", "", "comisionEfectivoProd");
  const aplicaComisionEfectivoComp = commissionApplies("aplicaComisionEfectivoComp", "comisionEfectivoCompPct", "", "comisionEfectivoComp");
  const comisionFacturadoProdPct = aplicaComisionFacturadoProd
    ? parseMoney(source.comisionFacturadoProdPct !== undefined ? source.comisionFacturadoProdPct : source.comisionProd)
    : 0;
  const comisionFacturadoCompPct = aplicaComisionFacturadoComp
    ? parseMoney(source.comisionFacturadoCompPct !== undefined ? source.comisionFacturadoCompPct : source.comisionComp)
    : 0;
  const comisionEfectivoProdPct = aplicaComisionEfectivoProd ? parseMoney(source.comisionEfectivoProdPct) : 0;
  const comisionEfectivoCompPct = aplicaComisionEfectivoComp ? parseMoney(source.comisionEfectivoCompPct) : 0;
  const comisionFacturadoProd = aplicaComisionFacturadoProd
    ? (hasInput("comisionFacturadoProd") ? parseMoney(input.comisionFacturadoProd) : facturado * comisionFacturadoProdPct / 100)
    : 0;
  const comisionFacturadoComp = aplicaComisionFacturadoComp
    ? (hasInput("comisionFacturadoComp") ? parseMoney(input.comisionFacturadoComp) : facturado * comisionFacturadoCompPct / 100)
    : 0;
  const efectivoConIvaProd = efectivoProd + (frigo ? efectivoProd * 0.105 : 0);
  const comisionEfectivoProd = aplicaComisionEfectivoProd
    ? (hasInput("comisionEfectivoProd") ? parseMoney(input.comisionEfectivoProd) : efectivoConIvaProd * comisionEfectivoProdPct / 100)
    : 0;
  const comisionEfectivoComp = aplicaComisionEfectivoComp
    ? (hasInput("comisionEfectivoComp") ? parseMoney(input.comisionEfectivoComp) : efectivoComp * comisionEfectivoCompPct / 100)
    : 0;
  const gastoEfectivoProd = parseMoney(source.gastoEfectivoProd);
  const porcComisionConsignataria = parseMoney(source.porcComisionConsignataria);
  const ajusteConsignataria = parseMoney(source.ajusteConsignataria);
  const comisionConsignataria = facturado * porcComisionConsignataria / 100;
  let netoLiquidacionProd = consignada
    ? netoGravadoProd + ivaProd - retIibbProd - retGananciasProd - ivaGastosProd
    : facturado + ivaProd;
  let netoLiquidacionComp = facturado + ivaComp + totalGastosComp;
  let netoTotalProd = netoLiquidacionProd + efectivoConIvaProd - gastoEfectivoProd - comisionEfectivoProd;
  let netoTotalComp = netoLiquidacionComp + efectivoComp;
  if (consignada && liquidacionConsignatariaA === "VENDEDOR") {
    netoLiquidacionComp = netoLiquidacionProd;
    netoTotalComp = netoTotalProd;
  }
  if (consignada && liquidacionConsignatariaA === "COMPRADOR") {
    netoLiquidacionProd = netoLiquidacionComp;
    netoTotalProd = netoTotalComp;
  }
  const detalleLiquidar = normalizeDetalleLiquidar(operation, source.detalleLiquidar, facturado);

  return {
    comprobanteProd,
    comprobanteComp,
    brutoVend,
    brutoComp,
    importeFacturado: facturado,
    importeFacturadoManual: Boolean(source.importeFacturadoManual),
    ivaProd,
    ivaProdManual: Boolean(source.ivaProdManual),
    ivaComp,
    ivaCompManual: Boolean(source.ivaCompManual),
    efectivoProd,
    efectivoConIvaProd,
    efectivoComp,
    comisionFacturadoProd,
    comisionFacturadoComp,
    comisionEfectivoProd,
    comisionEfectivoComp,
    aplicaComisionFacturadoProd,
    aplicaComisionFacturadoComp,
    aplicaComisionEfectivoProd,
    aplicaComisionEfectivoComp,
    comisionFacturadoProdPct,
    comisionFacturadoCompPct,
    comisionEfectivoProdPct,
    comisionEfectivoCompPct,
    liquidacionConsignatariaA,
    comprobanteCompDiferente: Boolean(source.comprobanteCompDiferente),
    netoFinalFrigorificoComp: netoFinalFrigorifico,
    brutoSinIvaFrigorificoComp: frigo ? brutoBaseProd : 0,
    brutoSinIvaFrigorificoManual,
    efectivoModo: normalizeText(source.efectivoModo || "MONTO"),
    efectivoPorc: normalizeText(source.efectivoPorc),
    planFacturadoProd: normalizeText(source.planFacturadoProd || "30"),
    planFacturadoComp: normalizeText(source.planFacturadoComp || "30"),
    planEfectivoProd: normalizeText(source.planEfectivoProd || "0"),
    planEfectivoComp: normalizeText(source.planEfectivoComp || "0"),
    ivaDirectaSinIva,
    netoGravadoProd,
    comisionDetalleProd,
    fondoGarantiaProd,
    controlEntregaProd,
    fondoCompGastosProd,
    retIibbProd,
    retGananciasProd,
    otrosGastosProd,
    ivaGastosProd,
    observGastosProd: normalizeText(source.observGastosProd),
    gastoProcesamientoComp,
    otrosGastosComp1,
    otrosGastosComp2,
    observGastosComp: normalizeText(source.observGastosComp),
    totalGastosComp,
    conceptoGastoEfectivoProd: normalizeText(source.conceptoGastoEfectivoProd),
    gastoEfectivoProd,
    porcComisionConsignataria,
    comisionConsignataria,
    conceptoAjusteConsignataria: normalizeText(source.conceptoAjusteConsignataria),
    ajusteConsignataria,
    totalCobrarConsignataria: comisionConsignataria + ajusteConsignataria,
    detalleLiquidacionDirectaProd: normalizeText(source.detalleLiquidacionDirectaProd),
    netoLiquidacionProd,
    netoLiquidacionComp,
    netoTotalProd,
    netoTotalComp,
    detalleLiquidar,
    observaciones: normalizeText(source.observaciones),
    observacionesProd: normalizeText(source.observacionesProd),
    observacionesComp: normalizeText(source.observacionesComp),
    confirmadoEn: new Date().toISOString()
  };
}

function normalizeDetalleLiquidar(operation, detalle, facturado) {
  const lines = asArray(operation.draftData && operation.draftData.saleLines);
  const source = asArray(detalle).length ? asArray(detalle) : buildDetalleLiquidar(lines, facturado);
  return source
    .map((item) => {
      const cantidad = Number(item.cantidad || item.cabezas || 0);
      const precioCabeza = parseMoney(item.precioCabeza);
      const importeNeto = item.importeNeto !== undefined && item.importeNeto !== ""
        ? parseMoney(item.importeNeto)
        : cantidad * precioCabeza;
      const iva = item.iva !== undefined && item.iva !== "" ? parseMoney(item.iva) : importeNeto * 0.105;
      return {
        cantidad,
        categoria: normalizeText(item.categoria),
        precioCabeza,
        importeNeto,
        iva,
        importeBruto: importeNeto + iva
      };
    })
    .filter((item) => item.categoria || item.cantidad || item.importeNeto);
}

function buildDetalleLiquidar(lines, facturado) {
  const totalVend = asArray(lines).reduce((sum, line) => sum + Number(line.importeVend || 0), 0);
  return asArray(lines).map((line) => {
    const cantidad = Number(line.cabezas || 0);
    const factor = totalVend > 0 ? Number(line.importeVend || 0) / totalVend : 0;
    const importeNeto = facturado > 0 ? facturado * factor : Number(line.importeVend || 0);
    const precioCabeza = cantidad > 0 ? importeNeto / cantidad : 0;
    return {
      cantidad,
      categoria: line.categoria,
      precioCabeza,
      importeNeto,
      iva: importeNeto * 0.105,
      importeBruto: importeNeto * 1.105
    };
  });
}

class BackupDataSource {
  constructor(backupPath, appDataPath) {
    this.backupPath = backupPath || DEFAULT_BACKUP_PATH;
    this.appDataPath = appDataPath || DEFAULT_APP_DATA_PATH;
  }

  mode() {
    return "backup-local";
  }

  readData() {
    this.ensureLocalData();
    return readJson(this.appDataPath);
  }

  ensureLocalData() {
    if (fs.existsSync(this.appDataPath)) return;
    const backup = readJson(this.backupPath);
    writeJson(this.appDataPath, {
      version: 1,
      creadoDesdeBackup: this.backupPath,
      creadoEn: new Date().toISOString(),
      clients: asArray(backup.clients),
      establishments: asArray(backup.establishments),
      operations: asArray(backup.operations),
      categories: asArray(backup.categories),
      tabRules: asArray(backup.tabRules),
      currentAccountPayments: asArray(backup.currentAccountPayments),
      currentAccountManualMovements: asArray(backup.currentAccountManualMovements),
      commissionInvoices: asArray(backup.commissionInvoices),
      cajaDiaria: asArray(backup.cajaDiaria),
      cajaConciliaciones: asArray(backup.cajaConciliaciones),
      fieldContracts: asArray(backup.fieldContracts),
      fieldLeases: asArray(backup.fieldLeases),
      documentos: asArray(backup.documentos)
    });
  }

  saveData(data) {
    writeJson(this.appDataPath, data);
  }

  async exportBackup() {
    const data = this.readData();
    return {
      ...data,
      exportadoEn: new Date().toISOString(),
      origen: this.mode()
    };
  }

  async health() {
    return {
      ok: true,
      modo: this.mode(),
      fuente: this.appDataPath,
      fecha: new Date().toISOString()
    };
  }

  async getClientes() {
    const data = this.readData();
    return asArray(data.clients)
      .map((client) => ({
        id: client.id || normalizeKey(client.nombre),
        nombre: normalizeText(client.nombre),
        cuit: client.cuit || "",
        tipo: client.tipo || "Cliente",
        observaciones: client.observaciones || ""
      }))
      .filter((client) => client.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }

  async saveCliente(input) {
    const data = this.readData();
    const clients = asArray(data.clients);
    const name = normalizeText(input.nombre);
    const cuit = normalizeText(input.cuit);
    const tipo = normalizeText(input.tipo) || "Cliente";
    const observaciones = normalizeText(input.observaciones);
    const id = input.id || normalizeKey(name);

    if (!name) {
      const error = new Error("Falta cargar la razon social.");
      error.statusCode = 400;
      throw error;
    }

    const duplicateByName = clients.find((client) => normalizeKey(client.nombre) === normalizeKey(name) && String(client.id || normalizeKey(client.nombre)) !== String(id));
    if (duplicateByName) {
      const error = new Error(`Ya existe un cliente con ese nombre: ${duplicateByName.nombre}`);
      error.statusCode = 409;
      error.code = "DUPLICATE_NAME";
      throw error;
    }

    const cuitDigits = normalizeCuit(cuit);
    if (cuitDigits) {
      const duplicateByCuit = clients.find((client) => normalizeCuit(client.cuit) === cuitDigits && String(client.id || normalizeKey(client.nombre)) !== String(id));
      if (duplicateByCuit) {
        const error = new Error(`Ya existe un cliente con ese CUIT: ${duplicateByCuit.nombre}`);
        error.statusCode = 409;
        error.code = "DUPLICATE_CUIT";
        throw error;
      }
    }

    const index = clients.findIndex((client) => String(client.id || normalizeKey(client.nombre)) === String(id));
    const saved = {
      id,
      nombre: name,
      cuit,
      tipo,
      observaciones,
      actualizadoEn: new Date().toISOString()
    };

    if (index >= 0) {
      clients[index] = { ...clients[index], ...saved };
    } else {
      saved.id = `CLI-${Date.now()}`;
      saved.creadoEn = saved.actualizadoEn;
      clients.push(saved);
    }

    data.clients = clients;
    this.saveData(data);
    return saved;
  }

  clientReferenceCount(data, clientName) {
    const key = normalizeKey(clientName);
    let count = 0;
    asArray(data.operations).forEach((operation) => {
      const draft = operation.draftData || {};
      [operation.vendedor, operation.comprador, operation.consignataria, draft.vendedor, draft.comprador, draft.consignataria]
        .forEach((name) => { if (normalizeKey(name) === key) count += 1; });
    });
    asArray(data.currentAccountManualMovements).forEach((movement) => {
      if (normalizeKey(movement.cliente) === key) count += 1;
    });
    asArray(data.currentAccountPayments).forEach((payment) => {
      if (normalizeKey(payment.cliente) === key) count += 1;
      const counterparty = payment.contrapartida || {};
      if (normalizeKey(counterparty.cliente) === key) count += 1;
    });
    return count;
  }

  replaceClientNameReferences(data, sourceName, targetClient) {
    const sourceKey = normalizeKey(sourceName);
    const targetName = targetClient.nombre;
    const targetCuit = targetClient.cuit || "";
    const replaceName = (name) => normalizeKey(name) === sourceKey ? targetName : name;
    asArray(data.establishments).forEach((item) => {
      item.cliente = replaceName(item.cliente);
    });
    asArray(data.operations).forEach((operation) => {
      const draft = operation.draftData || {};
      if (normalizeKey(operation.vendedor) === sourceKey) {
        operation.vendedor = targetName;
        operation.vendedorCuit = targetCuit;
      }
      if (normalizeKey(operation.comprador) === sourceKey) {
        operation.comprador = targetName;
        operation.compradorCuit = targetCuit;
      }
      if (normalizeKey(operation.consignataria) === sourceKey) operation.consignataria = targetName;
      if (normalizeKey(draft.vendedor) === sourceKey) {
        draft.vendedor = targetName;
        draft.vendedorCuit = targetCuit;
      }
      if (normalizeKey(draft.comprador) === sourceKey) {
        draft.comprador = targetName;
        draft.compradorCuit = targetCuit;
      }
      if (normalizeKey(draft.consignataria) === sourceKey) draft.consignataria = targetName;
    });
    asArray(data.currentAccountManualMovements).forEach((movement) => {
      movement.cliente = replaceName(movement.cliente);
    });
    asArray(data.currentAccountPayments).forEach((payment) => {
      payment.cliente = replaceName(payment.cliente);
      if (payment.contrapartida) payment.contrapartida.cliente = replaceName(payment.contrapartida.cliente);
    });
  }

  async mergeCliente(sourceId, input) {
    const data = this.readData();
    const clients = asArray(data.clients);
    const sourceIndex = clients.findIndex((client) => String(client.id || normalizeKey(client.nombre)) === String(sourceId));
    const source = clients[sourceIndex];
    if (!source) {
      const error = new Error("No se encontro el cliente a fusionar.");
      error.statusCode = 404;
      throw error;
    }
    const targetName = normalizeText(input.targetName);
    const targetId = normalizeText(input.targetId);
    const target = targetId
      ? clients.find((client) => String(client.id || normalizeKey(client.nombre)) === String(targetId))
      : clients.find((client) => normalizeKey(client.nombre) === normalizeKey(targetName) && String(client.id || normalizeKey(client.nombre)) !== String(source.id || normalizeKey(source.nombre)));
    if (!target) {
      const error = new Error("No se encontro el cliente correcto de destino.");
      error.statusCode = 404;
      throw error;
    }
    if (String(target.id || normalizeKey(target.nombre)) === String(source.id || normalizeKey(source.nombre))) {
      const error = new Error("El cliente destino no puede ser el mismo registro.");
      error.statusCode = 400;
      throw error;
    }
    this.replaceClientNameReferences(data, source.nombre, {
      nombre: normalizeText(target.nombre),
      cuit: target.cuit || ""
    });
    clients.splice(sourceIndex, 1);
    data.clients = clients;
    this.saveData(data);
    return { fusionado: source.nombre, destino: target.nombre };
  }

  async deleteCliente(clientId) {
    const data = this.readData();
    const clients = asArray(data.clients);
    const index = clients.findIndex((client) => String(client.id || normalizeKey(client.nombre)) === String(clientId));
    const client = clients[index];
    if (!client) {
      const error = new Error("No se encontro el cliente.");
      error.statusCode = 404;
      throw error;
    }
    const references = this.clientReferenceCount(data, client.nombre);
    if (references > 0) {
      const error = new Error("El cliente tiene operaciones o movimientos. Primero fusionelo con el cliente correcto.");
      error.statusCode = 409;
      throw error;
    }
    data.establishments = asArray(data.establishments).filter((item) => normalizeKey(item.cliente) !== normalizeKey(client.nombre));
    clients.splice(index, 1);
    data.clients = clients;
    this.saveData(data);
    return { eliminado: client.nombre };
  }

  async getEstablecimientos(clienteId) {
    const data = this.readData();
    const clientes = await this.getClientes();
    const cliente = clientes.find((item) => String(item.id) === String(clienteId));
    if (!cliente) return [];
    return asArray(data.establishments)
      .filter((item) => normalizeKey(item.cliente) === normalizeKey(cliente.nombre))
      .map((item) => ({
        cliente: item.cliente,
        nombre: item.nombre || "Establecimiento",
        renspa: item.renspa || "",
        observaciones: item.observaciones || ""
      }));
  }

  async saveEstablecimiento(clienteId, input) {
    const data = this.readData();
    const clientes = await this.getClientes();
    const cliente = clientes.find((item) => String(item.id) === String(clienteId));
    if (!cliente) {
      const error = new Error("Primero hay que guardar o seleccionar el cliente.");
      error.statusCode = 404;
      throw error;
    }

    const nombre = normalizeText(input.nombre) || "Establecimiento";
    const renspa = normalizeText(input.renspa);
    const observaciones = normalizeText(input.observaciones);
    if (!renspa) {
      const error = new Error("Falta cargar el RENSPA.");
      error.statusCode = 400;
      throw error;
    }

    const establishments = asArray(data.establishments);
    const duplicate = establishments.find((item) => normalizeKey(item.cliente) === normalizeKey(cliente.nombre) && normalizeKey(item.renspa) === normalizeKey(renspa));
    if (duplicate) {
      const error = new Error("Ese RENSPA ya esta asociado al cliente.");
      error.statusCode = 409;
      error.code = "DUPLICATE_RENSPA";
      throw error;
    }

    const saved = {
      id: `EST-${Date.now()}`,
      cliente: cliente.nombre,
      nombre,
      renspa,
      observaciones,
      creadoEn: new Date().toISOString()
    };
    establishments.push(saved);
    data.establishments = establishments;
    this.saveData(data);
    return saved;
  }

  async ensureEstablecimiento(clienteId, renspa, nombre) {
    const cleanRenspa = normalizeText(renspa);
    if (!cleanRenspa) return null;
    const current = await this.getEstablecimientos(clienteId);
    const existing = current.find((item) => normalizeKey(item.renspa) === normalizeKey(cleanRenspa));
    if (existing) return existing;
    return this.saveEstablecimiento(clienteId, {
      nombre: nombre || "Carga manual",
      renspa: cleanRenspa,
      observaciones: "Agregado desde alta de operacion."
    });
  }

  async saveOperacion(input) {
    let data = this.readData();
    const clients = await this.getClientes();
    const findClient = (id) => clients.find((client) => String(client.id) === String(id));
    const vendedor = findClient(input.vendedorId);
    const comprador = findClient(input.compradorId);
    const consignataria = findClient(input.consignatariaId);

    if (!vendedor) {
      const error = new Error("Falta seleccionar el vendedor.");
      error.statusCode = 400;
      throw error;
    }
    if (!comprador) {
      const error = new Error("Falta seleccionar el comprador.");
      error.statusCode = 400;
      throw error;
    }

    if (input.guardarRenspaOrigen) {
      await this.ensureEstablecimiento(vendedor.id, input.renspaOrigen, input.establecimientoOrigen);
    }
    if (input.guardarRenspaDestino) {
      await this.ensureEstablecimiento(comprador.id, input.renspaDestino, input.establecimientoDestino);
    }

    data = this.readData();
    const operations = asArray(data.operations);
    const id = input.id || getNextOperationCode(operations);
    const index = operations.findIndex((item) => String(item.id) === String(id));
    const previous = index >= 0 ? operations[index] : {};
    const previousDraft = previous.draftData || {};
    const fecha = formatDateForDisplay(input.fecha) || formatDateForDisplay(new Date().toISOString().slice(0, 10));
    const operation = {
      ...previous,
      id,
      fecha,
      vendedor: vendedor.nombre,
      vendedorCuit: vendedor.cuit || "",
      comprador: comprador.nombre,
      compradorCuit: comprador.cuit || "",
      destino: input.destino || "INVERNADA",
      tipo: input.tipo || "DIRECTA",
      estado: previous.estado || "BORRADOR",
      total: previous.total || "$ 0,00",
      dte: normalizeText(input.dte),
      renspaOrigen: normalizeText(input.renspaOrigen),
      renspaDestino: normalizeText(input.renspaDestino),
      draftData: {
        ...previousDraft,
        id,
        fecha,
        fechaCarga: formatDateForDisplay(input.fechaCarga) || previousDraft.fechaCarga || fecha,
        tipo: input.tipo || "DIRECTA",
        ventaAnticipada: Boolean(input.ventaAnticipada),
        destino: input.destino || "INVERNADA",
        vendedor: vendedor.nombre,
        vendedorCuit: vendedor.cuit || "",
        comprador: comprador.nombre,
        compradorCuit: comprador.cuit || "",
        consignataria: consignataria ? consignataria.nombre : "",
        dte: normalizeText(input.dte),
        renspaOrigen: normalizeText(input.renspaOrigen),
        renspaDestino: normalizeText(input.renspaDestino),
        condicionesOperacion: normalizeText(input.condiciones),
        establecimientoOrigen: normalizeText(input.establecimientoOrigen),
        establecimientoDestino: normalizeText(input.establecimientoDestino),
        calculoFrigorificoComp: input.calculoFrigorificoComp || previousDraft.calculoFrigorificoComp || "NO",
        saleLines: asArray(previousDraft.saleLines)
      },
      liquidacionEstado: previous.liquidacionEstado || "BORRADOR"
    };

    if (index >= 0) operations[index] = { ...operations[index], ...operation };
    else operations.unshift(operation);

    data.operations = operations;
    this.saveData(data);
    return operation;
  }

  async getCategorias() {
    const data = this.readData();
    return [...new Set(asArray(data.categories).map((item) => normalizeText(item)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es"));
  }

  async saveCategoria(currentName, input) {
    const data = this.readData();
    const current = normalizeText(currentName);
    const nombre = normalizeText(input.nombre).toUpperCase();
    if (!current || !nombre) {
      const error = new Error("La categoria no puede quedar vacia.");
      error.statusCode = 400;
      throw error;
    }
    const categories = asArray(data.categories);
    const currentIndex = categories.findIndex((item) => normalizeKey(item) === normalizeKey(current));
    if (currentIndex < 0) {
      const error = new Error("No se encontro la categoria.");
      error.statusCode = 404;
      throw error;
    }
    const duplicate = categories.some((item, index) => index !== currentIndex && normalizeKey(item) === normalizeKey(nombre));
    if (duplicate) {
      const error = new Error("Ya existe otra categoria con ese nombre.");
      error.statusCode = 400;
      throw error;
    }
    categories[currentIndex] = nombre;
    data.categories = categories.sort((a, b) => String(a).localeCompare(String(b), "es"));
    this.saveData(data);
    return nombre;
  }

  async deleteCategoria(currentName) {
    const data = this.readData();
    const current = normalizeText(currentName);
    data.categories = asArray(data.categories).filter((item) => normalizeKey(item) !== normalizeKey(current));
    this.saveData(data);
    return { nombre: current };
  }

  async getTabRules() {
    const data = this.readData();
    return asArray(data.tabRules).slice().sort((a, b) => String(a.codigo || "").localeCompare(String(b.codigo || ""), "es"));
  }

  async saveTabRule(input) {
    const data = this.readData();
    const codigo = normalizeText(input.codigo).toUpperCase();
    if (!codigo || !Number(input.promMin) || !Number(input.ajustePorPaso)) {
      const error = new Error("Faltan datos para guardar la TAB.");
      error.statusCode = 400;
      throw error;
    }
    const saved = {
      codigo,
      refProm: Number(input.promMin),
      promMin: Number(input.promMin),
      promMax: input.promMax !== undefined && input.promMax !== "" ? Number(input.promMax) : 9999,
      pasoKg: Number(input.pasoKg || 1),
      ajustePorPaso: Number(input.ajustePorPaso),
      modo: "EXCEDENTE",
      modoCalculo: normalizeText(input.modoCalculo || "ENTERO_ABAJO")
    };
    const rules = asArray(data.tabRules);
    const index = rules.findIndex((rule) => normalizeKey(rule.codigo) === normalizeKey(codigo));
    if (index >= 0) rules[index] = saved;
    else rules.push(saved);
    data.tabRules = rules;
    this.saveData(data);
    return saved;
  }

  async getOperacionDetalle(operationId) {
    const data = this.readData();
    const operation = asArray(data.operations).find((item) => String(item.id) === String(operationId));
    if (!operation) {
      const error = new Error("No se encontro la operacion.");
      error.statusCode = 404;
      throw error;
    }
    return {
      ...operation,
      vendedor: operation.vendedor || (operation.draftData && operation.draftData.vendedor) || "",
      comprador: operation.comprador || (operation.draftData && operation.draftData.comprador) || "",
      consignataria: operation.consignataria || (operation.draftData && operation.draftData.consignataria) || "",
      tipo: operation.tipo || (operation.draftData && operation.draftData.tipo) || "DIRECTA",
      destino: operation.destino || (operation.draftData && operation.draftData.destino) || "INVERNADA",
      dte: operation.dte || (operation.draftData && operation.draftData.dte) || "",
      renspaOrigen: operation.renspaOrigen || (operation.draftData && operation.draftData.renspaOrigen) || "",
      renspaDestino: operation.renspaDestino || (operation.draftData && operation.draftData.renspaDestino) || "",
      saleLines: asArray(operation.draftData && operation.draftData.saleLines),
      facturacionParcial: asArray(operation.draftData && operation.draftData.facturacionParcial),
      liquidacion: operation.draftData && operation.draftData.liquidacion ? operation.draftData.liquidacion : calculateLiquidacion(operation),
      liquidacionConfirmada: Boolean(operation.draftData && operation.draftData.liquidacionConfirmada),
      condiciones: operation.draftData && operation.draftData.condicionesOperacion ? operation.draftData.condicionesOperacion : "",
      establecimientoOrigen: operation.draftData && operation.draftData.establecimientoOrigen ? operation.draftData.establecimientoOrigen : "",
      establecimientoDestino: operation.draftData && operation.draftData.establecimientoDestino ? operation.draftData.establecimientoDestino : ""
    };
  }

  async saveVentaLinea(operationId, input) {
    const data = this.readData();
    const operations = asArray(data.operations);
    const operation = operations.find((item) => String(item.id) === String(operationId));
    if (!operation) {
      const error = new Error("No se encontro la operacion.");
      error.statusCode = 404;
      throw error;
    }
    if (!operation.draftData) operation.draftData = {};
    if (!Array.isArray(operation.draftData.saleLines)) operation.draftData.saleLines = [];
    const previousAutoFacturado = automaticFacturadoForOperation(operation);

    const line = calculateSaleLine(saleInputForOperation(operation, input), data.tabRules);
    if (!line.categoria) {
      const error = new Error("Falta cargar la categoria.");
      error.statusCode = 400;
      throw error;
    }
    operation.draftData.saleLines.push(line);

    const categories = asArray(data.categories);
    if (!categories.some((item) => normalizeKey(item) === normalizeKey(line.categoria))) {
      categories.push(line.categoria);
      data.categories = categories.sort((a, b) => String(a).localeCompare(String(b), "es"));
    }

    touchOperationSale(operation, previousAutoFacturado);
    data.operations = operations;
    this.saveData(data);
    return { operation, line };
  }

  async updateVentaLinea(operationId, lineId, input) {
    const data = this.readData();
    const operations = asArray(data.operations);
    const operation = operations.find((item) => String(item.id) === String(operationId));
    if (!operation) {
      const error = new Error("No se encontro la operacion.");
      error.statusCode = 404;
      throw error;
    }
    if (!operation.draftData) operation.draftData = {};
    if (!Array.isArray(operation.draftData.saleLines)) operation.draftData.saleLines = [];
    const previousAutoFacturado = automaticFacturadoForOperation(operation);

    const index = operation.draftData.saleLines.findIndex((line) => String(line.id) === String(lineId));
    if (index < 0) {
      const error = new Error("No se encontro la linea de venta.");
      error.statusCode = 404;
      throw error;
    }

    const line = calculateSaleLine(saleInputForOperation(operation, { ...input, id: lineId }), data.tabRules);
    if (!line.categoria) {
      const error = new Error("Falta cargar la categoria.");
      error.statusCode = 400;
      throw error;
    }
    operation.draftData.saleLines[index] = line;

    const categories = asArray(data.categories);
    if (!categories.some((item) => normalizeKey(item) === normalizeKey(line.categoria))) {
      categories.push(line.categoria);
      data.categories = categories.sort((a, b) => String(a).localeCompare(String(b), "es"));
    }

    touchOperationSale(operation, previousAutoFacturado);
    data.operations = operations;
    this.saveData(data);
    return { operation, line };
  }

  async deleteVentaLinea(operationId, lineId) {
    const data = this.readData();
    const operations = asArray(data.operations);
    const operation = operations.find((item) => String(item.id) === String(operationId));
    if (!operation) {
      const error = new Error("No se encontro la operacion.");
      error.statusCode = 404;
      throw error;
    }
    if (!operation.draftData) operation.draftData = {};
    if (!Array.isArray(operation.draftData.saleLines)) operation.draftData.saleLines = [];
    const previousAutoFacturado = automaticFacturadoForOperation(operation);
    const originalLength = operation.draftData.saleLines.length;
    operation.draftData.saleLines = operation.draftData.saleLines.filter((line) => String(line.id) !== String(lineId));
    if (operation.draftData.saleLines.length === originalLength) {
      const error = new Error("No se encontro la linea de venta.");
      error.statusCode = 404;
      throw error;
    }
    touchOperationSale(operation, previousAutoFacturado);
    data.operations = operations;
    this.saveData(data);
    return { operation };
  }

  async saveFacturacionParcial(operationId, input) {
    const data = this.readData();
    const operations = asArray(data.operations);
    const operation = operations.find((item) => String(item.id) === String(operationId));
    if (!operation) {
      const error = new Error("No se encontro la operacion.");
      error.statusCode = 404;
      throw error;
    }
    if (!operation.draftData) operation.draftData = {};
    if (!Array.isArray(operation.draftData.facturacionParcial)) operation.draftData.facturacionParcial = [];
    const line = {
      id: `FP-${Date.now()}`,
      fecha: formatDateForDisplay(input.fecha),
      vencimiento: formatDateForDisplay(input.vencimiento || input.fecha),
      planVencimientos: normalizePartialText(input.planVencimientos),
      comprobante: normalizeText(input.comprobante),
      parteCuenta: normalizeKey(input.parteCuenta || "AMBAS"),
      cantidad: parseMoney(input.cantidad),
      importeBruto: parseMoney(input.importeBruto),
      importeNeto: parseMoney(input.importeNeto),
      iva: parseMoney(input.iva),
      observaciones: normalizeText(input.observaciones)
    };
    if (!line.fecha || (!line.cantidad && !line.importeBruto && !line.importeNeto && !line.iva)) {
      const error = new Error("Falta cargar fecha y al menos cantidad o importe.");
      error.statusCode = 400;
      throw error;
    }
    operation.draftData.facturacionParcial = dedupePartialBillingLines([
      ...operation.draftData.facturacionParcial,
      line
    ]);
    data.operations = operations;
    this.saveData(data);
    return { operation, line };
  }

  async deleteFacturacionParcial(operationId, lineId) {
    const data = this.readData();
    const operations = asArray(data.operations);
    const operation = operations.find((item) => String(item.id) === String(operationId));
    if (!operation) {
      const error = new Error("No se encontro la operacion.");
      error.statusCode = 404;
      throw error;
    }
    if (!operation.draftData) operation.draftData = {};
    const originalLength = asArray(operation.draftData.facturacionParcial).length;
    operation.draftData.facturacionParcial = asArray(operation.draftData.facturacionParcial)
      .filter((line) => String(line.id) !== String(lineId));
    if (operation.draftData.facturacionParcial.length === originalLength) {
      const error = new Error("No se encontro el parcial.");
      error.statusCode = 404;
      throw error;
    }
    data.operations = operations;
    this.saveData(data);
    return { operation };
  }

  async saveLiquidacion(operationId, input) {
    const data = this.readData();
    const operations = asArray(data.operations);
    const operation = operations.find((item) => String(item.id) === String(operationId));
    if (!operation) {
      const error = new Error("No se encontro la operacion.");
      error.statusCode = 404;
      throw error;
    }
    if (!operation.draftData) operation.draftData = {};
    const liquidacion = calculateLiquidacion(operation, input);
    operation.draftData.liquidacion = liquidacion;
    Object.assign(operation.draftData, {
      liquidacionConsignatariaA: liquidacion.liquidacionConsignatariaA,
      comprobanteCompDiferente: liquidacion.comprobanteCompDiferente,
      netoFinalFrigorificoComp: liquidacion.netoFinalFrigorificoComp,
      brutoSinIvaFrigorificoComp: liquidacion.brutoSinIvaFrigorificoComp,
      brutoSinIvaFrigorificoManual: liquidacion.brutoSinIvaFrigorificoManual,
      efectivoModo: liquidacion.efectivoModo,
      efectivoPorc: liquidacion.efectivoPorc,
      planFacturadoProd: liquidacion.planFacturadoProd,
      planFacturadoComp: liquidacion.planFacturadoComp,
      planEfectivoProd: liquidacion.planEfectivoProd,
      planEfectivoComp: liquidacion.planEfectivoComp,
      ivaDirectaSinIva: liquidacion.ivaDirectaSinIva,
      aplicaComisionFacturadoProd: liquidacion.aplicaComisionFacturadoProd,
      aplicaComisionFacturadoComp: liquidacion.aplicaComisionFacturadoComp,
      aplicaComisionEfectivoProd: liquidacion.aplicaComisionEfectivoProd,
      aplicaComisionEfectivoComp: liquidacion.aplicaComisionEfectivoComp,
      comisionProd: liquidacion.comisionFacturadoProdPct,
      comisionComp: liquidacion.comisionFacturadoCompPct,
      comisionEfectivoProd: liquidacion.comisionEfectivoProdPct,
      comisionEfectivoComp: liquidacion.comisionEfectivoCompPct,
      comisionDetalleProd: liquidacion.comisionDetalleProd,
      fondoGarantiaProd: liquidacion.fondoGarantiaProd,
      controlEntregaProd: liquidacion.controlEntregaProd,
      fondoCompGastosProd: liquidacion.fondoCompGastosProd,
      retIibbProd: liquidacion.retIibbProd,
      retGananciasProd: liquidacion.retGananciasProd,
      otrosGastosProd: liquidacion.otrosGastosProd,
      ivaGastosProd: liquidacion.ivaGastosProd,
      observGastosProd: liquidacion.observGastosProd,
      gastoProcesamientoComp: liquidacion.gastoProcesamientoComp,
      otrosGastosComp1: liquidacion.otrosGastosComp1,
      otrosGastosComp2: liquidacion.otrosGastosComp2,
      observGastosComp: liquidacion.observGastosComp,
      conceptoGastoEfectivoProd: liquidacion.conceptoGastoEfectivoProd,
      gastoEfectivoProd: liquidacion.gastoEfectivoProd,
      porcComisionConsignataria: liquidacion.porcComisionConsignataria,
      conceptoAjusteConsignataria: liquidacion.conceptoAjusteConsignataria,
      ajusteConsignataria: liquidacion.ajusteConsignataria,
      detalleLiquidacionDirectaProd: liquidacion.detalleLiquidacionDirectaProd,
      observacionesProd: liquidacion.observacionesProd,
      observacionesComp: liquidacion.observacionesComp
    });
    operation.draftData.liquidacionConfirmada = true;
    operation.liquidacionEstado = "CONFIRMADA";
    data.operations = operations;
    this.saveData(data);
    return liquidacion;
  }

  async getOperaciones() {
    const data = this.readData();
    return asArray(data.operations)
      .map((operation) => ({
        id: operation.id,
        fecha: operation.fecha,
        tipo: operation.tipo,
        destino: operation.destino,
        estado: operation.estado,
        vendedor: operation.vendedor,
        comprador: operation.comprador,
        consignataria: operation.draftData && operation.draftData.consignataria,
        ventaAnticipada: Boolean(operation.draftData && operation.draftData.ventaAnticipada)
          || String(operation.tipo || "").toUpperCase().includes("ANTICIPADA"),
        total: operation.total,
        lineas: asArray(operation.draftData && operation.draftData.saleLines).length,
        dte: operation.dte,
        renspaOrigen: operation.renspaOrigen,
        renspaDestino: operation.renspaDestino
      }))
      .filter((operation) => operation.id);
  }

  async getCuentaCorrienteResumen() {
    const data = this.readData();
    const movimientos = asArray(data.currentAccountManualMovements);
    const pagos = asArray(data.currentAccountPayments);
    const pagosVigentes = pagos.filter((pago) => !pago.anulado);
    const cuenta = buildAccountData(data);
    return {
      movimientosExternos: movimientos.length,
      pagosCobros: pagosVigentes.length,
      totalMovimientos: movimientos.reduce((sum, item) => sum + parseMoney(item.importe), 0),
      totalPagos: pagosVigentes.reduce((sum, item) => sum + parseMoney(item.importe), 0),
      clientes: cuenta.clientes,
      movimientos: cuenta.movimientos,
      vencimientos: cuenta.vencimientos,
      pagos: cuenta.pagos,
      commissionInvoices: asArray(data.commissionInvoices).filter((invoice) => !invoice.anulado)
    };
  }

  async saveCommissionInvoice(input) {
    const data = this.readData();
    const cuenta = buildAccountData(data);
    const cliente = normalizeText(input.cliente);
    const numero = normalizeText(input.numero);
    const movementIds = asArray(input.movimientos)
      .map((item) => normalizeText(item.movementId || item.id || item))
      .filter(Boolean);
    if (!cliente || !numero || !movementIds.length) {
      const error = new Error("Falta comisionista/consignataria, numero de factura o movimientos seleccionados.");
      error.statusCode = 400;
      throw error;
    }
    const activeInvoices = asArray(data.commissionInvoices).filter((invoice) => !invoice.anulado);
    const alreadyInvoiced = new Set();
    activeInvoices.forEach((invoice) => {
      asArray(invoice.movimientos).forEach((item) => {
        const id = normalizeText(item.movementId || item.id);
        if (id) alreadyInvoiced.add(id);
      });
    });
    const selected = movementIds.map((id) => {
      const movement = asArray(cuenta.movimientos).find((row) => String(row.id) === String(id));
      if (!movement) {
        const error = new Error(`No se encontro el movimiento ${id}.`);
        error.statusCode = 404;
        throw error;
      }
      if (alreadyInvoiced.has(id)) {
        const error = new Error(`El movimiento ${movement.comprobante || id} ya esta incluido en una factura de comisiones.`);
        error.statusCode = 409;
        throw error;
      }
      if (Math.abs(parseMoney(movement.importePendiente ?? movement.importe)) <= 0.01) {
        const error = new Error(`El movimiento ${movement.comprobante || id} no tiene saldo pendiente.`);
        error.statusCode = 409;
        throw error;
      }
      return {
        movementId: id,
        fecha: movement.fecha,
        vencimiento: movement.vencimiento,
        concepto: movement.concepto,
        comprobante: movement.comprobante,
        operacion: movement.operacion,
        contraparte: movement.contraparte || movement.vendedor || movement.comprador || "",
        importe: Math.abs(parseMoney(movement.importePendiente ?? movement.importe))
      };
    });
    const now = new Date().toISOString();
    const saved = {
      id: normalizeText(input.id) || `FCOM-${Date.now()}`,
      cliente,
      numero,
      fecha: input.fecha ? formatDateForDisplay(input.fecha) : formatDateLocal(new Date()),
      periodoDesde: input.periodoDesde ? formatDateForDisplay(input.periodoDesde) : normalizeText(input.periodoDesde),
      periodoHasta: input.periodoHasta ? formatDateForDisplay(input.periodoHasta) : normalizeText(input.periodoHasta),
      observacion: normalizeText(input.observacion),
      movimientos: selected,
      total: selected.reduce((sum, item) => sum + parseMoney(item.importe), 0),
      creadoEn: now,
      actualizadoEn: now
    };
    data.commissionInvoices = asArray(data.commissionInvoices);
    data.commissionInvoices.push(saved);
    this.saveData(data);
    return saved;
  }

  normalizeFieldContract(input = {}) {
    return {
      id: normalizeText(input.id) || `CAMPOS-CONTR-${Date.now()}`,
      nombre: normalizeText(input.nombre),
      arrendador: normalizeText(input.arrendador),
      arrendatario: normalizeText(input.arrendatario),
      campo: normalizeText(input.campo),
      hectareas: parseMoney(input.hectareas),
      inicio: input.inicio ? formatDateForDisplay(input.inicio) : "",
      fin: input.fin ? formatDateForDisplay(input.fin) : "",
      frecuencia: normalizeText(input.frecuencia || "MENSUAL").toUpperCase(),
      vencimientoHabitual: normalizeText(input.vencimientoHabitual),
      proximoVencimiento: input.proximoVencimiento ? formatDateForDisplay(input.proximoVencimiento) : "",
      criterioCotizacion: normalizeText(input.criterioCotizacion),
      facturadoModo: normalizeText(input.facturadoModo || "HECTAREAS").toUpperCase(),
      facturadoValor: parseMoney(input.facturadoValor),
      facturadoBase: normalizeText(input.facturadoBase || "KG_SOJA").toUpperCase(),
      facturadoTasa: parseMoney(input.facturadoTasa),
      efectivoModo: normalizeText(input.efectivoModo || "NINGUNO").toUpperCase(),
      efectivoValor: parseMoney(input.efectivoValor),
      efectivoBase: normalizeText(input.efectivoBase || "MISMA_FACTURADA").toUpperCase(),
      efectivoTasa: parseMoney(input.efectivoTasa),
      condiciones: normalizeText(input.condiciones),
      creadoEn: input.creadoEn || new Date().toISOString(),
      actualizadoEn: new Date().toISOString()
    };
  }

  async getFieldContracts() {
    const data = this.readData();
    return asArray(data.fieldContracts)
      .map((item) => this.normalizeFieldContract(item))
      .sort((a, b) => String(a.nombre || a.arrendador || "").localeCompare(String(b.nombre || b.arrendador || ""), "es"));
  }

  async saveFieldContract(input) {
    const data = this.readData();
    const items = asArray(data.fieldContracts);
    const saved = this.normalizeFieldContract(input);
    const index = items.findIndex((item) => String(item.id) === String(saved.id));
    if (index >= 0) items[index] = { ...items[index], ...saved, creadoEn: items[index].creadoEn || saved.creadoEn };
    else items.unshift(saved);
    data.fieldContracts = items;
    this.saveData(data);
    return saved;
  }

  async deleteFieldContract(itemId) {
    const data = this.readData();
    const id = normalizeText(itemId);
    data.fieldContracts = asArray(data.fieldContracts).filter((item) => String(item.id) !== id);
    this.saveData(data);
    return { id };
  }

  normalizeFieldLease(input = {}) {
    const hectareas = parseMoney(input.hectareas);
    const kgPorHa = parseMoney(input.kgPorHa ?? input.qqPorHa);
    const unidadCotizacion = normalizeText(input.unidadCotizacion || "KG").toUpperCase() === "TN" ? "TN" : "KG";
    const moneda = normalizeText(input.moneda || "ARS").toUpperCase();
    const cotizacion = parseMoney(input.cotizacion);
    const tipoCambio = parseMoney(input.tipoCambio);
    const cuotas = Math.max(Number(input.cuotas || 1), 1);
    const totalKg = hectareas * kgPorHa;
    const totalTn = totalKg / 1000;
    const cotizacionPesos = moneda === "USD" ? cotizacion * tipoCambio : cotizacion;
    const calculatedTotal = unidadCotizacion === "TN" ? totalTn * cotizacionPesos : totalKg * cotizacionPesos;
    const providedFacturado = parseMoney(input.facturadoTotal);
    const providedEfectivo = parseMoney(input.efectivoTotal);
    const totalPesos = providedFacturado || providedEfectivo
      ? providedFacturado + providedEfectivo
      : parseMoney(input.totalPesos) || calculatedTotal;
    const importeCuota = cuotas ? totalPesos / cuotas : totalPesos;
    return {
      id: normalizeText(input.id) || `ARR-${Date.now()}`,
      contrato: normalizeText(input.contrato),
      cliente: normalizeText(input.cliente),
      campo: normalizeText(input.campo),
      fecha: input.fecha ? formatDateForDisplay(input.fecha) : formatDateLocal(new Date()),
      periodoDesde: input.periodoDesde ? formatDateForDisplay(input.periodoDesde) : "",
      periodoHasta: input.periodoHasta ? formatDateForDisplay(input.periodoHasta) : "",
      vencimiento: input.vencimiento ? formatDateForDisplay(input.vencimiento) : "",
      proximoVencimiento: input.proximoVencimiento ? formatDateForDisplay(input.proximoVencimiento) : "",
      hectareas,
      cereal: normalizeText(input.cereal || "SOJA").toUpperCase(),
      mercado: normalizeText(input.mercado),
      kgPorHa,
      unidadCotizacion,
      moneda,
      cotizacion,
      tipoCambio,
      cuotas,
      frecuencia: normalizeText(input.frecuencia || "MENSUAL").toUpperCase(),
      vencimientoHabitual: normalizeText(input.vencimientoHabitual),
      criterioCotizacion: normalizeText(input.criterioCotizacion),
      observaciones: normalizeText(input.observaciones),
      cotizaciones: asArray(input.cotizaciones).map((item) => ({
        id: normalizeText(item.id) || `COT-${Date.now()}`,
        fecha: item.fecha ? formatDateForDisplay(item.fecha) : "",
        mercado: normalizeText(item.mercado),
        producto: normalizeText(item.producto),
        cotizacion: parseMoney(item.cotizacion)
      })),
      facturadoDetalle: input.facturadoDetalle || {},
      efectivoDetalle: input.efectivoDetalle || {},
      facturadoTotal: parseMoney(input.facturadoTotal),
      efectivoTotal: parseMoney(input.efectivoTotal),
      totalKg,
      totalTn,
      cotizacionPesos,
      totalPesos,
      importeCuota,
      actualizadoEn: new Date().toISOString()
    };
  }

  async getFieldLeases() {
    const data = this.readData();
    return asArray(data.fieldLeases)
      .map((item) => this.normalizeFieldLease(item))
      .sort((a, b) => {
        const dateA = parseDateLoose(a.fecha)?.getTime() || 0;
        const dateB = parseDateLoose(b.fecha)?.getTime() || 0;
        return dateB - dateA;
      });
  }

  async saveFieldLease(input) {
    const data = this.readData();
    const items = asArray(data.fieldLeases);
    const saved = {
      ...this.normalizeFieldLease(input),
      creadoEn: input.creadoEn || new Date().toISOString()
    };
    const index = items.findIndex((item) => String(item.id) === String(saved.id));
    if (index >= 0) items[index] = { ...items[index], ...saved, creadoEn: items[index].creadoEn || saved.creadoEn };
    else items.unshift(saved);
    data.fieldLeases = items;
    this.saveData(data);
    return saved;
  }

  async deleteFieldLease(itemId) {
    const data = this.readData();
    const id = normalizeText(itemId);
    data.fieldLeases = asArray(data.fieldLeases).filter((item) => String(item.id) !== id);
    this.saveData(data);
    return { id };
  }

  async getCajaDiaria() {
    const data = this.readData();
    const items = asArray(data.cajaDiaria)
      .map((item) => ({
        id: item.id,
        fecha: item.fecha,
        concepto: item.concepto,
        proveedor: item.proveedor || "",
        categoria: item.categoria || "Gasto oficina",
        importe: parseMoney(item.importe),
        medio: item.medio || "Efectivo",
        origenEfectivo: item.origenEfectivo || "",
        pagadoPor: item.pagadoPor || "",
        comprobante: item.comprobante || "",
        recuperado: Boolean(item.recuperado),
        observacion: item.observacion || "",
        creadoEn: item.creadoEn || "",
        actualizadoEn: item.actualizadoEn || ""
      }))
      .filter((item) => item.id)
      .sort((a, b) => {
        const dateA = parseDateLoose(a.fecha)?.getTime() || 0;
        const dateB = parseDateLoose(b.fecha)?.getTime() || 0;
        return dateB - dateA;
      });
    const today = formatDateLocal(new Date());
    const monthKey = today.slice(3);
    const total = items.reduce((sum, item) => sum + parseMoney(item.importe), 0);
    const totalHoy = items
      .filter((item) => item.fecha === today)
      .reduce((sum, item) => sum + parseMoney(item.importe), 0);
    const totalMes = items
      .filter((item) => String(item.fecha || "").slice(3) === monthKey)
      .reduce((sum, item) => sum + parseMoney(item.importe), 0);
    const pendienteRecuperar = items
      .filter((item) => !item.recuperado)
      .reduce((sum, item) => sum + parseMoney(item.importe), 0);
    return { items, total, totalHoy, totalMes, pendienteRecuperar };
  }

  async saveCajaDiaria(input) {
    const data = this.readData();
    const items = asArray(data.cajaDiaria);
    const id = normalizeText(input.id) || `CAJA-${Date.now()}`;
    const concepto = normalizeText(input.concepto);
    const importe = Math.abs(parseMoney(input.importe));
    if (!concepto || !importe) {
      const error = new Error("Falta cargar concepto e importe de caja.");
      error.statusCode = 400;
      throw error;
    }
    const now = new Date().toISOString();
    const index = items.findIndex((item) => String(item.id) === String(id));
    const saved = {
      id,
      fecha: input.fecha ? formatDateForDisplay(input.fecha) : formatDateLocal(new Date()),
      concepto,
      proveedor: normalizeText(input.proveedor),
      categoria: normalizeText(input.categoria) || "Gasto oficina",
      importe,
      medio: normalizeText(input.medio) || "Efectivo",
      origenEfectivo: normalizeText(input.origenEfectivo),
      pagadoPor: normalizeText(input.pagadoPor),
      comprobante: normalizeText(input.comprobante),
      recuperado: Boolean(input.recuperado),
      observacion: normalizeText(input.observacion),
      creadoEn: index >= 0 ? items[index].creadoEn || now : now,
      actualizadoEn: now
    };
    if (index >= 0) {
      items[index] = { ...items[index], ...saved };
    } else {
      items.push(saved);
    }
    data.cajaDiaria = items;
    this.saveData(data);
    return saved;
  }

  async deleteCajaDiaria(itemId) {
    const data = this.readData();
    const items = asArray(data.cajaDiaria);
    const id = normalizeText(itemId);
    const next = items.filter((item) => String(item.id) !== id);
    if (next.length === items.length) {
      const error = new Error("No se encontro el movimiento de caja.");
      error.statusCode = 404;
      throw error;
    }
    data.cajaDiaria = next;
    this.saveData(data);
    return { id };
  }

  async getCajaConciliaciones() {
    const data = this.readData();
    const items = asArray(data.cajaConciliaciones)
      .map((item) => {
        const detalleRecibido = asArray(item.detalleRecibido)
          .map((detail, index) => ({
            id: detail.id || `DET-${index}`,
            concepto: detail.concepto || "",
            detalle: detail.detalle || "",
            importe: parseMoney(detail.importe)
          }))
          .filter((detail) => detail.concepto && detail.importe);
        const aplicaciones = asArray(item.aplicaciones)
          .map((app) => ({
            id: app.id || `APP-${Date.now()}`,
            fecha: app.fecha || "",
            concepto: app.concepto || "",
            destino: app.destino || "",
            importe: parseMoney(app.importe)
          }))
          .filter((app) => app.concepto && app.importe);
        const importeRecibido = parseMoney(item.importeRecibido);
        const totalAplicado = aplicaciones.reduce((sum, app) => sum + parseMoney(app.importe), 0);
        return {
          id: item.id,
          fecha: item.fecha,
          recibidoDe: item.recibidoDe || "",
          referencia: item.referencia || "",
          importeRecibido,
          detalleRecibido,
          aplicaciones,
          totalAplicado,
          saldo: Math.round((importeRecibido - totalAplicado) * 100) / 100,
          observacion: item.observacion || "",
          creadoEn: item.creadoEn || "",
          actualizadoEn: item.actualizadoEn || ""
        };
      })
      .filter((item) => item.id)
      .sort((a, b) => (parseDateLoose(b.fecha)?.getTime() || 0) - (parseDateLoose(a.fecha)?.getTime() || 0));
    const totalRecibido = items.reduce((sum, item) => sum + parseMoney(item.importeRecibido), 0);
    const totalAplicado = items.reduce((sum, item) => sum + parseMoney(item.totalAplicado), 0);
    const saldo = Math.round((totalRecibido - totalAplicado) * 100) / 100;
    const abiertas = items.filter((item) => Math.abs(parseMoney(item.saldo)) > 0.01).length;
    return { items, totalRecibido, totalAplicado, saldo, abiertas };
  }

  async saveCajaConciliacion(input) {
    const data = this.readData();
    const items = asArray(data.cajaConciliaciones);
    const id = normalizeText(input.id) || `CONC-${Date.now()}`;
    const recibidoDe = normalizeText(input.recibidoDe);
    const importeRecibido = Math.abs(parseMoney(input.importeRecibido));
    if (!recibidoDe || !importeRecibido) {
      const error = new Error("Falta cargar quien dejo el efectivo y el importe recibido.");
      error.statusCode = 400;
      throw error;
    }
    const aplicaciones = asArray(input.aplicaciones)
      .map((app, index) => ({
        id: normalizeText(app.id) || `APP-${Date.now()}-${index}`,
        fecha: app.fecha ? formatDateForDisplay(app.fecha) : formatDateForDisplay(input.fecha),
        concepto: normalizeText(app.concepto),
        destino: normalizeText(app.destino),
        importe: Math.abs(parseMoney(app.importe))
      }))
      .filter((app) => app.concepto && app.importe);
    const detalleRecibido = asArray(input.detalleRecibido)
      .map((detail, index) => ({
        id: normalizeText(detail.id) || `DET-${Date.now()}-${index}`,
        concepto: normalizeText(detail.concepto),
        detalle: normalizeText(detail.detalle),
        importe: Math.abs(parseMoney(detail.importe))
      }))
      .filter((detail) => detail.concepto && detail.importe);
    const totalAplicado = aplicaciones.reduce((sum, app) => sum + parseMoney(app.importe), 0);
    const totalDetalle = detalleRecibido.reduce((sum, detail) => sum + parseMoney(detail.importe), 0);
    if (totalDetalle - importeRecibido > 0.02) {
      const error = new Error("La discriminacion del efectivo no puede superar el importe recibido.");
      error.statusCode = 400;
      throw error;
    }
    if (totalAplicado - importeRecibido > 0.02) {
      const error = new Error("Las aplicaciones no pueden superar el efectivo recibido.");
      error.statusCode = 400;
      throw error;
    }
    const now = new Date().toISOString();
    const index = items.findIndex((item) => String(item.id) === String(id));
    const saved = {
      id,
      fecha: input.fecha ? formatDateForDisplay(input.fecha) : formatDateLocal(new Date()),
      recibidoDe,
      referencia: normalizeText(input.referencia),
      importeRecibido,
      detalleRecibido,
      aplicaciones,
      observacion: normalizeText(input.observacion),
      creadoEn: index >= 0 ? items[index].creadoEn || now : now,
      actualizadoEn: now
    };
    if (index >= 0) items[index] = { ...items[index], ...saved };
    else items.push(saved);
    data.cajaConciliaciones = items;
    this.saveData(data);
    return saved;
  }

  async deleteCajaConciliacion(itemId) {
    const data = this.readData();
    const items = asArray(data.cajaConciliaciones);
    const id = normalizeText(itemId);
    const next = items.filter((item) => String(item.id) !== id);
    if (next.length === items.length) {
      const error = new Error("No se encontro la conciliacion de efectivo.");
      error.statusCode = 404;
      throw error;
    }
    data.cajaConciliaciones = next;
    this.saveData(data);
    return { id };
  }

  async applyCajaConciliacionPago(input) {
    const data = this.readData();
    const items = asArray(data.cajaConciliaciones);
    const selectedIds = asArray(input.conciliacionIds).map((id) => normalizeText(id)).filter(Boolean);
    const importeTotal = Math.abs(parseMoney(input.importe));
    const concepto = normalizeText(input.concepto);
    if (!selectedIds.length || !importeTotal || !concepto) {
      const error = new Error("Seleccione ingresos de efectivo y cargue concepto e importe del pago.");
      error.statusCode = 400;
      throw error;
    }
    let remaining = importeTotal;
    const applied = [];
    const now = new Date().toISOString();
    for (const id of selectedIds) {
      if (remaining <= 0.01) break;
      const item = items.find((row) => String(row.id) === id);
      if (!item) continue;
      const aplicaciones = asArray(item.aplicaciones);
      const usado = aplicaciones.reduce((sum, app) => sum + parseMoney(app.importe), 0);
      const saldo = Math.max(parseMoney(item.importeRecibido) - usado, 0);
      if (saldo <= 0.01) continue;
      const importe = Math.min(saldo, remaining);
      aplicaciones.push({
        id: `APP-${Date.now()}-${applied.length}`,
        fecha: input.fecha ? formatDateForDisplay(input.fecha) : formatDateLocal(new Date()),
        concepto,
        destino: normalizeText(input.destino),
        importe
      });
      item.aplicaciones = aplicaciones;
      item.actualizadoEn = now;
      remaining = Math.round((remaining - importe) * 100) / 100;
      applied.push({ id, importe });
    }
    if (remaining > 0.01) {
      const error = new Error("El importe supera el saldo disponible en los ingresos seleccionados.");
      error.statusCode = 400;
      throw error;
    }
    data.cajaConciliaciones = items;
    this.saveData(data);
    return { aplicado: applied, total: importeTotal };
  }

  async getDocumentos(filters = {}) {
    const data = this.readData();
    const entidadTipo = normalizeText(filters.entidadTipo);
    const entidadId = normalizeText(filters.entidadId);
    const cliente = normalizeKey(filters.cliente);
    const operacion = normalizeText(filters.operacion);
    const movimientoId = normalizeText(filters.movimientoId);
    return asArray(data.documentos)
      .filter((item) => !entidadTipo || item.entidadTipo === entidadTipo)
      .filter((item) => !entidadId || item.entidadId === entidadId)
      .filter((item) => !cliente || normalizeKey(item.cliente) === cliente)
      .filter((item) => !operacion || item.operacion === operacion)
      .filter((item) => !movimientoId || item.movimientoId === movimientoId)
      .sort((a, b) => String(b.creadoEn || "").localeCompare(String(a.creadoEn || "")));
  }

  async getDocumento(documentId) {
    const data = this.readData();
    return asArray(data.documentos).find((item) => String(item.id) === String(documentId)) || null;
  }

  async saveDocumento(input) {
    const data = this.readData();
    const documentos = asArray(data.documentos);
    const id = normalizeText(input.id) || `DOC-${Date.now()}`;
    const now = new Date().toISOString();
    const saved = {
      id,
      entidadTipo: normalizeText(input.entidadTipo || "GENERAL"),
      entidadId: normalizeText(input.entidadId || ""),
      cliente: normalizeText(input.cliente),
      operacion: normalizeText(input.operacion),
      movimientoId: normalizeText(input.movimientoId),
      pagoId: normalizeText(input.pagoId),
      parte: normalizeText(input.parte),
      tipo: normalizeText(input.tipo || "Comprobante"),
      titulo: normalizeText(input.titulo || input.nombreOriginal || "Comprobante PDF"),
      observacion: normalizeText(input.observacion),
      nombreOriginal: normalizeText(input.nombreOriginal),
      mimeType: normalizeText(input.mimeType || "application/pdf"),
      bytes: Number(input.bytes || 0),
      storageProvider: normalizeText(input.storageProvider),
      storageBucket: normalizeText(input.storageBucket),
      storagePath: normalizeText(input.storagePath),
      creadoEn: now,
      actualizadoEn: now
    };
    const index = documentos.findIndex((item) => String(item.id) === String(id));
    if (index >= 0) documentos[index] = { ...documentos[index], ...saved, creadoEn: documentos[index].creadoEn || now };
    else documentos.push(saved);
    data.documentos = documentos;
    this.saveData(data);
    return saved;
  }

  async deleteDocumento(documentId) {
    const data = this.readData();
    const documentos = asArray(data.documentos);
    const id = normalizeText(documentId);
    const next = documentos.filter((item) => String(item.id) !== id);
    if (next.length === documentos.length) {
      const error = new Error("No se encontro el documento.");
      error.statusCode = 404;
      throw error;
    }
    data.documentos = next;
    this.saveData(data);
    return { id };
  }

  async saveMovimientoExterno(input) {
    const data = this.readData();
    const baseId = `EXT-${Date.now()}`;
    const savedItems = buildExternalMovementItems(input, baseId);
    data.currentAccountManualMovements = asArray(data.currentAccountManualMovements);
    data.currentAccountManualMovements.push(...savedItems);
    this.saveData(data);
    return savedItems.length === 1 ? savedItems[0] : { items: savedItems };
  }

  async updateMovimientoExterno(movementId, input) {
    const data = this.readData();
    const movements = asArray(data.currentAccountManualMovements);
    const requestedId = normalizeText(movementId);
    const baseId = externalMovementBaseId(requestedId);
    const groupIds = movements
      .filter((item) => externalMovementBaseId(item.id) === baseId)
      .map((item) => String(item.id));
    if (!groupIds.length) {
      const error = new Error("No se encontro el movimiento externo.");
      error.statusCode = 404;
      throw error;
    }
    const hasActiveImputation = asArray(data.currentAccountPayments)
      .filter((payment) => !payment.anulado)
      .some((payment) => asArray(payment.imputaciones)
        .some((item) => groupIds.includes(String(item.movementId || item.rowId || ""))));
    if (hasActiveImputation) {
      const error = new Error("Este movimiento ya tiene imputaciones activas. Anula primero el pago/cobro asociado y luego corregilo.");
      error.statusCode = 409;
      throw error;
    }
    const savedItems = buildExternalMovementItems(input, baseId);
    data.currentAccountManualMovements = movements
      .filter((item) => externalMovementBaseId(item.id) !== baseId)
      .concat(savedItems);
    this.saveData(data);
    return savedItems.length === 1 ? savedItems[0] : { items: savedItems };
  }

  async deleteMovimientoExterno(movementId) {
    const data = this.readData();
    const movements = asArray(data.currentAccountManualMovements);
    const requestedId = normalizeText(movementId);
    const baseId = externalMovementBaseId(requestedId);
    const groupIds = movements
      .filter((item) => externalMovementBaseId(item.id) === baseId)
      .map((item) => String(item.id));
    if (!groupIds.length) {
      const error = new Error("No se encontro el movimiento externo.");
      error.statusCode = 404;
      throw error;
    }
    const hasActiveImputation = asArray(data.currentAccountPayments)
      .filter((payment) => !payment.anulado)
      .some((payment) => asArray(payment.imputaciones)
        .some((item) => groupIds.includes(String(item.movementId || item.rowId || ""))));
    if (hasActiveImputation) {
      const error = new Error("Este movimiento ya tiene imputaciones activas. Anula primero el pago/cobro asociado y luego eliminalo.");
      error.statusCode = 409;
      throw error;
    }
    data.currentAccountManualMovements = movements
      .filter((item) => externalMovementBaseId(item.id) !== baseId);
    this.saveData(data);
    return { id: baseId, eliminados: groupIds };
  }

  async savePagoCobro(input) {
    const data = this.readData();
    const cliente = normalizeText(input.cliente);
    const importe = Math.abs(parseMoney(input.importe));
    const tipoInput = normalizeKey(input.tipo);
    const tipo = tipoInput === "PAGO" ? "PAGO" : tipoInput === "COMPENSACION" ? "COMPENSACION" : "COBRO";
    const imputacionesInput = asArray(input.imputaciones)
      .map((item) => ({ movementId: normalizeText(item.movementId || item.rowId), importe: Math.abs(parseMoney(item.importe)) }))
      .filter((item) => item.movementId);
    if (!cliente || (!importe && !(tipo === "COMPENSACION" && imputacionesInput.length))) {
      const error = new Error("Falta seleccionar cliente o cargar un importe mayor a cero.");
      error.statusCode = 400;
      throw error;
    }
    const payments = asArray(data.currentAccountPayments);
    const year = new Date().getFullYear();
    const prefix = tipo === "PAGO" ? "PAG" : tipo === "COMPENSACION" ? "COMP" : "COB";
    const number = payments.reduce((max, item) => {
      const match = String(item.id || "").match(new RegExp(`^(?:PAG|COB|COMP)-${year}-(\\d+)$`));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const saved = {
      id: `${prefix}-${year}-${String(number).padStart(4, "0")}`,
      tipo,
      cliente,
      fecha: formatDateForDisplay(input.fecha),
      importe,
      importeFirmado: input.importeFirmado !== undefined && input.importeFirmado !== "" ? parseMoney(input.importeFirmado) : undefined,
      medio: normalizeText(input.medio || "Transferencia"),
      referencia: normalizeText(input.referencia),
      observacion: normalizeText(input.observacion),
      compensationOriginId: normalizeText(input.compensationOriginId),
      compensationOriginLabel: normalizeText(input.compensationOriginLabel),
      instrumentos: asArray(input.instrumentos).map((item) => ({
        id: normalizeText(item.id) || `INST-${Date.now()}`,
        medio: normalizeText(item.medio),
        fecha: formatDateForDisplay(item.fecha),
        referencia: normalizeText(item.referencia),
        importe: Math.abs(parseMoney(item.importe))
      })),
      imputaciones: imputacionesInput
    };
    const accountMovementsForPairing = asArray(data.operations).flatMap((operation) => buildOperationAccountMovements(operation));
    payments.push(saved);
    const counterpartyInput = input.contrapartida || null;
    let counterparty = null;
    if (counterpartyInput && normalizeText(counterpartyInput.cliente)) {
      counterparty = {
        ...saved,
        id: `${saved.id}-CP`,
        tipo: normalizeKey(counterpartyInput.tipo) === "COBRO" ? "COBRO" : "PAGO",
        cliente: normalizeText(counterpartyInput.cliente),
        referencia: saved.referencia ? `${saved.referencia} / contrapartida` : `Contrapartida ${saved.id}`,
        instrumentos: saved.instrumentos.map((item) => ({ ...item })),
        imputaciones: asArray(counterpartyInput.imputaciones)
          .map((item) => ({ movementId: normalizeText(item.movementId || item.rowId), importe: Math.abs(parseMoney(item.importe)) }))
          .filter((item) => item.movementId)
      };
      mirrorPaymentPairImputations(saved, counterparty, accountMovementsForPairing);
      payments.push(counterparty);
    }
    data.currentAccountPayments = payments;
    this.saveData(data);
    return counterparty ? { ...saved, contrapartida: counterparty } : saved;
  }

  async anularPagoCobro(paymentId) {
    const data = this.readData();
    const payments = asArray(data.currentAccountPayments);
    const requestedId = normalizeText(paymentId);
    const rootId = requestedId.endsWith("-CP") ? requestedId.slice(0, -3) : requestedId;
    const affected = payments.filter((payment) => payment.id === rootId || payment.id === `${rootId}-CP`);
    if (!affected.length) {
      const error = new Error("No se encontro el comprobante de pago / cobro.");
      error.statusCode = 404;
      throw error;
    }
    const anuladoEn = new Date().toISOString();
    affected.forEach((payment) => {
      payment.anulado = true;
      payment.anuladoEn = anuladoEn;
    });
    data.currentAccountPayments = payments;
    this.saveData(data);
    return { id: rootId, comprobantes: affected.map((payment) => payment.id), anuladoEn };
  }
}

class PostgresJsonDataSource extends BackupDataSource {
  constructor(databaseUrl) {
    super(DEFAULT_BACKUP_PATH, path.join(__dirname, "data", "postgres-runtime-cache.json"));
    this.databaseUrl = databaseUrl;
    this.pool = null;
    this.queue = Promise.resolve();
    this.insideRemote = false;
  }

  mode() {
    return "postgres";
  }

  async getPool() {
    if (this.pool) return this.pool;
    let Pool;
    try {
      Pool = require("pg").Pool;
    } catch (error) {
      throw new Error("La app tiene DATABASE_URL, pero falta instalar pg con: npm install");
    }
    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 5
    });
    return this.pool;
  }

  async withRemoteData(callback, persist = false) {
    if (this.insideRemote) return callback();
    const task = async () => {
      const pool = await this.getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(20260602)");
        const result = await client.query("SELECT data FROM app_state WHERE id = 1");
        if (!result.rows.length) throw new Error("Falta cargar app_state en PostgreSQL.");
        writeJson(this.appDataPath, result.rows[0].data);
        this.insideRemote = true;
        const value = await callback();
        if (persist) {
          await client.query(
            "UPDATE app_state SET data = $1::jsonb, actualizado_en = now() WHERE id = 1",
            [JSON.stringify(readJson(this.appDataPath))]
          );
        }
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        this.insideRemote = false;
        client.release();
      }
    };
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  async health() {
    const pool = await this.getPool();
    const result = await pool.query("SELECT now() AS fecha");
    return { ok: true, modo: this.mode(), fuente: "PostgreSQL - app_state", fecha: result.rows[0].fecha };
  }

  async createSession(email, password) {
    const pool = await this.getPool();
    const result = await pool.query(
      "SELECT id, nombre, email, password_hash, rol FROM usuarios WHERE lower(email) = lower($1) AND activo = TRUE LIMIT 1",
      [normalizeText(email)]
    );
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await pool.query(
      "INSERT INTO sesiones (usuario_id, token_hash, expira_en) VALUES ($1, $2, now() + interval '12 hours')",
      [user.id, tokenHash]
    );
    return { token, usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } };
  }

  async getSession(token) {
    if (!token) return null;
    const pool = await this.getPool();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const result = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol
       FROM sesiones s
       JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.token_hash = $1 AND s.expira_en > now() AND u.activo = TRUE
       LIMIT 1`,
      [tokenHash]
    );
    return result.rows[0] || null;
  }

  async deleteSession(token) {
    if (!token) return;
    const pool = await this.getPool();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await pool.query("DELETE FROM sesiones WHERE token_hash = $1", [tokenHash]);
  }

  async getClientes() { return this.withRemoteData(() => super.getClientes()); }
  async saveCliente(input) { return this.withRemoteData(() => super.saveCliente(input), true); }
  async mergeCliente(sourceId, input) { return this.withRemoteData(() => super.mergeCliente(sourceId, input), true); }
  async deleteCliente(clientId) { return this.withRemoteData(() => super.deleteCliente(clientId), true); }
  async getEstablecimientos(clienteId) { return this.withRemoteData(() => super.getEstablecimientos(clienteId)); }
  async saveEstablecimiento(clienteId, input) { return this.withRemoteData(() => super.saveEstablecimiento(clienteId, input), true); }
  async ensureEstablecimiento(clienteId, renspa, nombre) { return this.withRemoteData(() => super.ensureEstablecimiento(clienteId, renspa, nombre), true); }
  async saveOperacion(input) { return this.withRemoteData(() => super.saveOperacion(input), true); }
  async getCategorias() { return this.withRemoteData(() => super.getCategorias()); }
  async saveCategoria(currentName, input) { return this.withRemoteData(() => super.saveCategoria(currentName, input), true); }
  async deleteCategoria(currentName) { return this.withRemoteData(() => super.deleteCategoria(currentName), true); }
  async getTabRules() { return this.withRemoteData(() => super.getTabRules()); }
  async saveTabRule(input) { return this.withRemoteData(() => super.saveTabRule(input), true); }
  async getOperacionDetalle(operationId) { return this.withRemoteData(() => super.getOperacionDetalle(operationId)); }
  async saveVentaLinea(operationId, input) { return this.withRemoteData(() => super.saveVentaLinea(operationId, input), true); }
  async updateVentaLinea(operationId, lineId, input) { return this.withRemoteData(() => super.updateVentaLinea(operationId, lineId, input), true); }
  async deleteVentaLinea(operationId, lineId) { return this.withRemoteData(() => super.deleteVentaLinea(operationId, lineId), true); }
  async saveFacturacionParcial(operationId, input) { return this.withRemoteData(() => super.saveFacturacionParcial(operationId, input), true); }
  async deleteFacturacionParcial(operationId, lineId) { return this.withRemoteData(() => super.deleteFacturacionParcial(operationId, lineId), true); }
  async saveLiquidacion(operationId, input) { return this.withRemoteData(() => super.saveLiquidacion(operationId, input), true); }
  async getOperaciones() { return this.withRemoteData(() => super.getOperaciones()); }
  async getCuentaCorrienteResumen() { return this.withRemoteData(() => super.getCuentaCorrienteResumen()); }
  async saveCommissionInvoice(input) { return this.withRemoteData(() => super.saveCommissionInvoice(input), true); }
  async getFieldContracts() { return this.withRemoteData(() => super.getFieldContracts()); }
  async saveFieldContract(input) { return this.withRemoteData(() => super.saveFieldContract(input), true); }
  async deleteFieldContract(itemId) { return this.withRemoteData(() => super.deleteFieldContract(itemId), true); }
  async getFieldLeases() { return this.withRemoteData(() => super.getFieldLeases()); }
  async saveFieldLease(input) { return this.withRemoteData(() => super.saveFieldLease(input), true); }
  async deleteFieldLease(itemId) { return this.withRemoteData(() => super.deleteFieldLease(itemId), true); }
  async getCajaDiaria() { return this.withRemoteData(() => super.getCajaDiaria()); }
  async saveCajaDiaria(input) { return this.withRemoteData(() => super.saveCajaDiaria(input), true); }
  async deleteCajaDiaria(itemId) { return this.withRemoteData(() => super.deleteCajaDiaria(itemId), true); }
  async getCajaConciliaciones() { return this.withRemoteData(() => super.getCajaConciliaciones()); }
  async saveCajaConciliacion(input) { return this.withRemoteData(() => super.saveCajaConciliacion(input), true); }
  async deleteCajaConciliacion(itemId) { return this.withRemoteData(() => super.deleteCajaConciliacion(itemId), true); }
  async applyCajaConciliacionPago(input) { return this.withRemoteData(() => super.applyCajaConciliacionPago(input), true); }
  async getDocumentos(filters) { return this.withRemoteData(() => super.getDocumentos(filters)); }
  async getDocumento(documentId) { return this.withRemoteData(() => super.getDocumento(documentId)); }
  async saveDocumento(input) { return this.withRemoteData(() => super.saveDocumento(input), true); }
  async deleteDocumento(documentId) { return this.withRemoteData(() => super.deleteDocumento(documentId), true); }
  async saveMovimientoExterno(input) { return this.withRemoteData(() => super.saveMovimientoExterno(input), true); }
  async updateMovimientoExterno(movementId, input) { return this.withRemoteData(() => super.updateMovimientoExterno(movementId, input), true); }
  async deleteMovimientoExterno(movementId) { return this.withRemoteData(() => super.deleteMovimientoExterno(movementId), true); }
  async savePagoCobro(input) { return this.withRemoteData(() => super.savePagoCobro(input), true); }
  async anularPagoCobro(paymentId) { return this.withRemoteData(() => super.anularPagoCobro(paymentId), true); }
  async exportBackup() { return this.withRemoteData(() => super.exportBackup()); }
}

function verifyPassword(password, storedHash) {
  const [algorithm, salt, expected] = String(storedHash || "").split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

class PostgresDataSource {
  constructor(databaseUrl) {
    this.databaseUrl = databaseUrl;
    this.client = null;
  }

  mode() {
    return "postgres";
  }

  async getClient() {
    if (this.client) return this.client;
    let PgClient;
    try {
      PgClient = require("pg").Client;
    } catch (error) {
      throw new Error("La app tiene DATABASE_URL, pero falta instalar pg con: npm install");
    }
    this.client = new PgClient({ connectionString: this.databaseUrl });
    await this.client.connect();
    return this.client;
  }

  async query(sql, params) {
    const client = await this.getClient();
    return client.query(sql, params);
  }

  async health() {
    const result = await this.query("SELECT now() AS fecha");
    return {
      ok: true,
      modo: this.mode(),
      fuente: "PostgreSQL",
      fecha: result.rows[0].fecha
    };
  }

  async getClientes() {
    const result = await this.query(
      `SELECT id, razon_social, cuit, tipo, observaciones
       FROM clientes
       WHERE activo = TRUE
       ORDER BY razon_social`
    );
    return result.rows.map((client) => ({
      id: client.id,
      nombre: client.razon_social,
      cuit: client.cuit || "",
      tipo: client.tipo || "Cliente",
      observaciones: client.observaciones || ""
    }));
  }

  async saveCliente(input) {
    const id = input.id || null;
    const name = normalizeText(input.nombre);
    const cuit = normalizeText(input.cuit);
    const tipo = normalizeText(input.tipo) || "Cliente";
    const observaciones = normalizeText(input.observaciones);

    if (!name) {
      const error = new Error("Falta cargar la razon social.");
      error.statusCode = 400;
      throw error;
    }

    const duplicateParams = [name, normalizeCuit(cuit), id];
    const duplicate = await this.query(
      `SELECT razon_social, cuit
       FROM clientes
       WHERE activo = TRUE
         AND ($3::uuid IS NULL OR id <> $3::uuid)
         AND (
           upper(trim(razon_social)) = upper(trim($1))
           OR ($2 <> '' AND regexp_replace(COALESCE(cuit, ''), '\\D', '', 'g') = $2)
         )
       LIMIT 1`,
      duplicateParams
    );
    if (duplicate.rows.length) {
      const error = new Error(`Ya existe un cliente similar: ${duplicate.rows[0].razon_social}`);
      error.statusCode = 409;
      error.code = "DUPLICATE_CLIENT";
      throw error;
    }

    if (id) {
      const result = await this.query(
        `UPDATE clientes
         SET razon_social = $1, cuit = $2, tipo = $3, observaciones = $4, actualizado_en = now()
         WHERE id = $5
         RETURNING id, razon_social, cuit, tipo, observaciones`,
        [name, cuit || null, tipo, observaciones || null, id]
      );
      return {
        id: result.rows[0].id,
        nombre: result.rows[0].razon_social,
        cuit: result.rows[0].cuit || "",
        tipo: result.rows[0].tipo || "Cliente",
        observaciones: result.rows[0].observaciones || ""
      };
    }

    const result = await this.query(
      `INSERT INTO clientes (razon_social, cuit, tipo, observaciones)
       VALUES ($1, $2, $3, $4)
       RETURNING id, razon_social, cuit, tipo, observaciones`,
      [name, cuit || null, tipo, observaciones || null]
    );
    return {
      id: result.rows[0].id,
      nombre: result.rows[0].razon_social,
      cuit: result.rows[0].cuit || "",
      tipo: result.rows[0].tipo || "Cliente",
      observaciones: result.rows[0].observaciones || ""
    };
  }

  async getEstablecimientos(clienteId) {
    const result = await this.query(
      `SELECT e.nombre, e.renspa, e.observaciones, c.razon_social AS cliente
       FROM establecimientos e
       JOIN clientes c ON c.id = e.cliente_id
       WHERE e.cliente_id = $1 AND e.activo = TRUE
       ORDER BY e.nombre`,
      [clienteId]
    );
    return result.rows.map((item) => ({
      cliente: item.cliente,
      nombre: item.nombre,
      renspa: item.renspa || "",
      observaciones: item.observaciones || ""
    }));
  }

  async saveEstablecimiento(clienteId, input) {
    const nombre = normalizeText(input.nombre) || "Establecimiento";
    const renspa = normalizeText(input.renspa);
    const observaciones = normalizeText(input.observaciones);
    if (!renspa) {
      const error = new Error("Falta cargar el RENSPA.");
      error.statusCode = 400;
      throw error;
    }

    const result = await this.query(
      `INSERT INTO establecimientos (cliente_id, nombre, renspa, observaciones)
       VALUES ($1, $2, $3, $4)
       RETURNING nombre, renspa, observaciones`,
      [clienteId, nombre, renspa, observaciones || null]
    );
    return {
      nombre: result.rows[0].nombre,
      renspa: result.rows[0].renspa || "",
      observaciones: result.rows[0].observaciones || ""
    };
  }

  async saveOperacion(input) {
    const vendedorId = input.vendedorId || null;
    const compradorId = input.compradorId || null;
    const consignatariaId = input.consignatariaId || null;
    if (!vendedorId || !compradorId) {
      const error = new Error("Falta seleccionar vendedor y comprador.");
      error.statusCode = 400;
      throw error;
    }
    const next = await this.query(
      `SELECT COALESCE(MAX((regexp_match(codigo, '^2026-(\\d+)$'))[1]::int), 0) + 1 AS numero
       FROM operaciones
       WHERE codigo ~ '^2026-\\d+$'`
    );
    const codigo = input.id || `2026-${String(Number(next.rows[0].numero || 1)).padStart(4, "0")}`;
    const result = await this.query(
      `INSERT INTO operaciones
        (codigo, fecha_operacion, tipo, destino, estado, vendedor_id, comprador_id, consignataria_id,
         dte, renspa_origen, renspa_destino, condiciones, datos_json)
       VALUES ($1, $2, $3, $4, 'BORRADOR', $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING codigo`,
      [
        codigo,
        formatDateForDb(input.fecha),
        input.tipo || "DIRECTA",
        input.destino || "INVERNADA",
        vendedorId,
        compradorId,
        consignatariaId,
        normalizeText(input.dte),
        normalizeText(input.renspaOrigen),
        normalizeText(input.renspaDestino),
        normalizeText(input.condiciones),
        input
      ]
    );
    return { id: result.rows[0].codigo };
  }

  async getCategorias() {
    const result = await this.query("SELECT nombre FROM categorias WHERE activa = TRUE ORDER BY nombre");
    return result.rows.map((row) => row.nombre);
  }

  async saveCategoria(currentName, input) {
    const current = normalizeText(currentName);
    const nombre = normalizeText(input.nombre).toUpperCase();
    if (!current || !nombre) {
      const error = new Error("La categoria no puede quedar vacia.");
      error.statusCode = 400;
      throw error;
    }
    const result = await this.query(
      "UPDATE categorias SET nombre = $1 WHERE nombre = $2 RETURNING nombre",
      [nombre, current]
    );
    if (!result.rows.length) {
      const error = new Error("No se encontro la categoria.");
      error.statusCode = 404;
      throw error;
    }
    return result.rows[0].nombre;
  }

  async deleteCategoria(currentName) {
    const current = normalizeText(currentName);
    await this.query("UPDATE categorias SET activa = FALSE WHERE nombre = $1", [current]);
    return { nombre: current };
  }

  async getOperacionDetalle(operationId) {
    const operaciones = await this.getOperaciones();
    const operation = operaciones.find((item) => String(item.id) === String(operationId));
    if (!operation) {
      const error = new Error("No se encontro la operacion.");
      error.statusCode = 404;
      throw error;
    }
    const result = await this.query(
      `SELECT categoria_texto AS categoria, cabezas, kg_bruto AS "kgBruto",
              desbaste_vend AS "desbasteVend", kg_neto_vend AS "kgNetoVend",
              precio_base_vend AS "precioVend", tipo_precio_vend AS "tipoPrecioVend",
              importe_vend AS "importeVend"
       FROM venta_lineas vl
       JOIN operaciones o ON o.id = vl.operacion_id
       WHERE o.codigo = $1
       ORDER BY vl.id`,
      [operationId]
    );
    return { ...operation, saleLines: result.rows, liquidacion: null, condiciones: "" };
  }

  async saveVentaLinea(operationId, input) {
    const line = calculateSaleLine(input);
    const op = await this.query("SELECT id FROM operaciones WHERE codigo = $1", [operationId]);
    if (!op.rows.length) {
      const error = new Error("No se encontro la operacion.");
      error.statusCode = 404;
      throw error;
    }
    await this.query(
      `INSERT INTO categorias (nombre)
       VALUES ($1)
       ON CONFLICT (nombre) DO NOTHING`,
      [line.categoria]
    );
    const category = await this.query("SELECT id FROM categorias WHERE nombre = $1", [line.categoria]);
    await this.query(
      `INSERT INTO venta_lineas
        (operacion_id, categoria_id, categoria_texto, cabezas, kg_bruto, desbaste_vend,
         kg_neto_vend, tipo_precio_vend, precio_base_vend, precio_final_vend, importe_vend,
         comprador_diferente, desbaste_comp, kg_comp, tipo_precio_comp, precio_base_comp,
         precio_final_comp, importe_comp, datos_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17)`,
      [
        op.rows[0].id,
        category.rows[0].id,
        line.categoria,
        line.cabezas,
        line.kgBruto,
        line.desbasteVend,
        line.kgNetoVend,
        line.tipoPrecioVend,
        line.precioVend,
        line.importeVend,
        line.compradorDiferente,
        line.desbasteComp,
        line.kgComp,
        line.tipoPrecioComp,
        line.precioComp,
        line.importeComp,
        line
      ]
    );
    return { line };
  }

  async saveLiquidacion(operationId, input) {
    const detail = await this.getOperacionDetalle(operationId);
    const operation = {
      draftData: { saleLines: detail.saleLines }
    };
    const liquidacion = calculateLiquidacion(operation, input);
    const op = await this.query("SELECT id FROM operaciones WHERE codigo = $1", [operationId]);
    if (!op.rows.length) {
      const error = new Error("No se encontro la operacion.");
      error.statusCode = 404;
      throw error;
    }
    await this.query(
      `INSERT INTO liquidaciones
        (operacion_id, parte, tipo_liquidacion, comprobante, fecha, importe_bruto, importe_facturado,
         iva, efectivo, comision_facturado, comision_efectivo, neto_liquidacion, neto_total, estado, observaciones, datos_json)
       VALUES
        ($1, 'PRODUCTOR', 'NORMAL', $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8, $9, $10, 'CONFIRMADA', $11, $12),
        ($1, 'COMPRADOR', 'NORMAL', $13, CURRENT_DATE, $14, $4, $15, $16, $17, $18, $19, $20, 'CONFIRMADA', $11, $12)`,
      [
        op.rows[0].id,
        liquidacion.comprobanteProd,
        liquidacion.brutoVend,
        liquidacion.importeFacturado,
        liquidacion.ivaProd,
        liquidacion.efectivoProd,
        liquidacion.comisionFacturadoProd,
        liquidacion.comisionEfectivoProd,
        liquidacion.netoLiquidacionProd,
        liquidacion.netoTotalProd,
        liquidacion.observaciones,
        liquidacion,
        liquidacion.comprobanteComp,
        liquidacion.brutoComp,
        liquidacion.ivaComp,
        liquidacion.efectivoComp,
        liquidacion.comisionFacturadoComp,
        liquidacion.comisionEfectivoComp,
        liquidacion.netoLiquidacionComp,
        liquidacion.netoTotalComp
      ]
    );
    return liquidacion;
  }

  async getOperaciones() {
    const result = await this.query(
      `SELECT
         o.codigo,
         o.fecha_operacion,
         o.tipo,
         o.destino,
         o.estado,
         v.razon_social AS vendedor,
         c.razon_social AS comprador,
         co.razon_social AS consignataria,
         COALESCE(SUM(vl.importe_vend), 0) AS total,
         o.dte,
         o.renspa_origen,
         o.renspa_destino
       FROM operaciones o
       LEFT JOIN clientes v ON v.id = o.vendedor_id
       LEFT JOIN clientes c ON c.id = o.comprador_id
       LEFT JOIN clientes co ON co.id = o.consignataria_id
       LEFT JOIN venta_lineas vl ON vl.operacion_id = o.id
       GROUP BY o.id, v.razon_social, c.razon_social, co.razon_social
       ORDER BY o.fecha_operacion DESC, o.codigo DESC`
    );
    return result.rows.map((operation) => ({
      id: operation.codigo,
      fecha: formatDateFromDb(operation.fecha_operacion),
      tipo: operation.tipo,
      destino: operation.destino,
      estado: operation.estado,
      vendedor: operation.vendedor,
      comprador: operation.comprador,
      consignataria: operation.consignataria,
      total: formatMoney(operation.total),
      lineas: 0,
      dte: operation.dte,
      renspaOrigen: operation.renspa_origen,
      renspaDestino: operation.renspa_destino
    }));
  }

  async getCuentaCorrienteResumen() {
    const result = await this.query(
      `SELECT
         COUNT(*) FILTER (WHERE origen = 'EXTERNO') AS movimientos_externos,
         (SELECT COUNT(*) FROM pagos_cobros) AS pagos_cobros,
         COALESCE(SUM(CASE WHEN origen = 'EXTERNO' THEN ABS(importe) ELSE 0 END), 0) AS total_movimientos,
         (SELECT COALESCE(SUM(importe), 0) FROM pagos_cobros) AS total_pagos
       FROM cuenta_corriente_movimientos`
    );
    const row = result.rows[0] || {};
    return {
      movimientosExternos: Number(row.movimientos_externos || 0),
      pagosCobros: Number(row.pagos_cobros || 0),
      totalMovimientos: Number(row.total_movimientos || 0),
      totalPagos: Number(row.total_pagos || 0)
    };
  }
}

function createDataSource() {
  if (process.env.DATABASE_URL) {
    return new PostgresJsonDataSource(process.env.DATABASE_URL);
  }
  return new BackupDataSource(process.env.BACKUP_PATH || DEFAULT_BACKUP_PATH, process.env.APP_DATA_PATH || DEFAULT_APP_DATA_PATH);
}

module.exports = {
  buildAccountData,
  createDataSource
};
