export type DashboardChartRow = {
  label: string;
  value: number;
  color: string;
};

export type DashboardDistribution = {
  rows: Array<DashboardChartRow & { share: number }>;
  total: number;
  percentageTotal: number;
  reconciles: boolean;
};

const toCount = (value: unknown) => {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
};

export const buildDashboardDistribution = (
  rows: Array<{ label?: unknown; value?: unknown; color?: string }>,
  labels: Array<{ label: string; color: string }>,
  expectedTotal?: unknown,
): DashboardDistribution => {
  const values = new Map(labels.map(({ label }) => [label, 0]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = String(row.label ?? '').replace(/_/g, ' ');
    if (values.has(label)) values.set(label, (values.get(label) || 0) + toCount(row.value));
  }

  const normalized = labels.map(({ label, color }) => ({ label, value: values.get(label) || 0, color }));
  const total = normalized.reduce((sum, row) => sum + row.value, 0);
  const expected = expectedTotal === undefined ? total : toCount(expectedTotal);
  const exactShares = total > 0 ? normalized.map(row => (row.value / total) * 10000) : normalized.map(() => 0);
  const shares = exactShares.map(Math.floor);
  let remainder = total > 0 ? 10000 - shares.reduce((sum, share) => sum + share, 0) : 0;
  const order = exactShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((left, right) => right.fraction - left.fraction);
  let orderIndex = 0;
  while (remainder > 0 && order.length > 0) {
    shares[order[orderIndex % order.length].index] += 1;
    orderIndex += 1;
    remainder -= 1;
  }

  return {
    rows: normalized.map((row, index) => ({ ...row, share: shares[index] / 100 })),
    total,
    percentageTotal: shares.reduce((sum, share) => sum + share, 0) / 100,
    reconciles: total === expected,
  };
};
