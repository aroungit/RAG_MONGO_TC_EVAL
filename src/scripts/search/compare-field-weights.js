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
 * Test different field weight configurations
 */
async function compareFieldWeights(query, weightConfigs) {
  await client.connect();
  const db = client.db(process.env.DB_NAME);
  const collection = db.collection(process.env.COLLECTION_NAME);

  console.log(`\n🧪 FIELD WEIGHT COMPARISON TEST`);
  console.log(`Query: "${query}"`);
  console.log(`Testing ${weightConfigs.length} different weight configurations\n`);

  const results = [];

  for (const [index, config] of weightConfigs.entries()) {
    console.log(`\n📊 Configuration ${index + 1}: ${config.name}`);
    console.log(`Weights:`, config.weights);

    const searchFields = Object.entries(config.weights).map(([field, weight]) => ({
      path: field,
      score: { boost: { value: weight } }
    }));

    const pipeline = [
      {
        $search: {
          index: process.env.BM25_INDEX_NAME,
          compound: {
            should: [
              {
                text: {
                  query: query,
                  path: searchFields,
                  fuzzy: { maxEdits: 1, prefixLength: 2 }
                }
              },
              {
                phrase: {
                  query: query,
                  path: Object.keys(config.weights),
                  score: { boost: { value: 2.0 } }
                }
              }
            ],
            minimumShouldMatch: 1
          }
        }
      },
      {
        $addFields: {
          score: { $meta: "searchScore" }
        }
      },
      {
        $project: {
          id: 1,
          title: 1,
          module: 1,
          description: 1,
          score: 1
        }
      },
      { $limit: 5 }
    ];

    const searchResults = await collection.aggregate(pipeline).toArray();

    console.log(`Top 5 Results:`);
    searchResults.forEach((r, i) => {
      console.log(`   ${i + 1}. [${r.score.toFixed(2)}] ${r.id}: ${r.title}`);
    });

    results.push({
      config: config.name,
      weights: config.weights,
      topResults: searchResults.map(r => ({
        id: r.id,
        title: r.title,
        score: r.score
      }))
    });
  }

  await client.close();

  // Print comparison summary
  console.log(`\n\n📈 COMPARISON SUMMARY\n`);
  console.log(`Query: "${query}"\n`);

  results.forEach((result, index) => {
    console.log(`${index + 1}. ${result.config}`);
    if (result.topResults.length > 0) {
      console.log(`   Top Result: ${result.topResults[0].id} (score: ${result.topResults[0].score.toFixed(2)})`);
      const avgScore = result.topResults.reduce((sum, r) => sum + r.score, 0) / result.topResults.length;
      console.log(`   Avg Top-5 Score: ${avgScore.toFixed(2)}`);
    } else {
      console.log(`   No results found`);
    }
    console.log(``);
  });

  return results;
}

// Predefined weight configurations to test
const WEIGHT_CONFIGS = [
  {
    name: "Balanced (Default)",
    weights: {
      id: 10.0,
      title: 5.0,
      module: 3.0,
      description: 2.0,
      expectedResults: 1.5,
      steps: 1.0,
      preRequisites: 0.8
    }
  },
  {
    name: "Title Heavy",
    weights: {
      id: 12.0,
      title: 10.0,
      module: 4.0,
      description: 1.5,
      expectedResults: 1.0,
      steps: 0.8,
      preRequisites: 0.5
    }
  },
  {
    name: "ID Focused",
    weights: {
      id: 20.0,
      title: 3.0,
      module: 2.0,
      description: 1.0,
      expectedResults: 0.8,
      steps: 0.5,
      preRequisites: 0.3
    }
  },
  {
    name: "Description Heavy (Natural Language)",
    weights: {
      id: 5.0,
      title: 4.0,
      module: 2.0,
      description: 5.0,
      expectedResults: 3.0,
      steps: 2.5,
      preRequisites: 1.5
    }
  },
  {
    name: "Equal Weights",
    weights: {
      id: 1.0,
      title: 1.0,
      module: 1.0,
      description: 1.0,
      expectedResults: 1.0,
      steps: 1.0,
      preRequisites: 1.0
    }
  }
];

// CLI
async function main() {
  const query = process.argv[2] || "merge UHID";
  
  try {
    await compareFieldWeights(query, WEIGHT_CONFIGS);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { compareFieldWeights, WEIGHT_CONFIGS };
