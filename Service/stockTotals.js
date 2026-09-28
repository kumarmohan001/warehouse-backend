export function normalizeUnit(value) {
  const unit = String(value ?? '').trim().toLowerCase();
  return ({ kg: 'Kg', g: 'g', mg: 'mg', l: 'L', ml: 'ml', nos: 'Nos' })[unit] || unit;
}

// Merge existing case/whitespace variants without changing stored batches or mixing units.
export function mergeStockTotals(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = typeof row._id === 'object' && row._id !== null
      ? { ...row._id, unit: normalizeUnit(row._id.unit) } : normalizeUnit(row._id);
    const key = JSON.stringify(id);
    const total = groups.get(key) || { _id: id };
    for (const field of ['quantity', 'count', 'received', 'batches', 'available']) {
      if (row[field] !== undefined) total[field] = Math.round(((total[field] || 0) + Number(row[field] || 0)) * 1e6) / 1e6;
    }
    groups.set(key, total);
  }
  return [...groups.values()];
}
