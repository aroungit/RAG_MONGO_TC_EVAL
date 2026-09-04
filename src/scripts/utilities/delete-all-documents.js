import { MongoClient } from "mongodb";
import dns from "dns";
import dotenv from "dotenv";

dotenv.config();

// Fix DNS resolution issue on macOS by using Google's DNS servers
dns.setServers(['8.8.8.8', '8.8.4.4']);

const client = new MongoClient(process.env.MONGODB_URI);

async function deleteAllDocs() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    const result = await collection.deleteMany({});
    console.log(`🗑️ Deleted ${result.deletedCount} documents from ${process.env.COLLECTION_NAME}`);
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await client.close();
  }
}

deleteAllDocs();
