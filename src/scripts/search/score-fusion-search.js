#!/usr/bin/env node

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI, {
  ssl: true,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true
});

const TESTLEAF_API_BASE = process.env.TESTLEAF_API_BASE || 'https://api.testleaf.com/ai';
const USER_EMAIL = process.env.USER_EMAIL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

/**
 * Generate embedding for search query
 */
async function generateQueryEmbedding(query) {
  try {
    const response = await axios.post(
      `${TESTLEAF_API_BASE}/embedding/text/${USER_EMAIL}`,
      {
        input: query,
        model: "text-embedding-3-small"
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(AUTH_TOKEN && { 'Authorization': `Bearer ${AUTH_TOKEN}` })
        }
      }
    );

    if (response.data.status !== 200) {
      throw new Error(`API error: ${response.data.message}`);
    }

    return {
      embedding: response.data.data[0].embedding,
      cost: response.data.cost || 0,
      tokens: response.data.usage?.total_tokens || 0
    };
  } catch (error) {
    console.error('Error generating query embedding:', error.message);
    throw error;
  }
}

/**
 * Perform vector search
 */
async function vectorSearch(collection, queryVector, limit = 50, filters = {}) {
  const pipeline = [
    {
      $vectorSearch: {
        queryVector,
        path: "embedding",
        numCandidates: Math.max(limit * 2, 100),
        limit: limit,
        index: process.env.VECTOR_INDEX_NAME,
        ...(Object.keys(filters).length > 0 && { filter: filters })
      }
    },
    {
      $addFields: {
        vectorScore: { $meta: "vectorSearchScore" }
      }
    },
    { $project: { embedding: 0 } }
  ];

  return await collection.aggregate(pipeline).toArray();
}

/**
 * Perform BM25 search
 */
async function bm25Search(collection, query, limit = 50, filters = {}) {
  const weights = {
    id: 10.0,
    title: 8.0,
    module: 5.0,
    description: 2.0,
    expectedResults: 1.5,
    steps: 1.0,
    preRequisites: 0.8
  };

  const searchFields = Object.entries(weights).map(([field, weight]) => ({
    text: {
      query: query,
      path: field,
      fuzzy: { maxEdits: 1, prefixLength: 2 },
      score: { boost: { value: weight } }
    }
  }));

  const pipeline = [
    {
      $search: {
        index: process.env.BM25_INDEX_NAME,
        compound: {
          should: searchFields,
          minimumShouldMatch: 1
        }
      }
    },
    {
      $addFields: {
        bm25Score: { $meta: "searchScore" }
      }
    },
    { $limit: limit }
  ];

  if (Object.keys(filters).length > 0) {
    pipeline.push({ $match: filters });
  }

  return await collection.aggregate(pipeline).toArray();
}

/**
 * Score Fusion Methods
 */
