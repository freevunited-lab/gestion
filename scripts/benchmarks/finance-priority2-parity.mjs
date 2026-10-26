/**
 * Compare the compatibility surface shared by the legacy and exact-unit engines.
 * The new engine also returns currency/minor-unit metadata and locale-formatted
 * alert amounts; those are additive representation changes, not finance deltas.
 */
export function legacyFinanceProjection(value, key = '') {
  if (Array.isArray(value)) return value
    .filter(item => key !== 'alerts' || !/^(Trésorerie potentiellement négative|Creux de trésorerie possible)/.test(item?.text || ''))
    .map(item => legacyFinanceProjection(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([name]) => name !== 'currency' && !name.endsWith('Minor') &&
        name !== 'lowestBalance' && name !== 'negativeDailyCloseDate')
      .map(([name, item]) => [name, legacyFinanceProjection(item, name)]));
  }
  if (key === 'text' && typeof value === 'string') {
    return value.replace(/[0-9][0-9.,\s\u00a0\u202f]*€/g, '#€');
  }
  return value;
}
