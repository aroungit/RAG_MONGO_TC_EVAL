/**
 * Query Preprocessing CLI Test Tool
 * Tests the complete preprocessing pipeline
 */

import { preprocessQuery, preprocessQueryWithLogs, analyzeQuery } from './queryPreprocessor.js';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

/**
 * Format and display preprocessing results
 */
function displayResults(result) {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.bright}Query Preprocessing Results${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(80)}${colors.reset}\n`);

  // Original Query
  console.log(`${colors.bright}📝 Original Query:${colors.reset}`);
  console.log(`   "${colors.yellow}${result.original}${colors.reset}"\n`);

  // Step 1: Normalization
  console.log(`${colors.bright}1️⃣  Normalization:${colors.reset}`);
  console.log(`   "${colors.green}${result.normalized}${colors.reset}"`);
  if (result.metadata.testCaseIds && result.metadata.testCaseIds.length > 0) {
    console.log(`   ${colors.dim}Test Case IDs found: ${result.metadata.testCaseIds.map(tc => tc.normalized).join(', ')}${colors.reset}`);
  }
  console.log();

  // Step 2: Abbreviation Expansion
  console.log(`${colors.bright}2️⃣  Abbreviation Expansion:${colors.reset}`);
  console.log(`   "${colors.green}${result.abbreviationExpanded}${colors.reset}"`);
  
  if (result.metadata.abbreviationMappings.length > 0) {
    console.log(`   ${colors.dim}Expanded abbreviations:${colors.reset}`);
    result.metadata.abbreviationMappings.forEach(mapping => {
      console.log(`      ${colors.cyan}${mapping.abbreviation}${colors.reset} → ${colors.green}${mapping.expansion}${colors.reset}`);
    });
  } else {
    console.log(`   ${colors.dim}No abbreviations found${colors.reset}`);
  }
  console.log();

  // Step 3: Synonym Expansion
  console.log(`${colors.bright}3️⃣  Synonym Expansion:${colors.reset}`);
  console.log(`   ${colors.dim}Generated ${result.synonymExpanded.length} query variations:${colors.reset}\n`);
  
  result.synonymExpanded.forEach((query, index) => {
    console.log(`   ${colors.magenta}[${index + 1}]${colors.reset} "${colors.green}${query}${colors.reset}"`);
  });

  if (result.metadata.synonymMappings.length > 0) {
    console.log(`\n   ${colors.dim}Synonym mappings:${colors.reset}`);
    result.metadata.synonymMappings.forEach(mapping => {
      console.log(`      ${colors.cyan}${mapping.term}${colors.reset} → [${mapping.synonyms.slice(0, 3).join(', ')}${mapping.synonyms.length > 3 ? '...' : ''}]`);
    });
  }

  // Metadata
  console.log(`\n${colors.bright}📊 Metadata:${colors.reset}`);
  console.log(`   Tokens: ${result.metadata.tokens.join(', ')}`);
  console.log(`   Processing Time: ${colors.yellow}${result.metadata.processingTime}ms${colors.reset}`);
  console.log(`   Steps Applied: ${Object.entries(result.metadata.steps)
    .filter(([, enabled]) => enabled)
    .map(([step]) => step)
    .join(', ')}`);

  console.log(`\n${colors.cyan}${'='.repeat(80)}${colors.reset}\n`);
}

/**
 * Display detailed logs
 */
function displayLogs(result) {
  console.log(`\n${colors.bright}${colors.blue}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.bright}Detailed Processing Logs${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}\n`);

  result.logs.forEach((log, index) => {
    console.log(`${colors.bright}Step ${index}: ${log.step.toUpperCase()}${colors.reset}`);
    
    if (log.step === 'start') {
      console.log(`   Query: "${colors.yellow}${log.query}${colors.reset}"`);
    } else if (log.step === 'synonyms') {
      console.log(`   Queries generated: ${log.queries.length}`);
      log.queries.forEach((q, i) => {
        console.log(`      [${i + 1}] "${colors.green}${q}${colors.reset}"`);
      });
      console.log(`   Time: ${colors.yellow}${log.time}ms${colors.reset}`);
    } else {
      console.log(`   Query: "${colors.green}${log.query}${colors.reset}"`);
      console.log(`   Time: ${colors.yellow}${log.time}ms${colors.reset}`);
      console.log(`   Changes: ${log.changes ? colors.green + 'Yes' : colors.dim + 'No'}${colors.reset}`);
      
      if (log.mappings && log.mappings.length > 0) {
        console.log(`   Mappings: ${log.mappings.length}`);
      }
    }
    console.log();
  });

  console.log(`${colors.bright}Total Time: ${colors.yellow}${result.totalTime}ms${colors.reset}\n`);
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}\n`);
}

/**
 * Display query analysis
 */
