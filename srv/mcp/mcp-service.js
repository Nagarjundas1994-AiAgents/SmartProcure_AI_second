import cds from '@sap/cds'
import { audit } from '../lib/common.js'

// tool -> [business service, function]. No logic here: the business services decide who may do what.
const ROUTES = {
  getPurchaseRequestStatus: ['ProcurementService', 'requestStatus'],
  getPendingApprovals: ['ProcurementService', 'pendingApprovals'],
  getSupplierDetails: ['SupplierService', 'supplierDetails'],
  compareSupplierQuotations: ['SupplierService', 'compareQuotations'],
  getPurchaseOrderStatus: ['ProcurementService', 'orderStatus'],
  getSupplierPerformance: ['SupplierService', 'supplierPerformance'],
  identifyDelayedPurchaseOrders: ['ProcurementService', 'delayedOrders'],
  getProcurementSummary: ['ProcurementService', 'summary'],
  getExpiringCertifications: ['SupplierService', 'expiringCertifications'],
  recommendSupplier: ['SupplierService', 'recommend']
}

export default class SmartProcureMcpService extends cds.ApplicationService {
  init() {
    for (const [tool, [service, fn]] of Object.entries(ROUTES)) {
      this.on(tool, async req => {
        const srv = await cds.connect.to(service)
        const result = await srv.send({ event: fn, data: req.data })        // same user, same tenant, same rules
        await audit(req, tool, 'McpTool', tool, JSON.stringify(req.data), 'MCP')
        return result
      })
    }
    return super.init()
  }
}