import cds from '@sap/cds'


const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
export default class ProcurementService extends cds.ApplicationService {
    async init() {
        const db = cds.entities('smartprocure')
        const { Suppliers, SupplierContacts, SupplierCertifications } = this.entities

            // ---------- US-07: supplier registration ----------
    this.before('CREATE', Suppliers, async req => {
      const s = req.data
      if (s.email && !EMAIL.test(s.email)) return req.reject(400, `Invalid e-mail address: ${s.email}`)
      const same = await SELECT.one.from(db.Suppliers).where('lower(name) =', (s.name ?? '').trim().toLowerCase())
      if (same) return req.reject(409, `Supplier "${same.name}" already exists (${same.supplierNo})`)
      const all = await SELECT.from(db.Suppliers).columns('supplierNo')
      s.supplierNo ??= `S-${Math.max(1000, ...all.map(a => Number(a.supplierNo.slice(2)))) + 1}`
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

        return super.init()
    }
}