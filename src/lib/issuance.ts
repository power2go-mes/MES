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

export type HandoverStatus = 'PENDING_SIGNATURE' | 'COMPLETED';

export interface HandoverMetadata {
  handoverStatus?: HandoverStatus | null;
  signedSlipUrl?: string | null;
  signedSlipFileName?: string | null;
  signedSlipUploadedAt?: string | null;
}

export function mergeLocalHandoverMetadata<T extends { id: string; entityType: string } & HandoverMetadata>(
  items: T[],
  storage?: Pick<Storage, 'getItem'>
): Array<T & HandoverMetadata> {
  return items.map(item => {
    let localMetadata: HandoverMetadata | null = null;
    if (storage) {
      try {
        const raw = storage.getItem(`p2g_handover_${item.entityType}_${item.id}`);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            const value = parsed as Record<string, unknown>;
            localMetadata = {
              handoverStatus: value.handoverStatus === 'PENDING_SIGNATURE' || value.handoverStatus === 'COMPLETED'
                ? value.handoverStatus
                : item.handoverStatus ?? null,
              signedSlipUrl: typeof value.signedSlipUrl === 'string' ? value.signedSlipUrl : item.signedSlipUrl ?? null,
              signedSlipFileName: typeof value.signedSlipFileName === 'string'
                ? value.signedSlipFileName
                : item.signedSlipFileName ?? null,
              signedSlipUploadedAt: typeof value.signedSlipUploadedAt === 'string'
                ? value.signedSlipUploadedAt
                : item.signedSlipUploadedAt ?? null,
            };
          }
        }
      } catch (error) {
        console.warn(`Could not read local handover state for ${item.entityType} ${item.id}.`, error);
      }
    }

    return {
      ...item,
      handoverStatus: localMetadata?.handoverStatus ?? item.handoverStatus ?? null,
      signedSlipUrl: localMetadata?.signedSlipUrl ?? item.signedSlipUrl ?? null,
      signedSlipFileName: localMetadata?.signedSlipFileName ?? item.signedSlipFileName ?? null,
      signedSlipUploadedAt: localMetadata?.signedSlipUploadedAt ?? item.signedSlipUploadedAt ?? null,
    };
  });
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

