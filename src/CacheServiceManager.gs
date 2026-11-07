/**
 * @file CacheServiceManager.gs
 * @description Gerenciador de cache inteligente em múltiplos níveis (L1 Memória, L2 CacheService Apps Script)
 * com invalidação por tags/chaves, métricas de latência e otimização de leitura no Google Sheets.
 */

var CacheServiceManager = (function () {
  // L1: Cache em memória no escopo da execução V8 atual
  var l1MemoryCache = {};
  var knownKeys = {};

  // Métricas de desempenho em tempo de execução
  var metrics = {
    hits: 0,
    misses: 0,
    l1_hits: 0,
    l2_hits: 0,
    writes: 0,
    invalidations: 0,
    total_saved_ms: 0,
    last_reset: new Date().toISOString()
  };

  var VERSION = 'v1';
  var MAX_GAS_CACHE_CHUNK_BYTES = 90000; // Limite de 100KB com margem de segurança

  function getGasCache() {
    try {
      if (typeof CacheService !== 'undefined') {
        return CacheService.getUserCache() || CacheService.getScriptCache();
      }
    } catch (e) {}
    return null;
  }

  function buildCacheKey(key, userOrGroup) {
    var prefix = 'fin_' + VERSION + '_';
    if (userOrGroup) {
      prefix += (typeof userOrGroup === 'object' ? (userOrGroup.grupo_id || userOrGroup.id || '') : String(userOrGroup)) + '_';
    }
    return prefix + key;
  }

  /**
   * Obtém valor do cache (L1 -> L2).
   */
  function get(key, userOrGroup) {
    var fullKey = buildCacheKey(key, userOrGroup);

    // 1. Verificação no cache L1 (Memória de execução)
    if (l1MemoryCache[fullKey] !== undefined) {
      metrics.hits++;
      metrics.l1_hits++;
      metrics.total_saved_ms += 15;
      return l1MemoryCache[fullKey];
    }

    // 2. Verificação no cache L2 (CacheService do Apps Script)
    var gasCache = getGasCache();
    if (gasCache) {
      try {
        var raw = gasCache.get(fullKey);
        if (raw !== null && raw !== undefined) {
          var val = JSON.parse(raw);
          l1MemoryCache[fullKey] = val; // Popula L1
          metrics.hits++;
          metrics.l2_hits++;
          metrics.total_saved_ms += 40;
          return val;
        }
      } catch (err) {}
    }

    metrics.misses++;
    return null;
  }

  /**
   * Armazena valor no cache (L1 e L2).
   */
  function put(key, value, ttlSeconds, userOrGroup) {
    if (value === undefined) return;
    var fullKey = buildCacheKey(key, userOrGroup);
    var ttl = Math.min(Math.max(10, parseInt(ttlSeconds, 10) || 600), 21600); // 10s a 6h

    // 1. Armazena no L1
    l1MemoryCache[fullKey] = value;
    knownKeys[fullKey] = true;
    metrics.writes++;

    // 2. Armazena no L2 se couber no limite do Google Apps Script
    var gasCache = getGasCache();
    if (gasCache) {
      try {
        var str = JSON.stringify(value);
        if (str.length <= MAX_GAS_CACHE_CHUNK_BYTES) {
          gasCache.put(fullKey, str, ttl);
        }
      } catch (err) {}
    }
  }

  /**
   * Obtém valor existente ou calcula executando a função produtora (Cache-Aside pattern).
   */
  function getOrCompute(key, producerFn, ttlSeconds, userOrGroup) {
    var cached = get(key, userOrGroup);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    var startTime = Date.now();
    var freshValue = producerFn();
    var duration = Date.now() - startTime;

    put(key, freshValue, ttlSeconds, userOrGroup);
    return freshValue;
  }

  /**
   * Remove uma chave específica de todos os níveis de cache.
   */
  function remove(key, userOrGroup) {
    var fullKey = buildCacheKey(key, userOrGroup);
    delete l1MemoryCache[fullKey];
    delete knownKeys[fullKey];
    metrics.invalidations++;

    var gasCache = getGasCache();
    if (gasCache) {
      try {
        gasCache.remove(fullKey);
      } catch (e) {}
    }
  }

  /**
   * Invalida um conjunto de chaves ou prefixos no cache.
   */
  function invalidateTag(tag, userOrGroup) {
    var tagPrefix = buildCacheKey(tag, userOrGroup);
    var gasCache = getGasCache();

    var keysToRemove = {};
    Object.keys(knownKeys).forEach(function (k) {
      if (k.indexOf(tagPrefix) === 0 || k.indexOf(tag) !== -1) {
        keysToRemove[k] = true;
      }
    });

    Object.keys(l1MemoryCache).forEach(function (k) {
      if (k.indexOf(tagPrefix) === 0 || k.indexOf(tag) !== -1) {
        keysToRemove[k] = true;
      }
    });

    var keysList = Object.keys(keysToRemove);
    for (var i = 0; i < keysList.length; i++) {
      var rk = keysList[i];
      delete l1MemoryCache[rk];
      delete knownKeys[rk];
      if (gasCache) {
        try { gasCache.remove(rk); } catch (e) {}
      }
    }

    if (gasCache) {
      try { gasCache.remove(tagPrefix); } catch (e) {}
      try { gasCache.remove(buildCacheKey(tag, userOrGroup)); } catch (e) {}
    }

    metrics.invalidations++;
  }

  /**
   * Invalida caches comuns após mutações financeiras (lançamentos, categorias, contas).
   */
  function invalidateFinancialCache(userOrGroup) {
    var tags = ['categories', 'bankAccounts', 'dashboard_summary', 'launches_recent', 'debts', 'loans', 'planning'];
    for (var i = 0; i < tags.length; i++) {
      invalidateTag(tags[i], userOrGroup);
    }
  }

  /**
   * Limpa integralmente a memória L1.
   */
  function clearL1() {
    l1MemoryCache = {};
  }

  /**
   * Retorna métricas de saúde e rendimento do cache para o painel de Diagnóstico & Performance.
   */
  function getMetrics() {
    var totalRequests = metrics.hits + metrics.misses;
    var hitRate = totalRequests > 0 ? Number(((metrics.hits / totalRequests) * 100).toFixed(1)) : 100;

    return {
      total_requests: totalRequests,
      hits: metrics.hits,
      misses: metrics.misses,
      hit_rate_pct: hitRate,
      l1_hits: metrics.l1_hits,
      l2_hits: metrics.l2_hits,
      writes: metrics.writes,
      invalidations: metrics.invalidations,
      estimated_saved_ms: metrics.total_saved_ms,
      l1_keys_in_memory: Object.keys(l1MemoryCache).length,
      last_reset: metrics.last_reset
    };
  }

  return {
    get: get,
    put: put,
    getOrCompute: getOrCompute,
    remove: remove,
    invalidateTag: invalidateTag,
    invalidateFinancialCache: invalidateFinancialCache,
    clearL1: clearL1,
    getMetrics: getMetrics
  };
})();
