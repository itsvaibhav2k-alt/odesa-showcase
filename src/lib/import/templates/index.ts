/**
 * Inline CSV templates for the importer download endpoint.
 *
 * Kept as TS string constants instead of `fs.readFile`d files so this
 * works regardless of where Next.js bundles the route — the source-of-truth
 * `.csv` files in this folder are also kept in sync (they're the human-
 * editable copies; this `index.ts` is the runtime artifact).
 */

import type { ImportSource } from '../types';

const APPFOLIO = `Property Name,Property Address,Unit Number,Tenant First Name,Tenant Last Name,Tenant Phone,Tenant Email,Lease Rent,Lease Start Date,Lease End Date,Lease Status,Rent Due Day,Bedrooms,Bathrooms
Vaba House,"123 Main St, Arlington, VA 22201",1,Test,Person,(202) 555-0101,test@example.com,"$1,800.00",2025-06-01,2026-05-31,active,1,2,1
Vaba House,"123 Main St, Arlington, VA 22201",2,Maria,Sanchez,703-555-0102,maria@example.com,"$1,950.00",2025-09-01,2026-08-31,active,1,2,1
Springfield Duplex,"55 Elm St, Springfield, VA 22150",A,Jordan,Lee,7035550103,jordan@example.com,"$2,100.00",2024-12-15,2025-12-14,active,15,3,2
`;

const BUILDIUM = `Property,Property Address,Unit,Tenant,Phone,Email,Rent,Lease From,Lease To,Lease Status,Rent Due Day,Bedrooms,Bathrooms
Vaba House,"123 Main St, Arlington, VA 22201",1,Test Person,(202) 555-0101,test@example.com,"$1,800.00",6/1/2025,5/31/2026,active,1,2,1
Vaba House,"123 Main St, Arlington, VA 22201",2,Maria Sanchez,703-555-0102,maria@example.com,"$1,950.00",9/1/2025,8/31/2026,active,1,2,1
Springfield Duplex,"55 Elm St, Springfield, VA 22150",A,Jordan Lee,7035550103,jordan@example.com,"$2,100.00",12/15/2024,12/14/2025,active,15,3,2
`;

const RENTREDI = `Property,Property Address,Unit,Tenant Name,Tenant Phone,Tenant Email,Rent Amount,Lease Start,Lease End,Lease Status,Rent Due Day,Bedrooms,Bathrooms
Vaba House,"123 Main St, Arlington, VA 22201",1,Test Person,(202) 555-0101,test@example.com,1800,2025-06-01,2026-05-31,active,1,2,1
Vaba House,"123 Main St, Arlington, VA 22201",2,Maria Sanchez,703-555-0102,maria@example.com,1950,2025-09-01,2026-08-31,active,1,2,1
Springfield Duplex,"55 Elm St, Springfield, VA 22150",A,Jordan Lee,7035550103,jordan@example.com,2100,2024-12-15,2025-12-14,active,15,3,2
`;

const GENERIC = `property_name,property_address,unit_label,tenant_first_name,tenant_last_name,tenant_phone,tenant_email,lease_rent,lease_start,lease_end,lease_due_day,bedrooms,bathrooms
Vaba House,"123 Main St, Arlington, VA 22201",1,Test,Person,(202) 555-0101,test@example.com,1800,2025-06-01,2026-05-31,1,2,1
Vaba House,"123 Main St, Arlington, VA 22201",2,Maria,Sanchez,703-555-0102,maria@example.com,1950,2025-09-01,2026-08-31,1,2,1
Springfield Duplex,"55 Elm St, Springfield, VA 22150",A,Jordan,Lee,7035550103,jordan@example.com,2100,2024-12-15,2025-12-14,15,3,2
`;

const TEMPLATES: Record<ImportSource, string> = {
  appfolio: APPFOLIO,
  buildium: BUILDIUM,
  rentredi: RENTREDI,
  generic: GENERIC,
};

export function getTemplateCsv(source: ImportSource): string {
  return TEMPLATES[source];
}
