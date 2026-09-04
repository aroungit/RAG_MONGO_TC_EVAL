import { MongoClient } from "mongodb";
import dns from "dns";
import dotenv from "dotenv";

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const client = new MongoClient(process.env.MONGODB_URI, {
  ssl: true,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true,
});

/**
 * Perform BM25 keyword search with field-level weighting
 */
async function bm25Search(query, options = {}) {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    const {
      limit = 10,
      filters = {},
      showScoreBreakdown = true,
      // Field weights - higher number = more important
      fieldWeights = {
        id: 10.0,              // Exact ID match is most important
        title: 5.0,            // Title is very important
        module: 3.0,           // Module is important for categorization
        description: 2.0,      // Description is moderately important
        expectedResults: 1.5,  // Expected results matter
        steps: 1.0,            // Steps have base importance
        preRequisites: 0.8     // Prerequisites less important
      }
    } = options;

    console.log(`\n🔤 BM25 KEYWORD SEARCH WITH FIELD WEIGHTS: "${query}"`);
    console.log(`⚙️  Configuration:`);
    console.log(`   📄 Limit: ${limit}`);
    console.log(`   � Field Weights:`);
    Object.entries(fieldWeights).forEach(([field, weight]) => {
      console.log(`      ${field}: ${weight}x`);
    });
    console.log(``);

    const startTime = Date.now();

    // Build compound search with weighted fields
    const searchFields = Object.entries(fieldWeights).map(([field, weight]) => ({
      query: query,
      path: field,
      score: { boost: { value: weight } }
    }));

    // Build BM25 search pipeline with field boosting
    const pipeline = [
      {
        $search: {
          index: process.env.BM25_INDEX_NAME,
          compound: {
            should: searchFields.map(field => ({
              text: {
                query: field.query,
                path: field.path,
                fuzzy: {
                  maxEdits: 1,
                  prefixLength: 2
                },
                score: field.score
              }
            })),
            minimumShouldMatch: 1
          }
        }
      },
      {
        $addFields: {
          bm25Score: { $meta: "searchScore" },
          searchHighlights: { $meta: "searchHighlights" }
        }
      }
    ];

    // Apply filters if provided
    if (Object.keys(filters).length > 0) {
      const matchConditions = {};
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== '') {
          matchConditions[key] = value;
        }
      });

      if (Object.keys(matchConditions).length > 0) {
        console.log(`🔍 Applying filters:`, matchConditions);
        pipeline.push({ $match: matchConditions });
      }
    }

    // Add projection and limit
    pipeline.push(
      {
        $project: {
          id: 1,
          module: 1,
          title: 1,
          description: 1,
          steps: 1,
          expectedResults: 1,
          preRequisites: 1,
          priority: 1,
          risk: 1,
          automationManual: 1,
          bm25Score: 1,
          searchHighlights: 1
        }
      },
      { $limit: parseInt(limit) }
    );

    console.log(`🔍 Executing search...`);
    const results = await collection.aggregate(pipeline).toArray();
    const searchTime = Date.now() - startTime;

    // Analyze which fields contributed to the score
    const fieldContributions = analyzeFieldContributions(results, query, fieldWeights);

    // Display Results
    console.log(`📊 BM25 SEARCH RESULTS (Top ${results.length}):\n`);
    
    results.forEach((result, index) => {
      console.log(`${index + 1}. ${result.id || 'NO_ID'}: ${result.title || 'No title'}`);
      console.log(`   Module: ${result.module || 'N/A'}`);
      console.log(`   Priority: ${result.priority || 'N/A'} | Risk: ${result.risk || 'N/A'} | Type: ${result.automationManual || 'N/A'}`);
      
      if (showScoreBreakdown) {
        console.log(`   📊 BM25 Score: ${result.bm25Score.toFixed(4)}`);
        
        // Show which fields matched
        const matchedFields = getMatchedFields(result, query);
        if (matchedFields.length > 0) {
          console.log(`   🎯 Matched in: ${matchedFields.join(', ')}`);
        }

        // Show highlights if available
        if (result.searchHighlights && result.searchHighlights.length > 0) {
          console.log(`   💡 Highlights:`);
          result.searchHighlights.slice(0, 2).forEach(highlight => {
            console.log(`      ${highlight.path}: "${highlight.texts.map(t => t.value).join('...')}"`);
          });
        }
      }

      if (result.description) {
        const desc = result.description.substring(0, 100);
        console.log(`   Description: ${desc}${result.description.length > 100 ? '...' : ''}`);
      }
      console.log(``);
    });

    // Summary Statistics
    const avgScore = results.length > 0 
      ? results.reduce((sum, r) => sum + r.bm25Score, 0) / results.length 
      : 0;

    console.log(`📈 SUMMARY:`);
    console.log(`   Total Results: ${results.length}`);
    console.log(`   Search Time: ${searchTime}ms`);
    console.log(`   Average Score: ${avgScore.toFixed(4)}`);
    console.log(`   Max Score: ${results.length > 0 ? results[0].bm25Score.toFixed(4) : '0'}`);
    
    if (fieldContributions.length > 0) {
      console.log(`   📊 Top Contributing Fields:`);
      fieldContributions.slice(0, 3).forEach(({ field, count, avgWeight }) => {
        console.log(`      ${field}: ${count} matches (avg weight: ${avgWeight}x)`);
      });
    }
    console.log(``);

    return results;

  } catch (error) {
    console.error('❌ BM25 search error:', error.message);
    if (error.message.includes('index')) {
      console.error(`💡 Make sure the BM25 index "${process.env.BM25_INDEX_NAME}" is created in MongoDB Atlas`);
      console.error(`   See: src/config/testcases-bm25-index.json`);
    }
    throw error;
  } finally {
    await client.close();
  }
}

