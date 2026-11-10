import cds from '@sap/cds'
import { integrationLog, audit, round2 } from '../lib/common.js'

/** Read every page of a portal collection: { items: [...], hasMore: true|false } */
async function readAll(portal, path) {
  const rows = []
  for (let page = 1; page <= 100; page++) {                       // hard stop: never loop forever on a broken API
    const r = await portal.send({ method: 'GET', path: `${path}?page=${page}&pageSize=50` })
    rows.push(...(r.items ?? []))
    if (!r.hasMore) return rows
  }
  throw new Error(`${path}: more than 100 pages`)
}

/**
 * US-11: synchronise suppliers, certifications, quotations and delivery status from the external supplier portal (REST).
 * The portal is a remote service named SupplierPortal (see package.json, cds.requires). Locally it is a mock server.
 */
export async function syncFromPortal(req) {
  const db = cds.entities('smartprocure')
  const result = { suppliers: 0, certifications: 0, quotations: 0, deliveries: 0 }
  const problems = []
  try {
    const portal = await cds.connect.to('SupplierPortal')
    const [suppliers, quotations, deliveries] = await Promise.all([readAll(portal, '/suppliers'), readAll(portal, '/quotations'), readAll(portal, '/deliveries')])

    for (const p of suppliers) {
      let s = await SELECT.one.from(db.Suppliers).where({ portalId: p.portalId })
      if (!s) {
        const all = await SELECT.from(db.Suppliers).columns('supplierNo')
        s = { ID: cds.utils.uuid(), portalId: p.portalId, state: 'PENDING', riskLevel: 'MEDIUM',
              supplierNo: `S-${Math.max(1000, ...all.map(a => Number(a.supplierNo.slice(2)))) + 1}` }
        await INSERT.into(db.Suppliers).entries({ ...s, name: p.name, country_code: p.country, email: p.email })
      } else {
        await UPDATE(db.Suppliers, s.ID).with({ name: p.name, email: p.email })
      }
      result.suppliers++
      for (const c of p.certifications ?? []) {
        const old = await SELECT.one.from(db.SupplierCertifications).where({ supplier_ID: s.ID, certType: c.type })
        if (old) await UPDATE(db.SupplierCertifications, old.ID).with({ issuedOn: c.issuedOn, expiresOn: c.expiresOn })
        else await INSERT.into(db.SupplierCertifications).entries({ supplier_ID: s.ID, certType: c.type, issuedOn: c.issuedOn, expiresOn: c.expiresOn })
        result.certifications++
      }
    }

    for (const q of quotations) {
      const quotationNo = `PQ-${q.ref}`
      if (await SELECT.one.from(db.SupplierQuotations).where({ quotationNo })) continue          // duplicate: already imported
      const [s, m] = await Promise.all([SELECT.one.from(db.Suppliers).where({ portalId: q.portalId }), SELECT.one.from(db.Materials).where({ materialNo: q.materialNo })])
      if (!s || !m) { problems.push(`Quotation ${q.ref}: unknown ${!s ? 'supplier ' + q.portalId : 'material ' + q.materialNo}`); continue }
      const net = round2(q.quantity * q.unitPrice)
      await INSERT.into(db.SupplierQuotations).entries({ quotationNo, supplier_ID: s.ID, validUntil: q.validUntil, currency_code: q.currency, deliveryDays: q.deliveryDays,
        source: 'PORTAL', totalAmount: net, items: [{ material_ID: m.ID, quantity: q.quantity, unitPrice: q.unitPrice, netAmount: net }] })
      result.quotations++
    }

    // Developer 2 does not touch purchase orders: delivery status goes through Developer 1's published action
    const procurement = await cds.connect.to('ProcurementService')
    for (const d of deliveries) {
      try {
        await procurement.send('updateDeliveryStatus', { poNumber: d.poNumber, deliveryStatus: d.status, promisedDate: d.promisedDate })
        result.deliveries++
      } catch (e) { problems.push(`Delivery ${d.poNumber}: ${e.message}`) }
    }
  } catch (e) {
    await cds.tx(() => integrationLog('PORTAL', 'syncFromPortal', 'FAILED', 0, 1, [e.message], req.user.id))
    return req.reject(502, `Supplier portal call failed: ${e.message}`)
  }
  await integrationLog('PORTAL', 'syncFromPortal', problems.length ? 'PARTIAL' : 'SUCCESS', result.suppliers + result.quotations + result.deliveries, problems.length, problems, req.user.id)
  await audit(req, 'PORTAL_SYNC', 'Supplier', '*', JSON.stringify(result))
  return result
}