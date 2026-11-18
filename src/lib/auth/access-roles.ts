export type ProductRoleScopeKind = "product" | "project" | "workspace";

export interface ProductRoleCatalogEntry {
  id: string;
  name: string;
  description: string;
  actions: string[];
  scopeKinds: ProductRoleScopeKind[];
  /** Product-specific role value returned to the consuming application. */
  role?: string;
}

export interface ProductRoleCatalog {
  schemaVersion: 1;
  productId: string;
  version: string;
  roles: ProductRoleCatalogEntry[];
}

export interface StagedProductRoleCatalog {
  catalog: ProductRoleCatalog;
  fetchedAt: string;
}

export interface ProductAccessRole {
  id: string;
  name: string;
  description: string;
  actions: string[];
  /** Product-specific role value returned to the consuming application. */
  role?: string;
  /** Missing for manually-created permission sets, which support every scope. */
  scopeKinds?: ProductRoleScopeKind[];
  /** Present for roles imported from the product's published catalog. */
  catalogSource?: { roleId: string; version: string };
  /** Retired catalog roles remain visible for audit but cannot be assigned again. */
  deprecated?: boolean;
}
