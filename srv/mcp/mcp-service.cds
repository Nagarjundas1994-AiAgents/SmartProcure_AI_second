using { ProcurementService as P } from '../procurement-service';
using { SupplierService as S } from '../supplier-service';

/**
 * OWNER: Developer 2. A small, read-only facade for AI clients.
 * No entities are exposed (that would create a generic "query" tool). Each tool forwards to ONE
 * function of a business service, in the same request context, so the caller's roles still decide.
 * Description text comes from the doc comments below, not from @Core.Description.
 */
@protocol: 'mcp'
@path: 'smartprocure-mcp'
@requires: 'authenticated-user'
@mcp.instructions: 'SmartProcure procurement tools. Amounts are in INR. Use request numbers like PR-2026-0001, PO numbers like 4500000001 and material numbers like RM-1001. These tools only read data; they cannot approve or order anything.'
service SmartProcureMcpService {

  type PurchaseRequestStatus {
    status : String;
    amount : Decimal(15,2);
    latestApprovalDecision : String;
  };

  /** Status, amount and latest approval decision of one purchase request. */
  @requires: ['Employee', 'Manager', 'ProcurementOfficer', 'Administrator']
  function getPurchaseRequestStatus(/** e.g. PR-2026-0001 */ requestNo : String) returns PurchaseRequestStatus;

  /** Purchase requests waiting for the calling manager's decision. */
  @requires: ['Manager', 'Administrator']
  function getPendingApprovals() returns many P.PendingRequest;

  /** Master data, certification validity, risk level and latest score of one supplier. */
  @requires: ['ProcurementOfficer', 'Manager', 'Administrator']
  function getSupplierDetails(/** e.g. S-1001 */ supplierNo : String) returns S.SupplierDetails;

  /** Ranks all valid supplier quotations for a material by price, delivery, quality and risk. */
  @requires: ['ProcurementOfficer', 'Manager']
  function compareSupplierQuotations(/** e.g. RM-1001 */ materialNo : String) returns S.Comparison;

  /** Status, delivery progress and delay of one purchase order. */
  @requires: ['ProcurementOfficer', 'Manager', 'WarehouseEmployee', 'Administrator']
  function getPurchaseOrderStatus(/** e.g. 4500000001 */ poNumber : String) returns P.OrderStatus;

  /** Monthly performance scores; one supplier, or all suppliers when supplierNo is empty. */
  @requires: ['ProcurementOfficer', 'Manager']
  function getSupplierPerformance(/** optional, e.g. S-1001 */ supplierNo : String) returns many S.Performance;

  /** Open purchase orders whose promised delivery date has passed, longest delay first. */
  @requires: ['ProcurementOfficer', 'Manager', 'Administrator']
  function identifyDelayedPurchaseOrders() returns many P.OrderStatus;

  /** Counts and values: requests by status, pending value, open and delayed orders. */
  @requires: ['ProcurementOfficer', 'Manager', 'Administrator']
  function getProcurementSummary() returns P.Summary;

  /** Supplier certifications that expire within the given number of days (default 90). */
  @requires: ['ProcurementOfficer', 'Manager']
  function getExpiringCertifications(/** 0 to 3650 */ days : Integer) returns many S.ExpiringCert;

  /** Best supplier for a purchase request, with reason and alternatives. Does not store anything. */
  @requires: ['ProcurementOfficer', 'Manager']
  function recommendSupplier(/** e.g. PR-2026-0001 */ requestNo : String) returns S.Recommendation;
}