import { describe, expect, it } from 'vitest';
import { TECHNICAL_STATUSES } from '../src/enums';
import { roleHasPermission, ROLE_PERMISSIONS } from '../src/permissions';
import { canTransition, canTransitionQuote, findTransition, TECHNICAL_TRANSITIONS } from '../src/state-machines';

describe('technical state machine', () => {
  it('follows the happy path of section 4', () => {
    const path = ['RECEIVED', 'WAITING_DIAGNOSIS', 'DIAGNOSING', 'WAITING_QUOTE_APPROVAL', 'APPROVED', 'WAITING_PARTS', 'IN_REPAIR', 'TESTING', 'READY'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it('allows DIAGNOSING -> APPROVED for pre-approved policy and WAITING_PARTS back to APPROVED', () => {
    expect(canTransition('DIAGNOSING', 'APPROVED')).toBe(true);
    expect(canTransition('WAITING_PARTS', 'APPROVED')).toBe(true);
    expect(canTransition('WAITING_PARTS', 'IN_REPAIR')).toBe(true);
  });

  it('forbids skipping approval and leaving terminal states except via reopen', () => {
    expect(canTransition('RECEIVED', 'IN_REPAIR')).toBe(false);
    expect(canTransition('WAITING_QUOTE_APPROVAL', 'IN_REPAIR')).toBe(false);
    expect(canTransition('READY', 'IN_REPAIR')).toBe(false);
    expect(findTransition('READY', 'REOPENED')?.permission).toBe('os:reopen');
    expect(canTransition('CANCELED', 'REOPENED')).toBe(true);
  });

  it('covers every status', () => {
    for (const s of TECHNICAL_STATUSES) expect(TECHNICAL_TRANSITIONS[s]).toBeDefined();
  });

  it('quote approved cannot go back to draft; only superseded', () => {
    expect(canTransitionQuote('APPROVED', 'DRAFT')).toBe(false);
    expect(canTransitionQuote('APPROVED', 'SUPERSEDED')).toBe(true);
  });
});

describe('permissions', () => {
  it('denies by default and restricts billing to the owner', () => {
    expect(roleHasPermission('TENANT_OWNER', 'billing:manage')).toBe(true);
    expect(roleHasPermission('TENANT_ADMIN', 'billing:manage')).toBe(false);
    expect(roleHasPermission('TECHNICIAN', 'sales:discount')).toBe(false);
    expect(roleHasPermission('CASHIER', 'cash:close')).toBe(true);
    expect(roleHasPermission('RECEPTIONIST', 'stock:adjust')).toBe(false);
  });

  it('every role has an explicit list', () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) expect(Array.isArray(perms)).toBe(true);
  });
});
