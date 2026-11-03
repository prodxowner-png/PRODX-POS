export type FirstTenantBootstrapConfig = {
  secret: string;
  supabaseUserId: string;
  organizationCode: string;
  organizationName: string;
  storeCode: string;
  storeName: string;
  businessTimezone: string;
  ownerUsername: string;
  ownerDisplayName: string;
  deviceKey: string;
  deviceName: string;
};

export type FirstTenantBootstrapEnvironment = Record<string, string | undefined>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const readRequired = (environment: FirstTenantBootstrapEnvironment, key: string): string | null => {
  const value = environment[key]?.trim();
  return value && value.length <= 256 ? value : null;
};

/**
 * Bootstrap is disabled unless every server-owned input is present and the
 * independent secret has sufficient entropy. No request body may override these
 * values; the verified Supabase subject is checked against this allowlist.
 */
export const readFirstTenantBootstrapConfig = (
  environment: FirstTenantBootstrapEnvironment,
): FirstTenantBootstrapConfig | null => {
  const secret = environment.PRODX_FIRST_TENANT_BOOTSTRAP_SECRET;
  const supabaseUserId = readRequired(environment, 'PRODX_FIRST_TENANT_BOOTSTRAP_SUBJECT');
  const organizationCode = readRequired(environment, 'PRODX_FIRST_TENANT_ORGANIZATION_CODE');
  const organizationName = readRequired(environment, 'PRODX_FIRST_TENANT_ORGANIZATION_NAME');
  const storeCode = readRequired(environment, 'PRODX_FIRST_TENANT_STORE_CODE');
  const storeName = readRequired(environment, 'PRODX_FIRST_TENANT_STORE_NAME');
  const businessTimezone = readRequired(environment, 'PRODX_FIRST_TENANT_STORE_TIMEZONE');
  const ownerUsername = readRequired(environment, 'PRODX_FIRST_TENANT_OWNER_USERNAME');
  const ownerDisplayName = readRequired(environment, 'PRODX_FIRST_TENANT_OWNER_DISPLAY_NAME');
  const deviceKey = readRequired(environment, 'PRODX_FIRST_TENANT_DEVICE_KEY');
  const deviceName = readRequired(environment, 'PRODX_FIRST_TENANT_DEVICE_NAME');

  if (!secret || secret.length < 32 || !supabaseUserId || !UUID_PATTERN.test(supabaseUserId)
      || !organizationCode || !organizationName || !storeCode || !storeName
      || !businessTimezone || !ownerUsername || !ownerDisplayName || !deviceKey || !deviceName) {
    return null;
  }

  return {
    secret,
    supabaseUserId: supabaseUserId.toLowerCase(),
    organizationCode,
    organizationName,
    storeCode,
    storeName,
    businessTimezone,
    ownerUsername,
    ownerDisplayName,
    deviceKey,
    deviceName,
  };
};
