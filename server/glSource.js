const ALLOWED_GL_SOURCES = new Set([
  'manual',
  'night_audit',
  'expense',
  'pos',
  'folio',
  'reconciliation',
  'adjustment',
  'closing',
  'opening',
  'system'
]);

const SOURCE_ALIASES = {
  inventory: 'adjustment',
  inventory_control: 'adjustment',
  stock: 'adjustment',
  stock_take: 'reconciliation',
  stocktake: 'reconciliation',
  grn: 'adjustment',
  goods_received: 'adjustment',
  receipt: 'adjustment',
  pending_batch: 'adjustment',
  batch: 'adjustment',
  variance: 'reconciliation'
};

function normalizeGLSource(source) {
  const raw = String(source || '').trim().toLowerCase();
  if (!raw) return 'manual';
  if (ALLOWED_GL_SOURCES.has(raw)) return raw;
  if (SOURCE_ALIASES[raw]) return SOURCE_ALIASES[raw];
  const normalized = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (ALLOWED_GL_SOURCES.has(normalized)) return normalized;
  if (SOURCE_ALIASES[normalized]) return SOURCE_ALIASES[normalized];
  return 'manual';
}

module.exports = { normalizeGLSource, ALLOWED_GL_SOURCES };
