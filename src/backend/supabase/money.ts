/**
 * Even split used when an order is placed.
 * Each non-payer owes this many cents. The payer keeps `totalCents % memberCount`
 * leftover cents, so the shares always add up to the order total.
 * Returns 0 when there are no members.
 */
export function evenShareCents(totalCents: number, memberCount: number): number {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error('totalCents must be a non-negative integer');
  }
  if (!Number.isInteger(memberCount) || memberCount < 0) {
    throw new Error('memberCount must be a non-negative integer');
  }
  if (memberCount === 0) return 0;
  return Math.floor(totalCents / memberCount);
}

/**
 * Cents the payer absorbs so the sum of non-payer shares plus the payer's
 * remainder equals the order total.
 */
export function payerRemainderCents(totalCents: number, memberCount: number): number {
  if (memberCount === 0) return totalCents;
  return totalCents - evenShareCents(totalCents, memberCount) * (memberCount - 1);
}