function applyScoreFusion(bm25Results, vectorResults, method = 'rrf', bm25Weight = 0.4, vectorWeight = 0.6) {
  const resultMap = new Map();

  // Normalize scores
  const normalizeBM25 = (score, minScore, maxScore) => {
    if (maxScore === minScore) return 1.0;
    return (score - minScore) / (maxScore - minScore);
  };

  const normalizeVector = (score, minScore, maxScore) => {
    if (maxScore === minScore) return 1.0;
    return (score - minScore) / (maxScore - minScore);
  };

  // Get min/max scores
  const bm25Scores = bm25Results.map(r => r.bm25Score);
  const vectorScores = vectorResults.map(r => r.vectorScore);
  const minBM25 = Math.min(...bm25Scores, 0);
  const maxBM25 = Math.max(...bm25Scores, 1);
  const minVector = Math.min(...vectorScores, 0);
  const maxVector = Math.max(...vectorScores, 1);

  // Process BM25 results
  bm25Results.forEach((doc, index) => {
    const id = doc._id.toString();
    const normalizedScore = normalizeBM25(doc.bm25Score, minBM25, maxBM25);
    
    resultMap.set(id, {
      ...doc,
      bm25Score: doc.bm25Score,
      bm25Normalized: normalizedScore,
      bm25Rank: index + 1,
      vectorScore: 0,
      vectorNormalized: 0,
      vectorRank: null,
      foundIn: 'bm25'
    });
  });

  // Process Vector results
  vectorResults.forEach((doc, index) => {
    const id = doc._id.toString();
    const normalizedScore = normalizeVector(doc.vectorScore, minVector, maxVector);
    
    if (resultMap.has(id)) {
      const existing = resultMap.get(id);
      existing.vectorScore = doc.vectorScore;
      existing.vectorNormalized = normalizedScore;
      existing.vectorRank = index + 1;
      existing.foundIn = 'both';
    } else {
      resultMap.set(id, {
        ...doc,
        bm25Score: 0,
        bm25Normalized: 0,
        bm25Rank: null,
        vectorScore: doc.vectorScore,
        vectorNormalized: normalizedScore,
        vectorRank: index + 1,
        foundIn: 'vector'
      });
    }
  });

  const allResults = Array.from(resultMap.values());

  // Apply fusion method
  let fusedResults = [];

  if (method === 'rrf') {
    // Reciprocal Rank Fusion
    const k = 60;
    fusedResults = allResults.map(doc => {
      const bm25RRF = doc.bm25Rank ? 1 / (k + doc.bm25Rank) : 0;
      const vectorRRF = doc.vectorRank ? 1 / (k + doc.vectorRank) : 0;
      const fusedScore = bm25RRF + vectorRRF;
      
      return { ...doc, fusedScore, method: 'RRF' };
    });
  } else if (method === 'weighted') {
    // Weighted normalized scores
    fusedResults = allResults.map(doc => {
      const fusedScore = (doc.bm25Normalized * bm25Weight) + (doc.vectorNormalized * vectorWeight);
      return { ...doc, fusedScore, method: 'Weighted' };
    });
  } else if (method === 'reciprocal') {
    // Reciprocal scoring with weights
    fusedResults = allResults.map(doc => {
      const bm25Reciprocal = doc.bm25Rank ? (1 / doc.bm25Rank) * bm25Weight : 0;
      const vectorReciprocal = doc.vectorRank ? (1 / doc.vectorRank) * vectorWeight : 0;
      const fusedScore = bm25Reciprocal + vectorReciprocal;
      
      return { ...doc, fusedScore, method: 'Reciprocal' };
    });
  }

  // Sort by fused score
  fusedResults.sort((a, b) => b.fusedScore - a.fusedScore);

  // Add ranking information
  fusedResults.forEach((doc, index) => {
    doc.newRank = index + 1;
    doc.originalRank = doc.bm25Rank || doc.vectorRank || index + 1;
    doc.rankChange = doc.originalRank - doc.newRank;
  });

  return fusedResults;
}

/**
 * Display results
 */
function displayResults(results, title) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${title}`);
  console.log(`${'='.repeat(80)}\n`);

  results.forEach((result, index) => {
    console.log(`${index + 1}. ${result.id}: ${result.title}`);
    console.log(`   📊 Fused Score: ${result.fusedScore.toFixed(4)} (${result.method})`);
    console.log(`   🔤 BM25: ${result.bm25Score.toFixed(2)} (norm: ${result.bm25Normalized.toFixed(4)})`);
    console.log(`   🧠 Vector: ${result.vectorScore.toFixed(4)} (norm: ${result.vectorNormalized.toFixed(4)})`);
    console.log(`   📦 Module: ${result.module || 'N/A'} | Found in: ${result.foundIn}`);
    
    if (result.originalRank) {
      const rankChange = result.rankChange;
      const arrow = rankChange > 0 ? '↑' : rankChange < 0 ? '↓' : '↔';
      const changeStr = rankChange !== 0 ? `${Math.abs(rankChange)} positions` : 'no change';
      console.log(`   🔄 Rank: #${result.newRank} (was #${result.originalRank}) ${arrow} ${changeStr}`);
    }
    console.log();
  });
}

/**
 * Display comparison table
 */
function displayComparison(fusedResults) {
  console.log(`\n${'='.repeat(100)}`);
  console.log('📊 SCORE FUSION COMPARISON');
  console.log(`${'='.repeat(100)}\n`);

  console.log('┌──────┬─────────────┬──────────┬──────────┬──────────┬──────────┬────────────┐');
  console.log('│ Rank │ Test Case   │ BM25     │ Vector   │ Fused    │ Found In │ Change     │');
  console.log('│      │ ID          │ Score    │ Score    │ Score    │          │            │');
  console.log('├──────┼─────────────┼──────────┼──────────┼──────────┼──────────┼────────────┤');

  fusedResults.forEach((result) => {
    const rank = result.newRank.toString().padStart(4);
    const testCaseId = (result.id || 'N/A').padEnd(11);
    const bm25Score = result.bm25Score.toFixed(2).padStart(8);
    const vectorScore = result.vectorScore.toFixed(4).padStart(8);
    const fusedScore = result.fusedScore.toFixed(4).padStart(8);
    const foundIn = result.foundIn.padEnd(8);
    
    const rankChange = result.rankChange;
    const arrow = rankChange > 0 ? '↑' : rankChange < 0 ? '↓' : '↔';
    const changeStr = `${arrow} ${rankChange !== 0 ? Math.abs(rankChange) : '-'}`.padEnd(10);

    console.log(`│ ${rank} │ ${testCaseId} │ ${bm25Score} │ ${vectorScore} │ ${fusedScore} │ ${foundIn} │ ${changeStr} │`);
  });

  console.log('└──────┴─────────────┴──────────┴──────────┴──────────┴──────────┴────────────┘');
}

