import { MongoClient } from "mongodb";
import dns from "dns";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// Fix DNS resolution issue on macOS by using Google's DNS servers
dns.setServers(['8.8.8.8', '8.8.4.4']);

const client = new MongoClient(process.env.MONGODB_URI);

// Testleaf API configuration
const TESTLEAF_API_BASE = process.env.TESTLEAF_API_BASE || 'https://api.testleaf.ai/v1';
const USER_EMAIL = process.env.USER_EMAIL;
const AUTH_TOKEN = process.env.AUTH_TOKEN; // Add your auth token if needed

async function main() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Take query from command line args, default if missing
    const query = process.argv[2] || "login tests";

    console.log(`🔎 Searching for: "${query}"`);
    console.log(`🔄 Getting embedding from testleaf API...`);

    // Generate embedding using testleaf API
    const embeddingResponse = await axios.post(
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

    if (embeddingResponse.data.status !== 200) {
      throw new Error(`Testleaf API error: ${embeddingResponse.data.message}`);
    }

    const queryVector = embeddingResponse.data.data[0].embedding;
    console.log(`✅ Embedding generated! Cost: $${embeddingResponse.data.cost || 0}, Tokens: ${embeddingResponse.data.usage?.total_tokens || 0}`);

    // Vector search pipeline
    const pipeline = [
      {
        $vectorSearch: {
          queryVector,
          path: "embedding",
          numCandidates: 100,
          limit: 5,
          index: process.env.VECTOR_INDEX_NAME  // must match Atlas Search index name
        }
      },
      {
        $project: {
          testcase_id: 1,
          title: 1,
          description: 1,
          steps: 1,
          expectedResult: 1,
          score: { $meta: "vectorSearchScore" }
        }
      }
    ];

    const results = await collection.aggregate(pipeline).toArray();

    console.log("\n✅ Search results:");
    console.table(results);
    
    console.log(`\n💰 Total Embedding Cost: $${embeddingResponse.data.cost || 0}`);
    console.log(`📈 Model Used: ${embeddingResponse.data.model}`);
    console.log(`🔢 Results Found: ${results.length}`);

  } catch (err) {
    if (err.response) {
      console.error("❌ Testleaf API Error:", err.response.status, err.response.data);
    } else {
      console.error("❌ Error:", err.message);
    }
  } finally {
    await client.close();
  }
}

main();
