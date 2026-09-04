import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Default models
const RERANK_MODEL = process.env.GROQ_RERANK_MODEL || "llama-3.2-3b-preview";
const SUMMARIZATION_MODEL = process.env.GROQ_SUMMARIZATION_MODEL || "llama-3.3-70b-versatile";

/**
 * Test Groq API connection
 */
export async function testConnection() {
  try {
    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: "Hi" }],
      model: RERANK_MODEL,
      max_tokens: 10
    });
    
    console.log('✅ Groq API connection successful!');
    return true;
  } catch (error) {
    console.error('❌ Groq API connection failed:', error.message);
    return false;
  }
}

/**
 * Rerank documents using Groq LLM
 * Uses a smaller, faster model (llama-3.2-3b-preview) for cost-effective reranking
 * 
 * @param {string} query - The search query
 * @param {Array} documents - Array of documents to rerank
 * @param {number} topK - Number of top documents to return
 * @returns {Promise<Array>} - Reranked documents with scores
 */
export async function rerankDocuments(query, documents, topK = 10) {
  try {
    if (!documents || documents.length === 0) {
      return [];
    }

    // Prepare document texts
    const docTexts = documents.map((doc, idx) => {
      const text = formatDocumentForRerank(doc);
      return `[${idx}] ${text}`;
    }).join('\n\n');

    // Create reranking prompt - simplified to avoid JSON validation issues
    const prompt = `You are a relevance scoring assistant. Score each document's relevance to the query on a scale of 0-100.

Query: "${query}"

Documents:
${docTexts}

Return ONLY a valid JSON object with this exact structure - no other text:
{"rankings": [{"index": 0, "score": 95}, {"index": 1, "score": 87}]}

Sort by score highest first. Include only top ${topK} results.`;

    // Call Groq API with smaller model for fast reranking
    let completion;
    try {
      completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "You are a JSON response assistant. Return only valid JSON, no markdown or extra text."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        model: RERANK_MODEL,
        temperature: 0,
        max_tokens: 1000
      });
    } catch (apiError) {
      console.error('⚠️ Groq API error (will use original order):', apiError.message);
      return documents.slice(0, topK);
    }

    const responseText = completion.choices[0]?.message?.content || '';
    
    // Check if response is empty
    if (!responseText || responseText.trim().length === 0) {
      console.warn('⚠️ Groq returned empty response, using original document order');
      return documents.slice(0, topK);
    }
    
    // Parse response - handle markdown code blocks and extract JSON
    let scores;
    try {
      let jsonText = responseText.trim();
      
      // Remove markdown code block formatting if present
      jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      
      // Extract JSON object if it's embedded in other text
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
      
      const parsed = JSON.parse(jsonText);
      // Handle various response formats
      scores = parsed.rankings || parsed.scores || parsed.results || [];
      
      if (!Array.isArray(scores) || scores.length === 0) {
        console.warn('⚠️  Invalid Groq response format, falling back to original order');
        return documents.slice(0, topK);
      }
    } catch (e) {
      console.error('⚠️ Failed to parse Groq response:', e.message);
      console.error('   Response text:', responseText.substring(0, 200));
      return documents.slice(0, topK);
    }

    // Map scores back to documents
    const rerankedDocs = scores
      .filter(item => {
        // Validate score item has required fields
        return item && 
               typeof item.index === 'number' && 
               typeof item.score === 'number' &&
               item.index >= 0 && 
               item.index < documents.length;
      })
      .map(item => ({
        ...documents[item.index],
        rerankScore: Math.min(Math.max(item.score / 100, 0), 1), // Normalize to 0-1 and clamp
        originalRank: item.index + 1
      }))
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .slice(0, topK);

    return rerankedDocs.length > 0 ? rerankedDocs : documents.slice(0, topK);

  } catch (error) {
    console.error('⚠️ Groq reranking error:', error.message);
    // Return original documents if reranking fails
    return documents.slice(0, topK);
  }
}

/**
 * Generate summary of search results using Groq LLM
 * Uses a larger, more capable model (llama-3.3-70b-versatile) for high-quality summaries
 * 
 * @param {string} query - The original search query
 * @param {Array} documents - Array of documents to summarize
 * @param {Object} options - Summarization options
 * @returns {Promise<string>} - Generated summary
 */
export async function summarizeResults(query, documents, options = {}) {
  try {
    const {
      maxLength = 500,
      style = 'concise', // 'concise', 'detailed', 'bullet'
      includeMetrics = false
    } = options;

    if (!documents || documents.length === 0) {
      return 'No results found.';
    }

    // Format documents for summarization
    const docTexts = documents.map((doc, idx) => {
      return `${idx + 1}. ${formatDocumentForSummary(doc)}`;
    }).join('\n\n');

    // Build prompt based on style
    let styleInstruction = '';
    if (style === 'bullet') {
      styleInstruction = 'Provide a bullet-point summary with key findings.';
    } else if (style === 'detailed') {
      styleInstruction = 'Provide a detailed analysis of the search results.';
    } else {
      styleInstruction = 'Provide a concise overview of the search results.';
    }

    const prompt = `You are a helpful assistant that summarizes search results.

Query: "${query}"

Search Results:
${docTexts}

Task: ${styleInstruction}
${includeMetrics ? 'Include statistics like number of results, common themes, and relevance insights.' : ''}
Keep the summary under ${maxLength} words.

Summary:`;

    // Call Groq API with larger model for high-quality summarization
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that provides clear, accurate summaries of search results."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: SUMMARIZATION_MODEL,
      temperature: 0.3,
      max_tokens: Math.min(maxLength * 2, 2000)
    });

    return completion.choices[0].message.content.trim();

  } catch (error) {
    console.error('❌ Groq summarization error:', error.message);
    return `Error generating summary: ${error.message}`;
  }
}