/**
 * Main function
 */
async function main() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Parse command line arguments
    const query = process.argv[2] || "merge UHID";
    const method = process.argv[3] || "rrf"; // rrf, weighted, or reciprocal
    const rerankTopK = parseInt(process.argv[4]) || 50;
    const finalLimit = parseInt(process.argv[5]) || 10;
    const bm25Weight = parseFloat(process.argv[6]) || 0.4;
    const vectorWeight = 1.0 - bm25Weight;

    console.log('\n🔍 Score Fusion Reranking Search');
    console.log(`${'='.repeat(80)}`);
    console.log(`📝 Query: "${query}"`);
    console.log(`🔀 Fusion Method: ${method.toUpperCase()}`);
    console.log(`📊 Retrieve Top-K: ${rerankTopK} → Fuse → Return Top: ${finalLimit}`);
    if (method === 'weighted' || method === 'reciprocal') {
      console.log(`⚖️  Weights: BM25=${(bm25Weight * 100).toFixed(0)}%, Vector=${(vectorWeight * 100).toFixed(0)}%`);
    }
    console.log(`${'='.repeat(80)}\n`);

    const startTime = Date.now();

    // Step 1: Get embedding
    console.log(`⏳ Step 1: Generating query embedding...`);
    const embeddingData = await generateQueryEmbedding(query);
    console.log(`✅ Embedding generated (cost: $${embeddingData.cost.toFixed(6)})`);

    // Step 2: Parallel search
    console.log(`\n⏳ Step 2: Performing BM25 and Vector searches (top ${rerankTopK} each)...`);
    const searchStartTime = Date.now();
    
    const [bm25Results, vectorResults] = await Promise.all([
      bm25Search(collection, query, rerankTopK),
      vectorSearch(collection, embeddingData.embedding, rerankTopK)
    ]);

    const searchTime = Date.now() - searchStartTime;
    console.log(`✅ Retrieved ${bm25Results.length} BM25 + ${vectorResults.length} Vector results in ${searchTime}ms`);

    // Step 3: Score Fusion
    console.log(`\n⏳ Step 3: Applying ${method.toUpperCase()} score fusion...`);
    const fusionStartTime = Date.now();
    
    const fusedResults = applyScoreFusion(bm25Results, vectorResults, method, bm25Weight, vectorWeight);
    
    const fusionTime = Date.now() - fusionStartTime;
    console.log(`✅ Score fusion complete in ${fusionTime}ms`);

    const finalResults = fusedResults.slice(0, finalLimit);
    const totalTime = Date.now() - startTime;

    // Display results
    displayResults(finalResults, `TOP ${finalLimit} RESULTS AFTER ${method.toUpperCase()} FUSION`);
    displayComparison(finalResults);

    // Statistics
    const bothCount = fusedResults.filter(r => r.foundIn === 'both').length;
    const bm25OnlyCount = fusedResults.filter(r => r.foundIn === 'bm25').length;
    const vectorOnlyCount = fusedResults.filter(r => r.foundIn === 'vector').length;
    const significantChanges = fusedResults.filter(r => Math.abs(r.rankChange) >= 5).length;

    console.log(`\n📈 STATISTICS:`);
    console.log(`   • Total candidates: ${fusedResults.length}`);
    console.log(`   • Found in both: ${bothCount}`);
    console.log(`   • BM25 only: ${bm25OnlyCount}`);
    console.log(`   • Vector only: ${vectorOnlyCount}`);
    console.log(`   • Significant reorderings (±5 positions): ${significantChanges}`);
    console.log(`   • Top result: ${finalResults[0]?.id} (found in: ${finalResults[0]?.foundIn})`);

    console.log(`\n⏱️  TIMING BREAKDOWN:`);
    console.log(`   • Embedding: ${Date.now() - startTime - searchTime - fusionTime}ms`);
    console.log(`   • Search (BM25 + Vector): ${searchTime}ms`);
    console.log(`   • Score Fusion: ${fusionTime}ms`);
    console.log(`   • Total Time: ${totalTime}ms`);
    
    console.log(`\n💰 COST:`);
    console.log(`   • Embedding Cost: $${embeddingData.cost.toFixed(6)}`);
    console.log(`   • Tokens Used: ${embeddingData.tokens}`);

    console.log(`\n✅ Search complete!\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { applyScoreFusion, vectorSearch, bm25Search };
