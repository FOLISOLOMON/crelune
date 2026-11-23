/**
 * CRELUNE — Shared Creative Agent Authorization, Claim Fencing & Asset Error Types
 *
 * Leaf module shared by `agent-service.ts`, `job-preparation-service.ts`,
 * `agent-http.ts`, and `design-http.ts` to avoid circular module dependencies
 * while preserving exact transactional error classification.
 */

export class CreativeAgentNotFoundError extends Error {
  constructor() {
    super('Creative agent not found.');
    this.name = 'CreativeAgentNotFoundError';
  }
}

export class CreativeAgentRevokedError extends Error {
  constructor(
    message: string = 'Unauthorized: Creative agent credentials have been revoked.'
  ) {
    super(message);
    this.name = 'CreativeAgentRevokedError';
  }
}

export class CreativeAgentForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeAgentForbiddenError';
  }
}

export type CreativeAgentClaimErrorCode =
  | 'DISPATCH_CLAIM_REQUIRED'
  | 'DISPATCH_CLAIM_INVALID'
  | 'DISPATCH_CLAIM_MISMATCH'
  | 'DISPATCH_LEASE_EXPIRED'
  | 'DISPATCH_NOT_ASSIGNED'
  | 'DISPATCH_NOT_EXPORTABLE';

export class CreativeAgentClaimError extends Error {
  public readonly code: CreativeAgentClaimErrorCode;

  constructor(message: string, code: CreativeAgentClaimErrorCode) {
    super(message);
    this.name = 'CreativeAgentClaimError';
    this.code = code;
  }
}

export class CreativeAgentAssetNotFoundError extends Error {
  constructor(message: string = 'Authorised asset not found for this dispatch.') {
    super(message);
    this.name = 'CreativeAgentAssetNotFoundError';
  }
}

export class CreativeAgentUnsupportedAssetError extends Error {
  constructor(
    message: string = 'Only MEMBER_PHOTO assets are supported for agent delivery in Milestone 5; general creative working assets are deferred to Milestone 8.'
  ) {
    super(message);
    this.name = 'CreativeAgentUnsupportedAssetError';
  }
}

export interface AgentClaimVerificationContext {
  agentId: string;
  dispatchId: string;
  claimToken: string;
}

export const EXPORTABLE_DISPATCH_STATUSES = [
  'CLAIMED',
  'DOWNLOADING_ASSETS',
  'OPENING_TEMPLATE',
  'READY_FOR_ARTIST',
  'EXPORTING',
] as const;
