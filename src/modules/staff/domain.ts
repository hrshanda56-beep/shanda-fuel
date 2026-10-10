import { createHash, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';

import { AppError } from '../../platform/errors';
import type { RoleCode, ScopeType } from '../authorization';
import type { StaffInvitationScope } from './contracts';

export const STAFF_INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

const emailSchema = z.string().trim().email().max(320);
const roleSchema = z.enum(['OWNER', 'ADMINISTRATOR', 'FINANCE', 'SUPERVISOR', 'ATTENDANT']);
const scopeSchema = z.enum(['TENANT', 'LEGAL_ENTITY', 'STATION']);
const staffNumberSchema = z.string().regex(/^SF-[0-9]{8}$/);

export function normalizeEmail(value: string): string {
  const email = emailSchema.parse(value).toLowerCase();
  if (email !== value.trim().toLowerCase()) return email;
  return email;
}

export function createInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function normalizeStaffNumber(value: string): string {
  const normalized = value.trim().toUpperCase();
  return staffNumberSchema.parse(normalized);
}

export function createStaffNumber(): string {
  return `SF-${randomInt(0, 100_000_000).toString().padStart(8, '0')}`;
}

export function createActivationCode(): { code: string; codeHash: string } {
  const code = randomBytes(20).toString('hex').toUpperCase();
  return { code, codeHash: hashInvitationToken(code.toLowerCase()) };
}

export function invitationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + STAFF_INVITATION_TTL_MS);
}

export function parseRole(value: unknown): RoleCode {
  return roleSchema.parse(value);
}

export function parseScopeType(value: unknown): ScopeType {
  return scopeSchema.parse(value);
}

export function validateInvitationScope(
  role: RoleCode,
  scope: StaffInvitationScope,
): StaffInvitationScope {
  const scopeType = parseScopeType(scope.scopeType);
  const legalEntityId = scope.legalEntityId?.trim() || undefined;
  const stationIds = [...new Set(scope.stationIds.map((id) => id.trim()).filter(Boolean))];

  if (role === 'OWNER' || role === 'ADMINISTRATOR') {
    if (scopeType !== 'TENANT' || legalEntityId || stationIds.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'This role requires tenant scope');
    }
  } else if (role === 'FINANCE') {
    if (scopeType === 'TENANT' || (scopeType === 'LEGAL_ENTITY' && !legalEntityId)) {
      throw new AppError('VALIDATION_FAILED', 'Finance scope is incomplete');
    }
    if (scopeType === 'LEGAL_ENTITY' && stationIds.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Legal-entity scope cannot include stations');
    }
    if (scopeType === 'STATION' && (!legalEntityId || stationIds.length === 0)) {
      throw new AppError('VALIDATION_FAILED', 'Finance station scope requires stations');
    }
  } else if (scopeType !== 'STATION' || !legalEntityId || stationIds.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'This role requires one or more stations');
  }

  return {
    scopeType,
    ...(legalEntityId ? { legalEntityId } : {}),
    stationIds,
  };
}

export function assertInvitationToken(token: string): string {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
    throw new AppError('NOT_FOUND', 'This invitation is no longer available');
  }
  return token;
}
