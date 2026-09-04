/**
 * Query Preprocessor - Main Pipeline Orchestrator
 * Combines normalization, abbreviation expansion, and synonym expansion
 */

import { normalizeComplete, extractTestCaseIds } from './normalizer.js';
import { expandAbbreviations, smartExpand } from './abbreviationMapper.js';
import { expandSynonyms, expandComplete as expandSynonymsComplete } from './synonymExpander.js';

/**
 * Main query preprocessing pipeline
 * @param {string} rawQuery - Raw user input
 * @param {Object} options - Processing options
 * @returns {Object} - Complete preprocessing result
 */
export function preprocessQuery(rawQuery, options = {}) {
  const startTime = Date.now();

  const {
    enableAbbreviations = true,
    enableSynonyms = true,
    maxSynonymVariations = 5,
    customAbbreviations = {},
    customSynonyms = {},
    smartExpansion = false,
    preserveTestCaseIds = true
  } = options;

  // Validate input
  if (!rawQuery || typeof rawQuery !== 'string') {
    return {
      original: rawQuery || '',
      normalized: '',
      abbreviationExpanded: '',
      synonymExpanded: [],
      metadata: {
        error: 'Invalid input query',
        processingTime: 0
      }
    };
  }

  // Step 1: Extract and preserve test case IDs
  let testCaseIds = [];
  let workingQuery = rawQuery;
  
  if (preserveTestCaseIds) {
    const tcResult = extractTestCaseIds(rawQuery);
    testCaseIds = tcResult.testCaseIds;
    workingQuery = tcResult.normalized;
  }

  // Step 2: Normalize
  const normalizeResult = normalizeComplete(workingQuery, {
    lowercase: true,
    preserveHyphens: true,
    preserveNumbers: true
  });

  const normalized = normalizeResult.normalized;

  // Step 3: Expand abbreviations
  let abbreviationExpanded = normalized;
  let abbreviationMappings = [];

  if (enableAbbreviations) {
    const abbrevResult = smartExpansion
      ? smartExpand(normalized)
      : expandAbbreviations(normalized, customAbbreviations);
    
    abbreviationExpanded = abbrevResult.expanded;
    abbreviationMappings = abbrevResult.mappings;
  }

  // Step 4: Expand synonyms
  let synonymExpanded = [abbreviationExpanded];
  let synonymMappings = [];

  if (enableSynonyms) {
    const synResult = expandSynonyms(abbreviationExpanded, {
      customSynonyms,
      maxVariations: maxSynonymVariations,
      includeOriginal: true,
      minSynonymLength: 3
    });
    
    synonymExpanded = synResult.expanded;
    synonymMappings = synResult.mappings;
  }

  // Step 5: Re-attach test case IDs if needed
  if (preserveTestCaseIds && testCaseIds.length > 0) {
    const testCaseStr = testCaseIds.map(tc => tc.normalized).join(' ');
    synonymExpanded = synonymExpanded.map(query => `${testCaseStr} ${query}`);
  }

  const processingTime = Date.now() - startTime;

  return {
    original: rawQuery,
    normalized,
    abbreviationExpanded,
    synonymExpanded,
    metadata: {
      testCaseIds,
      abbreviationMappings,
      synonymMappings,
      tokens: normalizeResult.metadata.tokens,
      processingTime,
      steps: {
        normalization: true,
        abbreviationExpansion: enableAbbreviations,
        synonymExpansion: enableSynonyms
      }
    }
  };
}

/**
 * Quick preprocessing - only normalization and abbreviations
 * Faster option when synonym expansion is not needed
 * @param {string} rawQuery - Raw input
 * @param {Object} options - Options
 * @returns {Object} - Preprocessing result
 */
export function preprocessQueryQuick(rawQuery, options = {}) {
  return preprocessQuery(rawQuery, {
    ...options,
    enableSynonyms: false,
    maxSynonymVariations: 0
  });
}

/**
 * Full preprocessing with phrase expansion
 * Most comprehensive option
 * @param {string} rawQuery - Raw input
 * @param {Object} options - Options
 * @returns {Object} - Preprocessing result
 */
