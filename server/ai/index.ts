export { AICoreService, createAIProviderRegistry } from './core';
export type { AICorePolicy, AICoreRequest, AIProviderRegistry } from './core';
export { AIGatewayService, redactSensitiveContent } from './gateway';
export type {
  AIAuthorizer,
  AIAuditEvent,
  AIAuditor,
  AIGatewayPolicy,
  AIGatewayRequest,
  AIProviderRegistry as AIGatewayProviderRegistry,
  AIScope,
} from './gateway';
export { AIBackendBoundary, AIAuthorizationError } from './backend-boundary';
export type { AIBackendPrincipal, AIBackendRequest, AIBackendPolicy } from './backend-boundary';
export { createAIHttpAdapter } from './http-contract';
export type { AIHttpAdapter, AIHttpRequest } from './http-contract';
export { installAIHttpRoute } from './http-route';
export type { AIHttpRouteOptions } from './http-route';
export { AI_CAPABILITIES, AI_NON_AUTHORITATIVE_DOMAINS, DEFAULT_AI_CAPABILITY_POLICY } from './capabilities';
export type { AICapability, AICapabilityPolicy, AINonAuthoritativeDomain } from './capabilities';
export { AI_AUTHORITY_RULE } from './capability-contract';
export type { AIAuthoritativeDomain } from './capability-contract';
export type {
  AIChatRequest,
  AIChatResponse,
  AIMessage,
  AIMessageRole,
  AIProvider,
  AIUsage,
} from './types';

export { GeminiProvider } from './geminiProvider';
export type { GeminiProviderConfig } from './geminiProvider';
