export const INTEGRATION_PROVIDER_IDS = ["google"] as const;
export type IntegrationProviderId = (typeof INTEGRATION_PROVIDER_IDS)[number];

export type IntegrationAuthType = "oauth2";
export type IntegrationPermissionTier = "default" | "sensitive" | "restricted";

export interface IntegrationProvider {
  id: IntegrationProviderId;
  displayName: string;
  authType: IntegrationAuthType;
  supportsIncrementalScopes: boolean;
  defaultScopes: string[];
  sensitiveScopes: string[];
  restrictedScopes: string[];
}

export interface IntegrationPermissionDescriptor {
  key: string;
  label: string;
  scopes: string[];
  tier: IntegrationPermissionTier;
  description: string;
}
