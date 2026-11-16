export type ProductionDiscountPolicy = {
  requireSupervisorApproval: boolean;
  maxDiscountWithoutApprovalBps: number;
};

const API_BASE_URL = import.meta.env.VITE_AUTH_API_BASE_URL;

export function createProductionDiscountPolicyApi(token: string) {
  return {
    async getPolicy(): Promise<ProductionDiscountPolicy> {
      if (!token.trim()) throw new Error('Authenticated session token is required to read discount policy.');
      if (!API_BASE_URL) throw new Error('Production authentication API is not configured.');
      const response = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/v1/security/discount-policy', {
        method: 'GET', credentials: 'include', headers: { Accept: 'application/json', Authorization: `Bearer ${token.trim()}` },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== 'object' || typeof (body as ProductionDiscountPolicy).requireSupervisorApproval !== 'boolean' ||
          (!Number.isInteger((body as ProductionDiscountPolicy).maxDiscountWithoutApprovalBps) || (body as ProductionDiscountPolicy).maxDiscountWithoutApprovalBps < 0 || (body as ProductionDiscountPolicy).maxDiscountWithoutApprovalBps > 10000)) {
        const message = body && typeof body === 'object' && 'error' in body
          ? String((body as { error?: { message?: unknown } }).error?.message ?? 'Discount policy could not be loaded.')
          : 'Discount policy could not be loaded.';
        throw new Error(message);
      }
      return body as ProductionDiscountPolicy;
    },
    async updatePolicy(policy: ProductionDiscountPolicy): Promise<ProductionDiscountPolicy> {
      if (!token.trim()) throw new Error('Authenticated session token is required to update discount policy.');
      if (!API_BASE_URL) throw new Error('Production authentication API is not configured.');
      if (typeof policy.requireSupervisorApproval !== 'boolean' || !Number.isInteger(policy.maxDiscountWithoutApprovalBps) || policy.maxDiscountWithoutApprovalBps < 0 || policy.maxDiscountWithoutApprovalBps > 10000) throw new Error('Discount policy threshold must be an integer from 0 to 10000 basis points.');
      const response = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/v1/security/discount-policy', {
        method: 'PUT', credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify(policy),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== 'object') {
        const message = body && typeof body === 'object' && 'error' in body
          ? String((body as { error?: { message?: unknown } }).error?.message ?? 'Discount policy could not be saved.')
          : 'Discount policy could not be saved.';
        throw new Error(message);
      }
      return body as ProductionDiscountPolicy;
    },
  };
}

export function getLocalDiscountPolicy(): ProductionDiscountPolicy {
  const defaults: ProductionDiscountPolicy = { requireSupervisorApproval: true, maxDiscountWithoutApprovalBps: 1500 };
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem('prodx_pos_security_policies');
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as { requirePinForDiscount?: unknown; maxDiscountWithoutApproval?: unknown };
    const percent = Number(saved.maxDiscountWithoutApproval);
    return {
      requireSupervisorApproval: typeof saved.requirePinForDiscount === 'boolean' ? saved.requirePinForDiscount : defaults.requireSupervisorApproval,
      maxDiscountWithoutApprovalBps: Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round(percent * 100) : defaults.maxDiscountWithoutApprovalBps,
    };
  } catch {
    return defaults;
  }
}
