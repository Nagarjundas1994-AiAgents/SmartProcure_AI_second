import cds from '@sap/cds'
import { integrationLog, audit, today, round2 } from '../lib/common.js'

const COLUMNS = ['quotationRef', 'supplierNo', 'materialNo', 'quantity', 'unitPrice', 'currency', 'deliveryDays', 'validUntil']
const MAX_CHARS = 1_000_000

/** Minimal RFC 4180 parser: quoted fields, commas and doubled quotes inside quotes. Returns an array of string arrays. */
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false; else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(f => f.trim() !== '')) rows.push(row)
  return rows
}

/** US-11: validate, de-duplicate and transform a quotation CSV; one SupplierQuotation per quotationRef. */
export async function importQuotationsCsv(req) {
  const { fileName, content } = req.data
  const db = cds.entities('smartprocure')
  if (!content?.trim()) return req.reject(400, 'The file is empty')
  if (content.length > MAX_CHARS) return req.reject(413, `The file is larger than ${MAX_CHARS} characters`)
  const [header, ...lines] = parseCsv(content.replace(/^﻿/, ''))
  const missing = COLUMNS.filter(c => !header.map(h => h.trim()).includes(c))
  if (missing.length) return req.reject(400, `Missing column(s): ${missing.join(', ')}`)

  const messages = []
  const seen = new Set()
  const groups = new Map()
  let duplicates = 0, errors = 0
  const bad = (n, why) => { errors++; messages.push(`Row ${n}: ${why}`) }

  for (const [idx, cells] of lines.entries()) {
    const n = idx + 2                                               // spreadsheet row number (1 = header)
    const r = Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? '').trim()]))
    const quantity = Number(r.quantity), unitPrice = Number(r.unitPrice), days = Number(r.deliveryDays)
    if (!r.quotationRef) { bad(n, 'quotationRef is empty'); continue }
    if (!(quantity > 0)) { bad(n, `quantity "${r.quantity}" must be a number greater than 0`); continue }
    if (!(unitPrice > 0)) { bad(n, `unitPrice "${r.unitPrice}" must be a number greater than 0`); continue }
    if (!Number.isInteger(days) || days < 0) { bad(n, `deliveryDays "${r.deliveryDays}" must be a whole number`); continue }
    if (!/^[A-Z]{3}$/.test(r.currency)) { bad(n, `currency "${r.currency}" must be a 3-letter ISO code`); continue }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.validUntil) || r.validUntil < today()) { bad(n, `validUntil "${r.validUntil}" must be a future date (YYYY-MM-DD)`); continue }

    const key = `${r.quotationRef}|${r.materialNo}`
    if (seen.has(key)) { duplicates++; messages.push(`Row ${n}: duplicate of an earlier row (${key})`); continue }
    seen.add(key)
    if (await SELECT.one.from(db.SupplierQuotations).where({ quotationNo: `CSV-${r.quotationRef}` })) {
      duplicates++; messages.push(`Row ${n}: quotation CSV-${r.quotationRef} was imported before`); continue
    }
    const [s, m] = await Promise.all([SELECT.one.from(db.Suppliers).where({ supplierNo: r.supplierNo }), SELECT.one.from(db.Materials).where({ materialNo: r.materialNo })])
    if (!s) { bad(n, `unknown supplier ${r.supplierNo}`); continue }
    if (s.state === 'BLOCKED') { bad(n, `supplier ${r.supplierNo} is blocked`); continue }
    if (!m) { bad(n, `unknown material ${r.materialNo}`); continue }
    const g = groups.get(r.quotationRef) ?? { supplier: s, row: r, items: [] }
    if (g.supplier.ID !== s.ID) { bad(n, `quotationRef ${r.quotationRef} mixes suppliers`); continue }
    g.items.push({ material_ID: m.ID, quantity, unitPrice, netAmount: round2(quantity * unitPrice) })
    groups.set(r.quotationRef, g)
  }

  let imported = 0
  for (const [ref, g] of groups) {
    await INSERT.into(db.SupplierQuotations).entries({
      quotationNo: `CSV-${ref}`, supplier_ID: g.supplier.ID, validUntil: g.row.validUntil, currency_code: g.row.currency,
      deliveryDays: Number(g.row.deliveryDays), source: 'CSV', totalAmount: round2(g.items.reduce((s, i) => s + i.netAmount, 0)), items: g.items
    })
    imported += g.items.length
  }
  const status = errors || duplicates ? (imported ? 'PARTIAL' : 'FAILED') : 'SUCCESS'
  await integrationLog('CSV', `import ${fileName ?? 'upload.csv'}`, status, lines.length, errors + duplicates, messages, req.user.id)
  await audit(req, 'CSV_IMPORT', 'SupplierQuotation', fileName ?? 'upload.csv', `${imported} imported, ${errors} errors, ${duplicates} duplicates`)
  return { rows: lines.length, imported, duplicates, errors, messages }
}