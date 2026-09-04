/**
 * Mistral AI Embedding Utility
 * 
 * Provides functions to generate embeddings using Mistral AI's embedding model.
 * Supports both single text and batch processing.
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_EMBEDDING_MODEL = process.env.MISTRAL_EMBEDDING_MODEL || 'mistral-embed';
const MISTRAL_API_BASE = 'https://api.mistral.ai/v1';

// Rate limiting configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Validate Mistral API configuration
 */
function validateConfig() {
  if (!MISTRAL_API_KEY) {
    throw new Error('MISTRAL_API_KEY is required. Please set it in your .env file');
  }
}

/**
 * Generate embedding for a single text using Mistral AI
 * 
 * @param {string} text - Text to generate embedding for
 * @param {number} retryCount - Current retry attempt
 * @returns {Promise<Object>} Object containing embedding array and metadata
 */
export async function generateEmbedding(text, retryCount = 0) {
  validateConfig();

  try {
    const response = await axios.post(
      `${MISTRAL_API_BASE}/embeddings`,
      {
        model: MISTRAL_EMBEDDING_MODEL,
        input: [text]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MISTRAL_API_KEY}`
        },
        timeout: 30000
      }
    );

    if (!response.data || !response.data.data || !response.data.data[0]) {
      throw new Error('Invalid response from Mistral API');
    }

    return {
      embedding: response.data.data[0].embedding,
      model: response.data.model,
      usage: response.data.usage,
      metadata: {
        model: response.data.model,
        tokens: response.data.usage?.total_tokens || 0,
        apiSource: 'mistral',
        createdAt: new Date()
      }
    };

  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const waitTime = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(`⚠️  Retrying in ${waitTime}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return generateEmbedding(text, retryCount + 1);
    }

    if (error.response) {
      throw new Error(`Mistral API error: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
    }
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
}

/**
 * Generate embeddings for multiple texts using Mistral AI (batch processing)
 * 
 * @param {string[]} texts - Array of texts to generate embeddings for
 * @param {number} retryCount - Current retry attempt
 * @returns {Promise<Object>} Object containing embeddings array and metadata
 */
export async function generateBatchEmbeddings(texts, retryCount = 0) {
  validateConfig();

  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('texts must be a non-empty array');
  }

  try {
    const response = await axios.post(
      `${MISTRAL_API_BASE}/embeddings`,
      {
        model: MISTRAL_EMBEDDING_MODEL,
        input: texts
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MISTRAL_API_KEY}`
        },
        timeout: 60000 // Longer timeout for batch requests
      }
    );

    if (!response.data || !response.data.data) {
      throw new Error('Invalid response from Mistral API');
    }

    const embeddings = response.data.data.map(item => item.embedding);
    const usage = response.data.usage;

    return {
      embeddings: embeddings,
      model: response.data.model,
      usage: usage,
      batchSize: texts.length,
      metadata: {
        model: response.data.model,
        totalTokens: usage?.total_tokens || 0,
        tokensPerInput: usage?.total_tokens ? Math.round(usage.total_tokens / texts.length) : 0,
        apiSource: 'mistral-batch',
        batchSize: texts.length,
        createdAt: new Date()
      }
    };

  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const waitTime = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(`⚠️  Batch retry in ${waitTime}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return generateBatchEmbeddings(texts, retryCount + 1);
    }

    if (error.response) {
      throw new Error(`Mistral API error: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
    }
    throw new Error(`Failed to generate batch embeddings: ${error.message}`);
  }
}

/**
 * Process large datasets with chunking (for very large batches)
 * 
 * @param {string[]} texts - Array of texts to process
 * @param {number} chunkSize - Size of each chunk (default: 100)
 * @param {function} onProgress - Progress callback (optional)
 * @returns {Promise<Array>} Array of embedding results with metadata
 */
export async function generateEmbeddingsChunked(texts, chunkSize = 100, onProgress = null) {
  validateConfig();

  const results = [];
  const totalChunks = Math.ceil(texts.length / chunkSize);

  console.log(`📦 Processing ${texts.length} texts in ${totalChunks} chunks of ${chunkSize}`);

  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    const chunkNumber = Math.floor(i / chunkSize) + 1;

    try {
      console.log(`🔄 Processing chunk ${chunkNumber}/${totalChunks}...`);
      const result = await generateBatchEmbeddings(chunk);
      
      // Map embeddings back with individual metadata
      const chunkResults = result.embeddings.map((embedding, index) => ({
        text: chunk[index],
        embedding: embedding,
        metadata: {
          ...result.metadata,
          chunkNumber: chunkNumber,
          indexInChunk: index,
          globalIndex: i + index
        }
      }));

      results.push(...chunkResults);

      if (onProgress) {
        onProgress({
          processed: results.length,
          total: texts.length,
          chunkNumber: chunkNumber,
          totalChunks: totalChunks,
          percentage: (results.length / texts.length * 100).toFixed(1)
        });
      }

      // Rate limiting: wait between chunks
      if (i + chunkSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } catch (error) {
      console.error(`❌ Failed to process chunk ${chunkNumber}:`, error.message);
      // Add error placeholders for failed chunk
      for (let j = 0; j < chunk.length; j++) {
        results.push({
          text: chunk[j],
          embedding: null,
          error: error.message,
          metadata: {
            chunkNumber: chunkNumber,
            indexInChunk: j,
            globalIndex: i + j,
            failed: true
          }
        });
      }
    }
  }

  const successCount = results.filter(r => !r.error).length;
  const failCount = results.filter(r => r.error).length;

  console.log(`✅ Completed: ${successCount}/${texts.length} successful, ${failCount} failed`);

  return results;
}

/**
 * Get embedding dimension for the configured model
 * Mistral embed model produces 1024-dimensional embeddings
 * 
 * @returns {number} Embedding dimension
 */
export function getEmbeddingDimension() {
  return 1024; // Mistral embed model dimension
}

/**
 * Test the Mistral API connection
 * 
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testConnection() {
  try {
    validateConfig();
    const testResult = await generateEmbedding('test');
    console.log('✅ Mistral AI API connection successful');
    console.log(`   Model: ${testResult.model}`);
    console.log(`   Embedding dimension: ${testResult.embedding.length}`);
    return true;
  } catch (error) {
    console.error('❌ Mistral AI API connection failed:', error.message);
    return false;
  }
}

export default {
  generateEmbedding,
  generateBatchEmbeddings,
  generateEmbeddingsChunked,
  getEmbeddingDimension,
  testConnection
};