export function preprocessQueryComplete(rawQuery, options = {}) {
  const startTime = Date.now();

  const {
    maxSynonymVariations = 5,
    customAbbreviations = {},
    customSynonyms = {}
  } = options;

  if (!rawQuery) {
    return {
      original: '',
      normalized: '',
      abbreviationExpanded: '',
      synonymExpanded: [],
      metadata: { error: 'Empty query', processingTime: 0 }
    };
  }

  // Step 1: Normalize
  const normalizeResult = normalizeComplete(rawQuery);
  const normalized = normalizeResult.normalized;

  // Step 2: Expand abbreviations
  const abbrevResult = expandAbbreviations(normalized, customAbbreviations);
  const abbreviationExpanded = abbrevResult.expanded;

  // Step 3: Expand synonyms (includes phrase expansion)
  const synResult = expandSynonymsComplete(abbreviationExpanded, {
    customSynonyms,
    maxVariations: maxSynonymVariations
  });

  const processingTime = Date.now() - startTime;

  return {
    original: rawQuery,
    normalized,
    abbreviationExpanded,
    synonymExpanded: synResult.expanded,
    metadata: {
      abbreviationMappings: abbrevResult.mappings,
      synonymMappings: synResult.mappings.synonyms,
      phraseMappings: synResult.mappings.phrases,
      tokens: normalizeResult.metadata.tokens,
      processingTime,
      steps: {
        normalization: true,
        abbreviationExpansion: true,
        synonymExpansion: true,
        phraseExpansion: true
      }
    }
  };
}

/**
 * Batch preprocess multiple queries
 * @param {string[]} queries - Array of queries
 * @param {Object} options - Processing options
 * @returns {Array} - Array of preprocessing results
 */
export function batchPreprocessQueries(queries, options = {}) {
  if (!Array.isArray(queries)) {
    return [];
  }

  return queries.map(query => preprocessQuery(query, options));
}

/**
 * Preprocess and return only the best expanded query
 * Useful when you need just one variant
 * @param {string} rawQuery - Raw input
 * @param {Object} options - Options
 * @returns {Object} - { query, metadata }
 */
export function preprocessQueryBest(rawQuery, options = {}) {
  const result = preprocessQuery(rawQuery, {
    ...options,
    maxSynonymVariations: 3
  });

  // Return the first synonym expansion (usually most relevant)
  const bestQuery = result.synonymExpanded[0] || result.abbreviationExpanded;

  return {
    query: bestQuery,
    metadata: {
      original: result.original,
      transformations: {
        normalized: result.normalized !== result.original,
        abbreviationsExpanded: result.abbreviationExpanded !== result.normalized,
        synonymsExpanded: result.synonymExpanded.length > 1
      },
      processingTime: result.metadata.processingTime
    }
  };
}

/**
 * Analyze query preprocessing potential
 * Shows what transformations would be applied without actually applying them
 * @param {string} rawQuery - Raw input
 * @returns {Object} - Analysis result
 */
export function analyzeQuery(rawQuery) {
  if (!rawQuery) {
    return {
      original: '',
      analysis: {
        hasTestCaseIds: false,
        hasAbbreviations: false,
        hasSynonymOpportunities: false,
        estimatedVariations: 0
      }
    };
  }

  const normalizeResult = normalizeComplete(rawQuery);
  const normalized = normalizeResult.normalized;

  // Check for abbreviations
  const abbrevResult = expandAbbreviations(normalized);
  const hasAbbreviations = abbrevResult.mappings.length > 0;

  // Check for synonym opportunities
  const synResult = expandSynonyms(abbrevResult.expanded, {
    maxVariations: 10,
    includeOriginal: false
  });
  const hasSynonymOpportunities = synResult.mappings.length > 0;

  // Check for test case IDs
  const tcResult = extractTestCaseIds(rawQuery);
  const hasTestCaseIds = tcResult.testCaseIds.length > 0;

  return {
    original: rawQuery,
    normalized,
    analysis: {
      hasTestCaseIds,
      testCaseIds: tcResult.testCaseIds,
      hasAbbreviations,
      abbreviations: abbrevResult.mappings,
      hasSynonymOpportunities,
      synonymOpportunities: synResult.mappings,
      estimatedVariations: synResult.expanded.length,
      tokens: normalizeResult.metadata.tokens,
      tokenCount: normalizeResult.metadata.tokens.length
    }
  };
}

