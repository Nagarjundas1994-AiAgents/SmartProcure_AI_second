using { smartprocure as db } from '../db/schema';

/**
 * OWNER: Developer 2 (suppliers, integration, AI). Contract: docs/api-contracts/supplier-service.md
 */
@path: 'supplier'
@requires: 'authenticated-user'
service SupplierService {

  // ---- US-07 / US-08: supplier master, contacts and certifications ----
  entity Suppliers as projection on db.Suppliers actions {
    action activate() returns Suppliers;   // needs one valid certification
    action block(reason : String) returns Suppliers;
  };
  entity SupplierContacts       as projection on db.SupplierContacts;
  entity SupplierCertifications as projection on db.SupplierCertifications;

  // ---- US-09: quotations (totals and numbers are calculated in supplier-service.js) ----
  entity SupplierQuotations     as projection on db.SupplierQuotations;
  entity SupplierQuotationItems as projection on db.SupplierQuotationItems;

  @readonly entity Materials    as projection on db.Materials;
}