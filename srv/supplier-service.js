import cds from '@sap/cds'
import { scoreOffers } from './lib/scoring.js'

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const today = () => new Date().toISOString().slice(0, 10)
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5)
const audit = (req, action, entity, entityKey, detail) =>
  INSERT.into(cds.entities('smartprocure').AuditLogs).entries({
    actor: req.user?.id, channel: 'ODATA', action, entity, entityKey, detail
  })

export default class SupplierService extends cds.ApplicationService {
    async init() {
        const db = cds.entities('smartprocure')
        const { Suppliers, SupplierContacts, SupplierCertifications, SupplierQuotations } = this.entities

            // ---------- US-07: supplier registration ----------
    this.before('CREATE', Suppliers, async req => {
      const s = req.data
      if (s.email && !EMAIL.test(s.email)) return req.reject(400, `Invalid e-mail address: ${s.email}`)
      const same = await SELECT.one.from(db.Suppliers).where('lower(name) =', (s.name ?? '').trim().toLowerCase())
      if (same) return req.reject(409, `Supplier "${same.name}" already exists (${same.supplierNo})`)
      const all = await SELECT.from(db.Suppliers).columns('supplierNo')
      s.supplierNo ??= `S-${Math.max(1000, ...all.map(a => Number(a.supplierNo?.slice(2)) || 0)) + 1}`
      s.state = 'PENDING'
    })
    this.after('CREATE', Suppliers, (_, req) => audit(req, 'CREATE', 'Supplier', req.data.supplierNo, req.data.name))

    this.on('activate', Suppliers, async req => {
      const { ID } = req.params[0]
      const certs = await SELECT.from(db.SupplierCertifications).where({ supplier_ID: ID })
      if (!certs.some(c => c.expiresOn >= today())) return req.reject(400, 'A supplier needs at least one valid certification before activation')
      await UPDATE(db.Suppliers, ID).with({ state: 'ACTIVE' })
      await audit(req, 'ACTIVATE', 'Supplier', ID)
      return SELECT.one.from(db.Suppliers, ID)
    })
    this.on('block', Suppliers, async req => {
      const { ID } = req.params[0]
      if (!req.data.reason?.trim()) return req.reject(400, 'A reason is mandatory when blocking a supplier')
      await UPDATE(db.Suppliers, ID).with({ state: 'BLOCKED', riskLevel: 'HIGH' })
      await audit(req, 'BLOCK', 'Supplier', ID, req.data.reason)
      return SELECT.one.from(db.Suppliers, ID)
    })

    // ---------- US-08: certifications ----------
    this.before(['CREATE', 'UPDATE'], SupplierCertifications, req => {
      const { issuedOn, expiresOn } = req.data
      if (issuedOn && expiresOn && expiresOn < issuedOn) return req.reject(400, 'A certificate cannot expire before it was issued')
    })

        // ---------- US-09: quotations (totals are always calculated on the server) ----------
    this.before(['CREATE', 'UPDATE'], SupplierQuotations, async req => {
      const q = req.data
      if (q.supplier_ID) {
        const s = await SELECT.one.from(db.Suppliers, q.supplier_ID)
        if (!s) return req.reject(400, 'Unknown supplier')
        if (s.state === 'BLOCKED') return req.reject(400, `Supplier ${s.name} is blocked`)
      }
      if (q.items) {
        q.totalAmount = 0
        for (const it of q.items) {
          if (!(Number(it.quantity) > 0)) return req.reject(400, 'Quotation item quantity must be greater than 0')
          it.netAmount = round2(it.quantity * it.unitPrice)
          q.totalAmount = round2(q.totalAmount + it.netAmount)
        }
      }
      if (req.event === 'CREATE') {
        const all = await SELECT.from(db.SupplierQuotations).columns('quotationNo')
        q.quotationNo ??= `QT-${Math.max(1000, ...all.map(a => Number(a.quotationNo?.slice(3)) || 0)) + 1}`
        q.source ??= 'MANUAL'
      }
    })

    // ---------- shared lookups ----------
    const certificationOk = async supplierId =>
      (await SELECT.from(db.SupplierCertifications).where({ supplier_ID: supplierId })).some(c => c.expiresOn >= today())
    const latestPerformance = async supplierId =>
      SELECT.one.from(db.SupplierPerformance).where({ supplier_ID: supplierId }).orderBy('period desc')

    /** One offer per supplier (their cheapest valid quotation line) for a material. */
    const offersFor = async (materialNo, requestId) => {
      const m = await SELECT.one.from(db.Materials).where({ materialNo })
      if (!m) return null
      let rows = await SELECT.from(db.SupplierQuotationItems).columns(
        'unitPrice', 'quotation.request_ID as requestId', 'quotation.deliveryDays as deliveryDays', 'quotation.validUntil as validUntil',
        'quotation.supplier.ID as supplierId', 'quotation.supplier.supplierNo as supplierNo', 'quotation.supplier.name as supplier',
        'quotation.supplier.riskLevel as riskLevel', 'quotation.supplier.state as state').where({ material_ID: m.ID })
      rows = rows.filter(r => r.state !== 'BLOCKED' && (!r.validUntil || r.validUntil >= today()))
      if (requestId && rows.some(r => r.requestId === requestId)) rows = rows.filter(r => r.requestId === requestId)
      const best = new Map()
      for (const r of rows) if (!best.has(r.supplierId) || r.unitPrice < best.get(r.supplierId).unitPrice) best.set(r.supplierId, r)
      const offers = []
      for (const r of best.values()) {
        const perf = await latestPerformance(r.supplierId)
        offers.push({ supplierNo: r.supplierNo, supplier: r.supplier, unitPrice: Number(r.unitPrice), deliveryDays: r.deliveryDays ?? 30,
                      quality: Number(perf?.qualityScore ?? 70), riskLevel: r.riskLevel, certificationOk: await certificationOk(r.supplierId) })
      }
      return { materialNo, offers: scoreOffers(offers) }
    }

    // ---------- US-10 / US-12: read model + comparison ----------
    this.on('supplierDetails', async req => {
      const s = await SELECT.one.from(db.Suppliers).where({ supplierNo: req.data.supplierNo })
      if (!s) return req.reject(404, `Supplier ${req.data.supplierNo} not found`)
      const certs = await SELECT.from(db.SupplierCertifications).where({ supplier_ID: s.ID })
      const perf = await latestPerformance(s.ID)
      const open = await SELECT.from(db.PurchaseOrders).where({ supplier_ID: s.ID, status: { in: ['CREATED', 'CONFIRMED'] } })
      return { supplierNo: s.supplierNo, name: s.name, state: s.state, riskLevel: s.riskLevel, country: s.country_code,
               certifications: certs.map(c => ({ certType: c.certType, expiresOn: c.expiresOn, valid: c.expiresOn >= today() })),
               latestScore: perf?.overallScore ?? null, openOrders: open.length }
    })

    this.on('compareQuotations', async req => {
      const c = await offersFor(req.data.materialNo)
      if (!c) return req.reject(404, `Material ${req.data.materialNo} not found`)
      const prices = c.offers.map(o => o.unitPrice).sort((a, b) => a - b)
      return { ...c, medianPrice: prices.length ? prices[prices.length >> 1] : 0 }
    })

    this.on('supplierPerformance', async req => {
      const where = req.data.supplierNo ? { 'supplier.supplierNo': req.data.supplierNo } : {}
      const rows = await SELECT.from(db.SupplierPerformance)
        .columns('supplier.supplierNo as supplierNo', 'supplier.name as supplier', 'period', 'onTimeRate', 'qualityScore', 'avgDeliveryDays', 'overallScore')
        .where(where).orderBy('overallScore desc', 'period desc')
      if (req.data.supplierNo && !rows.length) return req.reject(404, `No performance data for ${req.data.supplierNo}`)
      return rows
    })

    this.on('expiringCertifications', async req => {
      const days = req.data.days ?? 90
      if (!Number.isInteger(days) || days < 0 || days > 3650) return req.reject(400, 'days must be between 0 and 3650')
      const limit = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10)
      const rows = await SELECT.from(db.SupplierCertifications)
        .columns('supplier.supplierNo as supplierNo', 'supplier.name as supplier', 'certType', 'expiresOn').where({ expiresOn: { '<=': limit } }).orderBy('expiresOn')
      return rows.map(r => ({ ...r, daysLeft: daysBetween(today(), r.expiresOn) }))
    })
    return super.init()
  }
}