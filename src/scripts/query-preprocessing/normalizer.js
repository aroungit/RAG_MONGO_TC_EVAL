/**
 * Text Normalizer
 * Handles query normalization: lowercase, trim, special character removal
 */

/**
 * Normalize query text
 * @param {string} text - Raw input text
 * @param {Object} options - Normalization options
 * @returns {string} - Normalized text
 */
export function normalize(text, options = {}) {
  const {
    lowercase = true,
    trimWhitespace = true,
    removeExtraSpaces = true,
    removeSpecialChars = true,
    preserveHyphens = true,
    preserveUnderscores = false,
    preserveNumbers = true
  } = options;

  if (!text || typeof text !== 'string') {
    return '';
  }

  let normalized = text;

  // Trim whitespace
  if (trimWhitespace) {
    normalized = normalized.trim();
  }

  // Remove extra spaces (multiple spaces → single space)
  if (removeExtraSpaces) {
    normalized = normalized.replace(/\s+/g, ' ');
  }

  // Convert to lowercase
  if (lowercase) {
    normalized = normalized.toLowerCase();
  }

  // Remove special characters
  if (removeSpecialChars) {
    let pattern = '[^a-zA-Z0-9\\s';
    if (preserveHyphens) pattern += '-';
    if (preserveUnderscores) pattern += '_';
    pattern += ']';
    
    const regex = new RegExp(pattern, 'g');
    normalized = normalized.replace(regex, ' ');
    
    // Clean up extra spaces created by removal
    normalized = normalized.replace(/\s+/g, ' ').trim();
  }

  // Handle numbers
  if (!preserveNumbers) {
    normalized = normalized.replace(/\d+/g, '');
    normalized = normalized.replace(/\s+/g, ' ').trim();
  }

  return normalized;
}

/**
 * Tokenize text into words
 * @param {string} text - Input text
 * @returns {string[]} - Array of tokens
 */
export function tokenize(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Split on whitespace and filter empty strings
  return text
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(token => token.length > 0);
}

/**
 * Remove punctuation from text
 * @param {string} text - Input text
 * @param {string[]} preserve - Characters to preserve
 * @returns {string} - Text without punctuation
 */
export function removePunctuation(text, preserve = ['-', '_']) {
  if (!text) return '';

  let pattern = '[^a-zA-Z0-9\\s';
  preserve.forEach(char => {
    pattern += '\\' + char;
  });
  pattern += ']';

  const regex = new RegExp(pattern, 'g');
  return text.replace(regex, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize spacing and formatting
 * @param {string} text - Input text
 * @returns {string} - Cleaned text
 */
export function normalizeSpacing(text) {
  if (!text) return '';

  return text
    .replace(/\s+/g, ' ')  // Multiple spaces → single space
    .replace(/\n+/g, ' ')  // Newlines → space
    .replace(/\t+/g, ' ')  // Tabs → space
    .trim();
}

/**
 * Handle special test case formats (e.g., TC_027, TC-027)
 * @param {string} text - Input text
 * @returns {Object} - { normalized, testCaseIds }
 */
export function extractTestCaseIds(text) {
  if (!text) return { normalized: '', testCaseIds: [] };

  const testCasePattern = /\b(tc)[_\s-]?(\d+)\b/gi;
  const testCaseIds = [];
  
  let match;
  while ((match = testCasePattern.exec(text)) !== null) {
    testCaseIds.push({
      original: match[0],
      normalized: `TC_${match[2]}`
    });
  }

  // Normalize test case IDs in text
  const normalized = text.replace(testCasePattern, (match, prefix, number) => {
    return `TC_${number}`;
  });

  return { normalized, testCaseIds };
}

/**
 * Complete normalization pipeline
 * @param {string} text - Raw input text
 * @param {Object} options - Normalization options
 * @returns {Object} - { normalized, metadata }
 */
export function normalizeComplete(text, options = {}) {
  if (!text) {
    return {
      normalized: '',
      metadata: {
        original: '',
        testCaseIds: [],
        tokens: []
      }
    };
  }

  // Extract test case IDs first
  const { normalized: withNormalizedIds, testCaseIds } = extractTestCaseIds(text);

  // Apply standard normalization
  const normalized = normalize(withNormalizedIds, options);

  // Tokenize
  const tokens = tokenize(normalized);

  return {
    normalized,
    metadata: {
      original: text,
      testCaseIds,
      tokens,
      length: tokens.length
    }
  };
}

export default {
  normalize,
  tokenize,
  removePunctuation,
  normalizeSpacing,
  extractTestCaseIds,
  normalizeComplete
};