/**
 * Analyze which fields contributed to matches
 */
function analyzeFieldContributions(results, query, fieldWeights) {
  const contributions = {};
  const queryTerms = query.toLowerCase().split(/\s+/);

  results.forEach(result => {
    Object.entries(fieldWeights).forEach(([field, weight]) => {
      const fieldValue = result[field];
      if (fieldValue && typeof fieldValue === 'string') {
        const fieldLower = fieldValue.toLowerCase();
        const matches = queryTerms.filter(term => fieldLower.includes(term)).length;
        
        if (matches > 0) {
          if (!contributions[field]) {
            contributions[field] = { count: 0, totalWeight: 0 };
          }
          contributions[field].count += matches;
          contributions[field].totalWeight += weight;
        }
      }
    });
  });

  return Object.entries(contributions)
    .map(([field, { count, totalWeight }]) => ({
      field,
      count,
      avgWeight: totalWeight / count
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get list of fields that matched the query
 */
function getMatchedFields(result, query) {
  const matched = [];
  const queryTerms = query.toLowerCase().split(/\s+/);
  
  const searchableFields = ['id', 'title', 'module', 'description', 'steps', 'expectedResults', 'preRequisites'];
  
  searchableFields.forEach(field => {
    const value = result[field];
    if (value && typeof value === 'string') {
      const valueLower = value.toLowerCase();
      if (queryTerms.some(term => valueLower.includes(term))) {
        matched.push(field);
      }
    }
  });

  return matched;
}

/**
 * Get recommended field weights based on query type
 */
function getRecommendedWeights(query) {
  // ID pattern (TC_123, US-456)
  if (/^[A-Z]{2,5}[_-]\d+$/i.test(query.trim())) {
    return {
      id: 20.0,
      title: 2.0,
      module: 1.0,
      description: 0.5,
      expectedResults: 0.5,
      steps: 0.3,
      preRequisites: 0.2
    };
  }

  // Single word or short query (2-3 words)
  const wordCount = query.trim().split(/\s+/).length;
  if (wordCount <= 3) {
    return {
      id: 10.0,
      title: 8.0,
      module: 5.0,
      description: 2.0,
      expectedResults: 1.5,
      steps: 1.0,
      preRequisites: 0.8
    };
  }

  // Long natural language query (5+ words)
  if (wordCount >= 5) {
    return {
      id: 5.0,
      title: 4.0,
      description: 3.0,
      expectedResults: 2.5,
      steps: 2.0,
      module: 1.5,
      preRequisites: 1.0
    };
  }

  // Default balanced weights
  return {
    id: 10.0,
    title: 5.0,
    module: 3.0,
    description: 2.0,
    expectedResults: 1.5,
    steps: 1.0,
    preRequisites: 0.8
  };
}

// Command line interface
async function main() {
  const query = process.argv[2] || "merge UHID";
  const limit = parseInt(process.argv[3]) || 5;

  // Auto-detect optimal weights or use manual
  const useAutoWeights = !process.argv.includes('--manual-weights');
  const fieldWeights = useAutoWeights 
    ? getRecommendedWeights(query)
    : undefined; // Use defaults

  const options = {
    limit,
    showScoreBreakdown: true,
    ...(fieldWeights && { fieldWeights })
  };

  // Parse filters from command line (e.g., --module=Registration --priority=P1)
  const filters = {};
  process.argv.slice(4).forEach(arg => {
    if (arg.startsWith('--') && arg.includes('=')) {
      const [key, value] = arg.substring(2).split('=');
      if (key !== 'manual-weights') {
        filters[key] = value;
      }
    }
  });

  if (Object.keys(filters).length > 0) {
    options.filters = filters;
  }

  try {
    await bm25Search(query, options);
  } catch (error) {
    console.error('❌ Search failed:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { bm25Search, getRecommendedWeights };
