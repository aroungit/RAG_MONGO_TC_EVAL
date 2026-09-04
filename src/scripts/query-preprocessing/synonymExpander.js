/**
 * Synonym Expander
 * Generates multiple query variations using synonyms
 */

import { synonymMap, phraseMap } from './dictionaries.js';

/**
 * Expand query with synonyms to generate multiple variations
 * @param {string} text - Input text
 * @param {Object} options - Expansion options
 * @returns {Object} - { expanded: [queries], mappings }
 */
export function expandSynonyms(text, options = {}) {
  const {
    customSynonyms = {},
    maxVariations = 5,
    includeOriginal = true,
    minSynonymLength = 3
  } = options;

  if (!text || typeof text !== 'string') {
    return { expanded: [], mappings: [] };
  }

  const allSynonyms = { ...synonymMap, ...customSynonyms };
  const mappings = [];
  const tokens = text.toLowerCase().split(/\s+/);
  
  // Find all synonym opportunities
  const synonymOpportunities = [];
  
  tokens.forEach((token, index) => {
    // Skip very short words
    if (token.length < minSynonymLength) return;
    
    // Check if token has synonyms
    if (allSynonyms[token]) {
      synonymOpportunities.push({
        position: index,
        original: token,
        synonyms: allSynonyms[token]
      });
      
      mappings.push({
        term: token,
        synonyms: allSynonyms[token],
        position: index
      });
    }
  });

  // Generate variations
  const variations = new Set();
  
  // Add original if requested
  if (includeOriginal) {
    variations.add(text);
  }

  // Strategy 1: Replace each term with one synonym at a time
  synonymOpportunities.forEach(opportunity => {
    opportunity.synonyms.forEach(synonym => {
      const newTokens = [...tokens];
      newTokens[opportunity.position] = synonym;
      variations.add(newTokens.join(' '));
    });
  });

  // Strategy 2: If we have multiple opportunities, try combinations
  if (synonymOpportunities.length >= 2 && variations.size < maxVariations) {
    // Generate a few smart combinations
    const combinations = generateSmartCombinations(
      tokens,
      synonymOpportunities,
      maxVariations - variations.size
    );
    
    combinations.forEach(combo => variations.add(combo));
  }

  // Convert Set to Array and limit
  const expanded = Array.from(variations).slice(0, maxVariations);

  return { expanded, mappings };
}

/**
 * Generate smart combinations of synonyms
 * Avoid combinatorial explosion by being selective
 * @param {string[]} tokens - Original tokens
 * @param {Array} opportunities - Synonym opportunities
 * @param {number} maxCombos - Max combinations to generate
 * @returns {string[]} - Array of query variations
 */
function generateSmartCombinations(tokens, opportunities, maxCombos) {
  const combinations = [];
  
  // Strategy: Replace 2 terms at once with high-value synonyms
  if (opportunities.length >= 2) {
    const limit = Math.min(maxCombos, 3);
    
    for (let i = 0; i < Math.min(opportunities.length - 1, limit); i++) {
      const opp1 = opportunities[i];
      const opp2 = opportunities[i + 1];
      
      // Take first synonym of each
      if (opp1.synonyms[0] && opp2.synonyms[0]) {
        const newTokens = [...tokens];
        newTokens[opp1.position] = opp1.synonyms[0];
        newTokens[opp2.position] = opp2.synonyms[0];
        combinations.push(newTokens.join(' '));
      }
    }
  }
  
  return combinations;
}

/**
 * Expand multi-word phrases using phrase map
 * @param {string} text - Input text
 * @returns {Object} - { expanded: [queries], mappings }
 */
export function expandPhrases(text) {
  if (!text) {
    return { expanded: [text], mappings: [] };
  }

  const mappings = [];
  const variations = new Set([text]);

  // Check each phrase in phrase map
  Object.entries(phraseMap).forEach(([phrase, alternatives]) => {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes(phrase)) {
      mappings.push({
        phrase,
        alternatives
      });
      
      // Generate variations with each alternative
      alternatives.forEach(alt => {
        const regex = new RegExp(phrase, 'gi');
        const newText = text.replace(regex, alt);
        variations.add(newText);
      });
    }
  });

  return {
    expanded: Array.from(variations),
    mappings
  };
}

/**
 * Combined expansion: both word-level synonyms and phrase-level
 * @param {string} text - Input text
 * @param {Object} options - Expansion options
 * @returns {Object} - { expanded: [queries], mappings }
 */
