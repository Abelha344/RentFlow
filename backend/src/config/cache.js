const NodeCache = require('node-cache');

/** In-memory cache for catalog / pricing GET responses (TTL 5 minutes). */
const cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  useClones: true,
});

const CACHE_KEYS = {
  INVENTORY_LIST_PREFIX: 'inventory:list:',
  INVENTORY_ITEM_PREFIX: 'inventory:item:',
};

function inventoryListKey(query = {}) {
  const normalized = JSON.stringify({
    search: query.search || '',
    category: query.category || '',
    low_stock: query.low_stock || '',
  });
  return `${CACHE_KEYS.INVENTORY_LIST_PREFIX}${normalized}`;
}

function inventoryItemKey(id) {
  return `${CACHE_KEYS.INVENTORY_ITEM_PREFIX}${id}`;
}

/** Drop all inventory catalog / pricing cache entries. */
function invalidateInventoryCache() {
  const keys = cache.keys().filter(
    (k) =>
      k.startsWith(CACHE_KEYS.INVENTORY_LIST_PREFIX) ||
      k.startsWith(CACHE_KEYS.INVENTORY_ITEM_PREFIX)
  );
  if (keys.length) cache.del(keys);
}

module.exports = {
  cache,
  CACHE_KEYS,
  inventoryListKey,
  inventoryItemKey,
  invalidateInventoryCache,
};
