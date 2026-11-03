import { Organization, Branch, Terminal } from '../modules/settings/types';
import {
  createBranch as createOrgBranch,
  createOrganization as createOrg,
  createTerminal as createOrgTerminal,
  deleteBranch as deleteOrgBranch,
  deleteBranchCascade as deleteOrgBranchCascade,
  deleteOrganization as deleteOrg,
  deleteOrganizationCascade as deleteOrgCascade,
  deleteTerminal as deleteOrgTerminal,
  ensureDefaultOrganizations,
  getAllBranches as getOrgAllBranches,
  getAllTerminals as getOrgAllTerminals,
  getAuditLogs,
  getBranchById as getOrgBranchById,
  getBranchesByOrg,
  getOrganizationById as getOrgById,
  getOrganizationSelectionCatalogWithFallback,
  getOrganizations as getOrgs,
  getTerminalById as getOrgTerminalById,
  getTerminalsByBranch,
  OrganizationSelectionCatalogResult,
  recordOrganizationAuditLog,
  subscribeToAuditLogs,
  subscribeToBranches,
  subscribeToOrganizationHierarchy,
  subscribeToOrganizations,
  subscribeToOrganizationStructure,
  subscribeToTerminals,
  updateBranch as updateOrgBranch,
  updateOrganization as updateOrg,
  updateTerminal as updateOrgTerminal,
} from './organizationService';

export async function ensureDefaultSystemConfig(): Promise<void> {
  await ensureDefaultOrganizations();
}

export const getOrganizations = async (): Promise<Organization[]> => {
  return getOrgs();
};

export const getOrganizationById = async (id: string): Promise<Organization | null> => {
  return getOrgById(id);
};

/**
 * Fetches branches with record-level security, connection timeout protection, and localStorage fallback.
 */
export const getBranches = async (orgId: string): Promise<Branch[]> => {
  return getBranchesByOrg(orgId);
};

export const getBranchById = async (branchId: string, orgId?: string): Promise<Branch | null> => {
  return getOrgBranchById(branchId, orgId);
};

/**
 * Fetches terminals with record-level security, connection timeout protection, and localStorage fallback.
 */
export const getTerminals = async (branchId: string, orgId?: string): Promise<Terminal[]> => {
  return getTerminalsByBranch(branchId, orgId);
};

/**
 * Fetches a single terminal by terminalId, strictly enforcing branch and organization isolation.
 */
export const getTerminalById = async (
  terminalId: string,
  branchId?: string,
  orgId?: string,
): Promise<Terminal | null> => {
  return getOrgTerminalById(terminalId, branchId, orgId);
};

/**
 * Returns branches. If orgId is provided, enforces record-level filtering to that organization only.
 */
export const getAllBranches = async (orgId?: string): Promise<Branch[]> => {
  return getOrgAllBranches(orgId);
};

/**
 * Returns terminals. If branchId is provided, enforces record-level filtering to that branch and org only.
 */
export const getAllTerminals = async (branchId?: string, orgId?: string): Promise<Terminal[]> => {
  return getOrgAllTerminals(branchId, orgId);
};

/**
 * Returns scoped system catalog data with Firestore connection timeout protection and localStorage fallback.
 */
export const getSystemConfigCatalog = async (scope?: {
  organizationId?: string;
  branchId?: string;
  terminalId?: string;
  timeoutMs?: number;
}): Promise<OrganizationSelectionCatalogResult> => {
  return getOrganizationSelectionCatalogWithFallback(scope);
};

export const createOrganization = async (input: {
  name: string;
  slug: string;
  taxId?: string;
  phone?: string;
  email?: string;
  currency?: string;
  status?: 'active' | 'inactive';
}): Promise<Organization> => {
  return createOrg(input);
};

export const updateOrganization = async (
  id: string,
  updates: Partial<Omit<Organization, 'id' | 'createdAt'>>,
): Promise<Organization> => {
  return updateOrg(id, updates);
};

export const deleteOrganization = async (id: string): Promise<void> => {
  return deleteOrg(id);
};

export const createBranch = async (input: {
  orgId: string;
  name: string;
  address: string;
  code?: string;
  phone?: string;
  manager?: string;
  status?: 'active' | 'inactive';
}): Promise<Branch> => {
  return createOrgBranch(input);
};

export const updateBranch = async (
  id: string,
  updates: Partial<Omit<Branch, 'id' | 'orgId' | 'createdAt'>>,
): Promise<Branch> => {
  return updateOrgBranch(id, updates);
};

export const deleteBranch = async (id: string): Promise<void> => {
  return deleteOrgBranch(id);
};

export const createTerminal = async (input: {
  branchId: string;
  name: string;
  code: string;
  orgId?: string;
  deviceModel?: string;
  ipAddress?: string;
  paperWidth?: '58mm' | '80mm';
  status?: 'active' | 'maintenance' | 'inactive';
}): Promise<Terminal> => {
  return createOrgTerminal(input);
};

export const updateTerminal = async (
  id: string,
  updates: Partial<Omit<Terminal, 'id' | 'branchId' | 'createdAt'>>,
): Promise<Terminal> => {
  return updateOrgTerminal(id, updates);
};

export const deleteTerminal = async (id: string): Promise<void> => {
  return deleteOrgTerminal(id);
};

export const deleteBranchCascade = async (
  branchId: string,
  orgId?: string,
): Promise<{ terminalsDeleted: number }> => {
  return deleteOrgBranchCascade(branchId, orgId);
};

export const deleteOrganizationCascade = async (
  orgId: string,
): Promise<{ branchesDeleted: number; terminalsDeleted: number }> => {
  return deleteOrgCascade(orgId);
};

export {
  subscribeToOrganizationStructure,
  subscribeToOrganizationHierarchy,
  subscribeToOrganizations,
  subscribeToBranches,
  subscribeToTerminals,
  subscribeToAuditLogs,
  getAuditLogs,
  recordOrganizationAuditLog,
};
