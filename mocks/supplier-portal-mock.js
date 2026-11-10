import http from 'node:http'
import { fileURLToPath } from 'node:url'

// MOCK of the external supplier portal (REST). Same contract as the real portal would offer:
//   GET /suppliers | /quotations | /deliveries   ?page=1&pageSize=50  ->  { items: [...], hasMore: boolean }
// Start it with `npm run mock:portal` (port 4010). Tests start it on a random port.
const DATA = {
  suppliers: [
    { portalId: 'P-9001', name: 'Tata Steel Supplies', country: 'IN', email: 'orders@tatasteel.example',
      certifications: [{ type: 'ISO 14001', issuedOn: '2026-11-01', expiresOn: '2029-11-01' }] },
    { portalId: 'P-9004', name: 'Nordic Fasteners AB', country: 'SE', email: 'sales@nordicfast.example',
      certifications: [{ type: 'ISO 14001', issuedOn: '2026-10-15', expiresOn: '2029-10-15' }] },
    { portalId: 'P-9010', name: 'Quantum Valves Ltd', country: 'IN', email: 'hello@quantumvalves.example',
      certifications: [{ type: 'ISO 9001', issuedOn: '2026-05-01', expiresOn: '2029-05-01' }] }
  ],
  quotations: [
    { ref: 'Q-501', portalId: 'P-9001', materialNo: 'RM-1001', quantity: 200, unitPrice: 1185, currency: 'INR', deliveryDays: 6, validUntil: '2027-02-28' },
    { ref: 'Q-502', portalId: 'P-9999', materialNo: 'RM-1001', quantity: 10, unitPrice: 1000, currency: 'INR', deliveryDays: 6, validUntil: '2027-02-28' }
  ],
  deliveries: [
    { poNumber: '4500000002', status: 'DELAYED', promisedDate: '2026-11-30' },
    { poNumber: '4500000004', status: 'CONFIRMED', promisedDate: '2027-01-15' },
    { poNumber: '9999999999', status: 'SHIPPED', promisedDate: '2027-01-01' }
  ]
}

export function createPortalMock() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const name = url.pathname.slice(1)
    if (req.method !== 'GET' || !DATA[name]) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'not found' })) }
    const page = Number(url.searchParams.get('page') ?? 1), size = Number(url.searchParams.get('pageSize') ?? 50)
    const items = DATA[name].slice((page - 1) * size, page * size)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ items, hasMore: page * size < DATA[name].length }))
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createPortalMock().listen(4010, () => console.log('Supplier portal mock on http://localhost:4010'))
}