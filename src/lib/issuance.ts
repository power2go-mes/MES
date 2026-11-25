/**
 * Utilities for the "Issued To / Issued By" subsystem in Power2Go MES.
 */

export interface IssuanceData {
  issuedToPerson?: string | null;
  issuedToDepartment?: string | null;
  issuedBy?: string | null;
  issuedAt?: string | null;
  issued_to_person?: string | null;
  issued_to_department?: string | null;
  issued_by?: string | null;
  issued_at?: string | null;
  handoverStatus?: 'PENDING_SIGNATURE' | 'COMPLETED' | null;
  signedSlipUrl?: string | null;
}

/**
 * Returns formatted status string like "PENDING SIGNATURE" or "ISSUED (R&D)" / "ISSUED (Person Name)"
 * if the item is currently issued, otherwise returns null.
 */
export function getIssuedDisplayStatus(item?: IssuanceData | null): string | null {
  if (!item) return null;
  const person = (item.issuedToPerson ?? item.issued_to_person)?.trim();
  if (!person) return null;

  if (item.handoverStatus === 'PENDING_SIGNATURE') {
    return 'PENDING SIGNATURE';
  }

  const dept = (item.issuedToDepartment ?? item.issued_to_department)?.trim();
  return dept ? `ISSUED (${dept})` : `ISSUED (${person})`;
}

/**
 * Checks whether an item is currently issued out.
 */
export function isItemIssued(item?: IssuanceData | null): boolean {
  if (!item) return false;
  return Boolean((item.issuedToPerson ?? item.issued_to_person)?.trim());
}