function displayAnalysis(analysis) {
  console.log(`\n${colors.bright}${colors.magenta}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.bright}Query Analysis${colors.reset}`);
  console.log(`${colors.magenta}${'='.repeat(80)}${colors.reset}\n`);

  console.log(`${colors.bright}Original:${colors.reset} "${colors.yellow}${analysis.original}${colors.reset}"`);
  console.log(`${colors.bright}Normalized:${colors.reset} "${colors.green}${analysis.normalized}${colors.reset}"\n`);

  console.log(`${colors.bright}Analysis Results:${colors.reset}`);
  console.log(`   Test Case IDs: ${analysis.analysis.hasTestCaseIds ? colors.green + 'Yes' : colors.dim + 'No'}${colors.reset}`);
  if (analysis.analysis.testCaseIds.length > 0) {
    console.log(`      ${analysis.analysis.testCaseIds.map(tc => tc.normalized).join(', ')}`);
  }

  console.log(`   Abbreviations: ${analysis.analysis.hasAbbreviations ? colors.green + 'Yes' : colors.dim + 'No'}${colors.reset}`);
  if (analysis.analysis.abbreviations.length > 0) {
    analysis.analysis.abbreviations.forEach(abbr => {
      console.log(`      ${colors.cyan}${abbr.abbreviation}${colors.reset} → ${abbr.expansion}`);
    });
  }

  console.log(`   Synonym Opportunities: ${analysis.analysis.hasSynonymOpportunities ? colors.green + 'Yes' : colors.dim + 'No'}${colors.reset}`);
  if (analysis.analysis.synonymOpportunities.length > 0) {
    analysis.analysis.synonymOpportunities.forEach(syn => {
      console.log(`      ${colors.cyan}${syn.term}${colors.reset} → [${syn.synonyms.slice(0, 3).join(', ')}${syn.synonyms.length > 3 ? '...' : ''}]`);
    });
  }

  console.log(`   Estimated Variations: ${colors.yellow}${analysis.analysis.estimatedVariations}${colors.reset}`);
  console.log(`   Token Count: ${analysis.analysis.tokenCount}`);
  console.log(`   Tokens: ${analysis.analysis.tokens.join(', ')}`);

  console.log(`\n${colors.magenta}${'='.repeat(80)}${colors.reset}\n`);
}

/**
 * Run test examples
 */
function runExamples() {
  console.log(`\n${colors.bright}${colors.green}Running Example Test Cases${colors.reset}\n`);

  const examples = [
    "UHID patient login issue OTP not working",
    "TC_027 merge UHID records",
    "doctor appointment booking IP admission",
    "password reset OTP verification",
    "ER patient registration BP monitoring"
  ];

  examples.forEach((query, index) => {
    console.log(`${colors.bright}Example ${index + 1}:${colors.reset} "${colors.yellow}${query}${colors.reset}"`);
    
    const result = preprocessQuery(query, {
      maxSynonymVariations: 3
    });

    console.log(`   → Original: "${result.original}"`);
    console.log(`   → Normalized: "${result.normalized}"`);
    console.log(`   → Abbreviations: "${result.abbreviationExpanded}"`);
    console.log(`   → Variations: ${result.synonymExpanded.length}`);
    console.log(`   → Time: ${result.metadata.processingTime}ms\n`);
  });
}

/**
 * Main CLI function
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`\n${colors.bright}Query Preprocessing Test Tool${colors.reset}\n`);
    console.log('Usage:');
    console.log(`  ${colors.cyan}node test-preprocessing.js "your query here"${colors.reset}           - Run preprocessing`);
    console.log(`  ${colors.cyan}node test-preprocessing.js --logs "your query"${colors.reset}        - Show detailed logs`);
    console.log(`  ${colors.cyan}node test-preprocessing.js --analyze "your query"${colors.reset}     - Analyze query`);
    console.log(`  ${colors.cyan}node test-preprocessing.js --examples${colors.reset}                  - Run example queries\n`);
    
    console.log('Examples:');
    console.log(`  ${colors.dim}node test-preprocessing.js "UHID patient login issue OTP"${colors.reset}`);
    console.log(`  ${colors.dim}node test-preprocessing.js --logs "TC_027 merge records"${colors.reset}`);
    console.log(`  ${colors.dim}node test-preprocessing.js --analyze "doctor appointment"${colors.reset}\n`);
    
    return;
  }

  const mode = args[0];

  if (mode === '--examples') {
    runExamples();
    return;
  }

  const query = mode.startsWith('--') ? args.slice(1).join(' ') : args.join(' ');

  if (!query) {
    console.error(`${colors.red}Error: No query provided${colors.reset}`);
    return;
  }

  try {
    switch (mode) {
      case '--logs':
        const logResult = preprocessQueryWithLogs(query);
        displayLogs(logResult);
        break;

      case '--analyze':
        const analysis = analyzeQuery(query);
        displayAnalysis(analysis);
        break;

      default:
        const result = preprocessQuery(query, {
          maxSynonymVariations: 5,
          enableAbbreviations: true,
          enableSynonyms: true
        });
        displayResults(result);
        break;
    }
  } catch (error) {
    console.error(`${colors.red}Error:${colors.reset}`, error.message);
    console.error(error.stack);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { displayResults, displayLogs, displayAnalysis, runExamples };