/**
 * Preprocess with detailed logging
 * Useful for debugging and understanding transformations
 * @param {string} rawQuery - Raw input
 * @param {Object} options - Options
 * @returns {Object} - Result with detailed logs
 */
export function preprocessQueryWithLogs(rawQuery, options = {}) {
  const logs = [];
  const startTime = Date.now();

  logs.push({ step: 'start', query: rawQuery, time: 0 });

  // Normalize
  const t1 = Date.now();
  const normalizeResult = normalizeComplete(rawQuery);
  logs.push({
    step: 'normalize',
    query: normalizeResult.normalized,
    time: Date.now() - t1,
    changes: normalizeResult.normalized !== rawQuery
  });

  // Abbreviations
  const t2 = Date.now();
  const abbrevResult = expandAbbreviations(normalizeResult.normalized);
  logs.push({
    step: 'abbreviations',
    query: abbrevResult.expanded,
    time: Date.now() - t2,
    changes: abbrevResult.mappings.length > 0,
    mappings: abbrevResult.mappings
  });

  // Synonyms
  const t3 = Date.now();
  const synResult = expandSynonyms(abbrevResult.expanded, {
    maxVariations: options.maxSynonymVariations || 5
  });
  logs.push({
    step: 'synonyms',
    queries: synResult.expanded,
    time: Date.now() - t3,
    changes: synResult.mappings.length > 0,
    mappings: synResult.mappings
  });

  const totalTime = Date.now() - startTime;

  return {
    original: rawQuery,
    normalized: normalizeResult.normalized,
    abbreviationExpanded: abbrevResult.expanded,
    synonymExpanded: synResult.expanded,
    logs,
    totalTime
  };
}

/**
 * Compare two queries after preprocessing
 * Useful for A/B testing
 * @param {string} query1 - First query
 * @param {string} query2 - Second query
 * @returns {Object} - Comparison result
 */
export function compareQueries(query1, query2) {
  const result1 = preprocessQuery(query1);
  const result2 = preprocessQuery(query2);

  return {
    query1: {
      original: query1,
      processed: result1.synonymExpanded[0],
      variations: result1.synonymExpanded.length
    },
    query2: {
      original: query2,
      processed: result2.synonymExpanded[0],
      variations: result2.synonymExpanded.length
    },
    similarity: {
      sameNormalized: result1.normalized === result2.normalized,
      sameAfterAbbreviations: result1.abbreviationExpanded === result2.abbreviationExpanded,
      overlappingVariations: countOverlappingVariations(
        result1.synonymExpanded,
        result2.synonymExpanded
      )
    }
  };
}

/**
 * Helper: Count overlapping variations between two query sets
 * @param {string[]} set1 - First set
 * @param {string[]} set2 - Second set
 * @returns {number} - Count of overlapping queries
 */
function countOverlappingVariations(set1, set2) {
  const set1Lower = new Set(set1.map(q => q.toLowerCase()));
  return set2.filter(q => set1Lower.has(q.toLowerCase())).length;
}

/**
 * Get preprocessing statistics
 * @param {string[]} queries - Array of queries
 * @returns {Object} - Statistics
 */
export function getPreprocessingStats(queries) {
  if (!Array.isArray(queries) || queries.length === 0) {
    return {
      totalQueries: 0,
      averageVariations: 0,
      averageProcessingTime: 0
    };
  }

  const results = queries.map(q => preprocessQuery(q));

  const totalVariations = results.reduce((sum, r) => sum + r.synonymExpanded.length, 0);
  const totalTime = results.reduce((sum, r) => sum + r.metadata.processingTime, 0);

  return {
    totalQueries: queries.length,
    averageVariations: totalVariations / queries.length,
    averageProcessingTime: totalTime / queries.length,
    totalAbbreviationsExpanded: results.reduce(
      (sum, r) => sum + r.metadata.abbreviationMappings.length,
      0
    ),
    totalSynonymsExpanded: results.reduce(
      (sum, r) => sum + r.metadata.synonymMappings.length,
      0
    )
  };
}

export default {
  preprocessQuery,
  preprocessQueryQuick,
  preprocessQueryComplete,
  preprocessQueryBest,
  batchPreprocessQueries,
  analyzeQuery,
  preprocessQueryWithLogs,
  compareQueries,
  getPreprocessingStats
};
