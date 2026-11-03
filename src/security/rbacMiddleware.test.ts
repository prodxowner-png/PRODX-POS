import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRouteAccess,
  evaluateSettingsTabAccess,
  evaluateAdminConsoleAccess,
  assertOrganizationAdminAccess,
  isGeneralUserPosOnly,
  isOrganizationAdmin,
  getPermittedRoutesForUser,
  getPermittedSettingsTabsForUser,
  RbacUnauthorizedError,
  ROUTE_RBAC_POLICY,
  SETTINGS_TAB_RBAC_POLICY,
} from './rbacMiddleware';
import { ROLE_PERMISSIONS, type User } from '../domain/auth';
import type { NavRoute } from '../components/layout/Sidebar';
import type { SettingsTabId } from '../modules/settings/types';

const mockCashierUser: User = {
  id: 'usr-cashier-01',
  employeeCode: 'EMP-103',
  name: 'Pimchanok (Cashier)',
  email: 'pimchanok@prodx.co.th',
  role: 'cashier',
  permissions: ROLE_PERMISSIONS.cashier,
  isActive: true,
};

const mockManagerUser: User = {
  id: 'usr-manager-01',
  employeeCode: 'EMP-102',
  name: 'Nattapong (Manager)',
  email: 'nattapong@prodx.co.th',
  role: 'manager',
  permissions: ROLE_PERMISSIONS.manager,
  isActive: true,
};

const mockAdminUser: User = {
  id: 'usr-admin-01',
  employeeCode: 'EMP-101',
  name: 'Somchai (Admin)',
  email: 'somchai@prodx.co.th',
  role: 'admin',
  permissions: ROLE_PERMISSIONS.admin,
  isActive: true,
};

test('RBAC Middleware identifies general users as strictly POS-only and admins as organization admins', () => {
  assert.equal(isGeneralUserPosOnly(mockCashierUser), true);
  assert.equal(isGeneralUserPosOnly(mockManagerUser), false);
  assert.equal(isGeneralUserPosOnly(mockAdminUser), false);

  assert.equal(isOrganizationAdmin(mockAdminUser), true);
  assert.equal(isOrganizationAdmin(mockManagerUser), false);
  assert.equal(isOrganizationAdmin(mockCashierUser), false);
});

test('RBAC Middleware strictly confines General Users (cashier) to POS screen only and blocks all other routes', () => {
  const allRoutes = Object.keys(ROUTE_RBAC_POLICY) as NavRoute[];

  for (const route of allRoutes) {
    const decision = evaluateRouteAccess(mockCashierUser, route);
    if (route === 'pos') {
      assert.equal(decision.allowed, true);
    } else {
      assert.equal(decision.allowed, false);
      assert.equal(decision.reason, 'general_user_pos_only');
      assert.equal(decision.redirectRoute, 'pos');
    }
  }

  assert.deepEqual(getPermittedRoutesForUser(mockCashierUser), ['pos']);
});

test('RBAC Middleware blocks General Users (cashier) from all Settings tabs and the Organization Admin Console', () => {
  const allTabs = Object.keys(SETTINGS_TAB_RBAC_POLICY) as SettingsTabId[];
  for (const tab of allTabs) {
    const decision = evaluateSettingsTabAccess(mockCashierUser, tab);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'general_user_pos_only');
  }

  assert.deepEqual(getPermittedSettingsTabsForUser(mockCashierUser), []);
  assert.equal(evaluateAdminConsoleAccess(mockCashierUser).allowed, false);
});

test('RBAC Middleware allows Store Managers into store-level settings but blocks organization-level settings', () => {
  assert.equal(evaluateSettingsTabAccess(mockManagerUser, 'general').allowed, true);
  assert.equal(evaluateSettingsTabAccess(mockManagerUser, 'appearance').allowed, true);
  assert.equal(evaluateSettingsTabAccess(mockManagerUser, 'hardware').allowed, true);
  assert.equal(evaluateSettingsTabAccess(mockManagerUser, 'tax_accounting').allowed, true);

  const orgLevelTabs: SettingsTabId[] = [
    'system_config',
    'modules_control',
    'security_roles',
    'role_management',
    'role_assignment',
    'permission_sets',
    'data_sync',
  ];

  for (const orgTab of orgLevelTabs) {
    const decision = evaluateSettingsTabAccess(mockManagerUser, orgTab);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'admin_role_required');
  }

  assert.equal(evaluateAdminConsoleAccess(mockManagerUser).allowed, false);
});

test('RBAC Middleware grants Administrators (admin) full access to 100% of POS modules, Organization Settings, and Admin Console', () => {
  const allRoutes = Object.keys(ROUTE_RBAC_POLICY) as NavRoute[];
  for (const route of allRoutes) {
    assert.equal(evaluateRouteAccess(mockAdminUser, route).allowed, true);
  }

  const allTabs = Object.keys(SETTINGS_TAB_RBAC_POLICY) as SettingsTabId[];
  for (const tab of allTabs) {
    assert.equal(evaluateSettingsTabAccess(mockAdminUser, tab).allowed, true);
  }

  assert.equal(evaluateAdminConsoleAccess(mockAdminUser, 'overview').allowed, true);
  assert.equal(evaluateAdminConsoleAccess(mockAdminUser, 'organizations').allowed, true);
  assert.equal(evaluateAdminConsoleAccess(mockAdminUser, 'branches').allowed, true);
  assert.equal(evaluateAdminConsoleAccess(mockAdminUser, 'terminals').allowed, true);
  assert.equal(evaluateAdminConsoleAccess(mockAdminUser, 'rbac').allowed, true);
});

test('RBAC Middleware enforces service-layer assertOrganizationAdminAccess guard on organization CRUD mutations', () => {
  assert.doesNotThrow(() =>
    assertOrganizationAdminAccess({ role: 'admin', id: 'usr-admin-01' }, 'organization:create'),
  );

  assert.throws(
    () =>
      assertOrganizationAdminAccess({ role: 'cashier', id: 'usr-cashier-01' }, 'organization:delete'),
    RbacUnauthorizedError,
  );

  assert.throws(
    () => assertOrganizationAdminAccess({ role: 'manager', id: 'usr-manager-01' }, 'branch:delete'),
    RbacUnauthorizedError,
  );
});