export function expandComplete(text, options = {}) {
  const {
    maxVariations = 5,
    customSynonyms = {}
  } = options;

  if (!text) {
    return { expanded: [], mappings: { synonyms: [], phrases: [] } };
  }

  // First, expand phrases
  const phraseResult = expandPhrases(text);
  
  // Then expand each phrase variation with synonyms
  const allVariations = new Set();
  const synonymMappings = [];

  phraseResult.expanded.forEach(variation => {
    const synResult = expandSynonyms(variation, {
      customSynonyms,
      maxVariations: Math.ceil(maxVariations / phraseResult.expanded.length),
      includeOriginal: true
    });
    
    synResult.expanded.forEach(exp => allVariations.add(exp));
    synonymMappings.push(...synResult.mappings);
  });

  // Deduplicate mappings
  const uniqueSynonymMappings = Array.from(
    new Map(synonymMappings.map(m => [m.term, m])).values()
  );

  return {
    expanded: Array.from(allVariations).slice(0, maxVariations),
    mappings: {
      synonyms: uniqueSynonymMappings,
      phrases: phraseResult.mappings
    }
  };
}

/**
 * Find potential synonyms for a term (query analyzer)
 * @param {string} term - Term to find synonyms for
 * @returns {Array} - List of synonyms
 */
export function findSynonyms(term) {
  if (!term) return [];
  
  const lowerTerm = term.toLowerCase();
  
  if (synonymMap[lowerTerm]) {
    return synonymMap[lowerTerm];
  }
  
  return [];
}

/**
 * Reverse lookup: find original terms for a synonym
 * @param {string} synonym - Synonym to lookup
 * @returns {Array} - Original terms that have this synonym
 */
export function findOriginalTerms(synonym) {
  if (!synonym) return [];
  
  const lowerSynonym = synonym.toLowerCase();
  const originalTerms = [];
  
  Object.entries(synonymMap).forEach(([term, synonyms]) => {
    if (synonyms.includes(lowerSynonym)) {
      originalTerms.push(term);
    }
  });
  
  return originalTerms;
}

/**
 * Get synonym coverage for a query
 * Analyzes how many terms have available synonyms
 * @param {string} text - Input text
 * @returns {Object} - Coverage statistics
 */
export function getSynonymCoverage(text) {
  if (!text) {
    return {
      totalTokens: 0,
      tokensWithSynonyms: 0,
      coverage: 0,
      details: []
    };
  }

  const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
  const details = [];
  let tokensWithSynonyms = 0;

  tokens.forEach(token => {
    const synonyms = findSynonyms(token);
    if (synonyms.length > 0) {
      tokensWithSynonyms++;
      details.push({
        term: token,
        synonymCount: synonyms.length,
        synonyms
      });
    }
  });

  return {
    totalTokens: tokens.length,
    tokensWithSynonyms,
    coverage: tokens.length > 0 ? tokensWithSynonyms / tokens.length : 0,
    details
  };
}

/**
 * Batch expand synonyms for multiple queries
 * @param {string[]} texts - Array of texts
 * @param {Object} options - Expansion options
 * @returns {Array} - Array of expansion results
 */
export function batchExpandSynonyms(texts, options = {}) {
  if (!Array.isArray(texts)) {
    return [];
  }

  return texts.map(text => expandSynonyms(text, options));
}

/**
 * Smart synonym selection based on context
 * Prefers synonyms that are more relevant to healthcare domain
 * @param {string} text - Input text
 * @param {Object} options - Options with domain preference
 * @returns {Object} - { expanded: [queries], mappings }
 */
export function expandSynonymsSmart(text, options = {}) {
  const {
    maxVariations = 5,
    domainPreference = 'healthcare'
  } = options;

  if (!text) {
    return { expanded: [], mappings: [] };
  }

  // Healthcare-preferred synonyms
  const preferredSynonyms = {
    'patient': ['patient', 'individual', 'user'],  // Prefer 'patient' in healthcare
    'doctor': ['doctor', 'physician'],      // Prefer medical terms
    'create': ['register', 'add'],          // Healthcare context
    'update': ['modify', 'edit']
  };

  const tokens = text.toLowerCase().split(/\s+/);
  const variations = new Set([text]);
  const mappings = [];

  tokens.forEach((token, index) => {
    const synonyms = preferredSynonyms[token] || synonymMap[token];
    
    if (synonyms && synonyms.length > 0) {
      mappings.push({
        term: token,
        synonyms,
        preferred: preferredSynonyms[token] ? true : false
      });

      // Use only top 2 synonyms to avoid explosion
      synonyms.slice(0, 2).forEach(synonym => {
        const newTokens = [...tokens];
        newTokens[index] = synonym;
        variations.add(newTokens.join(' '));
      });
    }
  });

  return {
    expanded: Array.from(variations).slice(0, maxVariations),
    mappings
  };
}

/**
 * Generate variations with controlled randomness
 * Useful for testing search robustness
 * @param {string} text - Input text
 * @param {number} count - Number of variations
 * @returns {string[]} - Array of variations
 */
export function generateRandomVariations(text, count = 3) {
  if (!text) return [];

  const result = expandSynonyms(text, {
    maxVariations: count,
    includeOriginal: false
  });

  return result.expanded;
}

export default {
  expandSynonyms,
  expandPhrases,
  expandComplete,
  findSynonyms,
  findOriginalTerms,
  getSynonymCoverage,
  batchExpandSynonyms,
  expandSynonymsSmart,
  generateRandomVariations
};
