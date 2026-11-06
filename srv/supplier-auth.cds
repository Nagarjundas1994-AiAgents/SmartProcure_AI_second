using { SupplierService as S } from './supplier-service';

// OWNER: Developer 2
annotate S.Suppliers with @restrict: [
  { grant: 'READ', to: ['ProcurementOfficer', 'Manager', 'Administrator'] },
  { grant: ['CREATE', 'UPDATE', 'activate', 'block'], to: 'ProcurementOfficer' }
];
annotate S.SupplierContacts with @restrict: [
  { grant: 'READ', to: ['ProcurementOfficer', 'Manager', 'Administrator'] },
  { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'ProcurementOfficer' }
];
annotate S.SupplierCertifications with @restrict: [
  { grant: 'READ', to: ['ProcurementOfficer', 'Manager', 'Administrator'] },
  { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'ProcurementOfficer' }
];
annotate S.SupplierQuotations with @restrict: [
  { grant: 'READ', to: ['ProcurementOfficer', 'Manager', 'Administrator'] },
  { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'ProcurementOfficer' }
];
annotate S.SupplierQuotationItems with @restrict: [
  { grant: 'READ', to: ['ProcurementOfficer', 'Manager', 'Administrator'] },
  { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'ProcurementOfficer' }
];