/**
 * Generate answer to query based on retrieved documents
 * Uses the larger model for accurate question answering
 * 
 * @param {string} query - User's question
 * @param {Array} documents - Retrieved context documents
 * @param {Object} options - Answer generation options
 * @returns {Promise<Object>} - Generated answer with metadata
 */
export async function generateAnswer(query, documents, options = {}) {
  try {
    const {
      maxTokens = 1000,
      includeReferences = true,
      temperature = 0.2
    } = options;

    if (!documents || documents.length === 0) {
      return {
        answer: "I couldn't find relevant information to answer your question.",
        references: [],
        confidence: 0
      };
    }

    // Format context from documents
    const context = documents.map((doc, idx) => {
      return `[${idx + 1}] ${formatDocumentForSummary(doc)}`;
    }).join('\n\n');

    const prompt = `Answer the following question based ONLY on the provided context. If the answer cannot be found in the context, say so.

Context:
${context}

Question: ${query}

Instructions:
1. Provide a direct, accurate answer based on the context
2. ${includeReferences ? 'Cite source numbers [1], [2], etc. when referencing specific information' : 'Do not include citations'}
3. Be concise but complete
4. If uncertain or if information is not in context, acknowledge it

Answer:`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that answers questions accurately based on provided context. Never make up information."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: SUMMARIZATION_MODEL,
      temperature: temperature,
      max_tokens: maxTokens
    });

    const answer = completion.choices[0].message.content.trim();

    // Extract referenced document indices
    const references = [];
    if (includeReferences) {
      const refMatches = answer.matchAll(/\[(\d+)\]/g);
      const refIndices = new Set([...refMatches].map(m => parseInt(m[1]) - 1));
      
      refIndices.forEach(idx => {
        if (idx >= 0 && idx < documents.length) {
          references.push({
            index: idx + 1,
            document: documents[idx]
          });
        }
      });
    }

    return {
      answer,
      references,
      model: SUMMARIZATION_MODEL,
      tokensUsed: completion.usage?.total_tokens || 0
    };

  } catch (error) {
    console.error('❌ Groq answer generation error:', error.message);
    return {
      answer: `Error generating answer: ${error.message}`,
      references: [],
      confidence: 0
    };
  }
}

/**
 * Format document for reranking (shorter, key info only)
 */
function formatDocumentForRerank(doc) {
  if (doc.testcase_id || doc.id) {
    // Test case document
    return `${doc.testcase_id || doc.id}: ${doc.title || ''} - ${(doc.description || '').substring(0, 200)}`;
  } else if (doc.key) {
    // User story document
    return `${doc.key}: ${doc.summary || ''} - ${(doc.description || '').substring(0, 200)}`;
  } else {
    // Generic document
    return JSON.stringify(doc).substring(0, 250);
  }
}

/**
 * Format document for summarization (more detailed)
 */
function formatDocumentForSummary(doc) {
  if (doc.testcase_id || doc.id) {
    // Test case document
    const parts = [
      `ID: ${doc.testcase_id || doc.id}`,
      `Title: ${doc.title || 'N/A'}`,
      doc.module ? `Module: ${doc.module}` : null,
      doc.description ? `Description: ${doc.description.substring(0, 150)}` : null,
      doc.score ? `Relevance: ${(doc.score * 100).toFixed(1)}%` : null
    ].filter(Boolean);
    return parts.join(' | ');
  } else if (doc.key) {
    // User story document
    const parts = [
      `Story: ${doc.key}`,
      `Summary: ${doc.summary || 'N/A'}`,
      doc.status?.name ? `Status: ${doc.status.name}` : null,
      doc.priority?.name ? `Priority: ${doc.priority.name}` : null,
      doc.description ? `Description: ${doc.description.substring(0, 150)}` : null,
      doc.score ? `Relevance: ${(doc.score * 100).toFixed(1)}%` : null
    ].filter(Boolean);
    return parts.join(' | ');
  } else {
    // Generic document
    return JSON.stringify(doc).substring(0, 300);
  }
}

/**
 * Batch rerank multiple queries (for efficiency)
 */
export async function batchRerank(queries, documents, topK = 10) {
  try {
    const results = await Promise.all(
      queries.map(query => rerankDocuments(query, documents, topK))
    );
    return results;
  } catch (error) {
    console.error('❌ Batch reranking error:', error.message);
    throw error;
  }
}

/**
 * Get embedding dimensions (for compatibility)
 */
export function getModelInfo() {
  return {
    rerankModel: RERANK_MODEL,
    summarizationModel: SUMMARIZATION_MODEL,
    provider: 'groq',
    capabilities: ['rerank', 'summarize', 'qa']
  };
}

export default {
  testConnection,
  rerankDocuments,
  summarizeResults,
  generateAnswer,
  batchRerank,
  getModelInfo
};
