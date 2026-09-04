import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { MongoClient } from 'mongodb';
import dns from 'dns';
import axios from 'axios';
import { generateEmbedding, generateBatchEmbeddings } from '../src/scripts/utilities/mistralEmbedding.js';
import { rerankDocuments, summarizeResults } from '../src/scripts/utilities/groqClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// Fix DNS resolution issue on macOS
dns.setServers(['8.8.8.8', '8.8.4.4']);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// ======================== Job Tracking ========================
// In-memory job tracking (consider using Redis for production)
const jobs = new Map();

function createJob(files) {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  jobs.set(jobId, {
    id: jobId,
    files,
    status: 'in-progress',
    progress: 0,
    total: files.length,
    results: [],
    startTime: new Date(),
    currentFile: null
  });
  return jobId;
}

function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (job) {
    Object.assign(job, updates);
    jobs.set(jobId, job);
  }
}

function getJob(jobId) {
  return jobs.get(jobId);
}

// Clean up old jobs (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [jobId, job] of jobs.entries()) {
    if (new Date(job.startTime).getTime() < oneHourAgo) {
      jobs.delete(jobId);
    }
  }
}, 10 * 60 * 1000); // Run every 10 minutes

// ======================== Validation Helpers ========================

async function validateDbCollectionIndex(client, dbName, collectionName, indexName, requireDocuments = false) {
  try {
    // Attempt to detect database existence via listDatabases (may require privileges)
    let dbExists = false;
    try {
      const admin = client.db().admin();
      const dbs = await admin.listDatabases();
      dbExists = dbs.databases.some(d => d.name === dbName);
    } catch (err) {
      // If listDatabases fails because of permissions, fallback to checking the collection directly
      console.warn('⚠️ listDatabases failed (permissions?), falling back to listCollections check:', err.message);
      dbExists = true; // assume DB exists and proceed to collection check
    }

    if (!dbExists) {
      return { ok: false, error: `Database '${dbName}' not found` };
    }

    const db = client.db(dbName);
    const collections = await db.listCollections({ name: collectionName }).toArray();
    if (!collections || collections.length === 0) {
      return { ok: false, error: `Collection '${collectionName}' not found in database '${dbName}'` };
    }

    if (requireDocuments) {
      const count = await db.collection(collectionName).countDocuments();
      if (count === 0) {
        return { ok: false, error: `No documents found in collection '${collectionName}'. Please create embeddings first.` };
      }
    }

    // Verify Atlas Search indexes (listSearchIndexes command)
    if (indexName) {
      try {
        const collection = db.collection(collectionName);
        const indexes = await collection.listSearchIndexes().toArray();
        if (!indexes || !Array.isArray(indexes)) {
          return { ok: false, error: `Unable to verify search indexes for collection '${collectionName}'.` };
        }
        const found = indexes.some(idx => idx.name === indexName);
        if (!found) {
          return { ok: false, error: `Search index '${indexName}' not found for collection '${collectionName}'` };
        }
      } catch (err) {
        // Some server versions / permissions may not allow listSearchIndexes; surface helpful message
        return { ok: false, error: `Could not verify search index '${indexName}': ${err.message}` };
      }
    }

    return { ok: true };

  } catch (err) {
    return { ok: false, error: `Validation failed: ${err.message}` };
  }
}

// ======================== API Routes ========================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Get active jobs
app.get('/api/jobs/active', (req, res) => {
  const activeJobs = Array.from(jobs.values()).filter(job => job.status === 'in-progress');
  res.json({ jobs: activeJobs });
});

// Get job status
app.get('/api/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Get distinct metadata values for filters
app.get('/api/metadata/distinct', async (req, res) => {
  try {
    console.log('🔍 Fetching distinct metadata values...');
    console.log('📊 DB Name:', process.env.DB_NAME);
    console.log('📊 Collection Name:', process.env.COLLECTION_NAME);

    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    await mongoClient.connect();
    console.log('✅ Connected to MongoDB');

    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Check document count first
    const count = await collection.countDocuments();
    console.log(`📊 Total documents in collection: ${count}`);

    if (count === 0) {
      console.log('⚠️ Collection is empty! No documents found.');
      await mongoClient.close();
      return res.json({
        success: true,
        metadata: {
          modules: [],
          priorities: [],
          risks: [],
          types: []
        },
        message: 'Collection is empty. Please create embeddings first.'
      });
    }

    // Get a sample document to see what fields exist
    const sampleDoc = await collection.findOne({});
    console.log('📄 Sample document fields:', Object.keys(sampleDoc || {}));
    console.log('📄 Sample document:', JSON.stringify(sampleDoc, null, 2));

    const modules = await collection.distinct('module');
    const priorities = await collection.distinct('priority');
    const risks = await collection.distinct('risk');
    const types = await collection.distinct('automationManual');

    console.log(`✅ Found ${modules.length} modules:`, modules);
    console.log(`✅ Found ${priorities.length} priorities:`, priorities);
    console.log(`✅ Found ${risks.length} risks:`, risks);
    console.log(`✅ Found ${types.length} types:`, types);

    await mongoClient.close();

    const metadata = {
      modules: modules.filter(Boolean).sort(),
      priorities: priorities.filter(Boolean).sort(),
      risks: risks.filter(Boolean).sort(),
      types: types.filter(Boolean).sort()
    };

    console.log('📤 Sending metadata:', metadata);

    res.json({
      success: true,
      metadata
    });

  } catch (error) {
    console.error('❌ Error fetching metadata:', error);
    res.status(500).json({ error: 'Failed to fetch metadata', details: error.message });
  }
});

// Get all files in data directory
app.get('/api/files', (req, res) => {
  try {
    const dataPath = path.join(__dirname, '../src/data');
    const files = fs.readdirSync(dataPath)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(dataPath, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          size: stats.size,
          modified: stats.mtime,
          type: 'json'
        };
      });
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read files', details: error.message });
  }
});

// Upload and convert Excel to JSON (unified for Test Cases and User Stories)
app.post('/api/upload-excel', upload.single('file'), async (req, res) => {
  let tempScriptPath = null;
  let inputFile = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    inputFile = req.file.path;
    const dataDir = path.join(__dirname, '../src/data');
    const dataType = req.body.dataType || 'testcases';

    // Ensure output directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`📁 Created data directory: ${dataDir}`);
    }

    // Output file name based on data type
    const outputFileName = dataType === 'userstories'
      ? `stories-${Date.now()}.json`
      : `converted-${Date.now()}.json`;
    const outputPath = path.join(dataDir, outputFileName);

    // Convert paths to forward slashes (works on both Windows and Unix)
    const inputFileNormalized = inputFile.replace(/\\/g, '/');
    const outputPathNormalized = outputPath.replace(/\\/g, '/');

    let scriptContent;

    if (dataType === 'userstories') {
      // User Stories conversion script
      scriptContent = `
import xlsx from "xlsx";
import fs from "fs";

const excelFile = "${inputFileNormalized}";      
const sheetName = "${req.body.sheetName || 'stories'}";   
const outputFile = "${outputPathNormalized}";      

// Map Excel column headers → JSON keys (based on common user story fields)
const columnMap = {
  // Core user story fields
  "storyId": "key",
  "Story Key": "key",
  "Story ID": "key",
  "ID": "key",
  "Key": "key",
  "Issue Key": "key",
  
  "summary": "summary",
  "Summary": "summary",
  "Title": "summary",
  "Story Title": "summary",
  "User Story": "summary",
  "Story Summary": "summary",
  
  "description": "description",
  "Description": "description",
  "Story Description": "description",
  "Details": "description",
  "User Story Description": "description",
  
  "statusCategory": "status",
  "Status": "status",
  "Story Status": "status",
  "Issue Status": "status",
  "priority": "priority",
  "Priority": "priority",
  "Story Priority": "priority",
  "Issue Priority": "priority",
  
  "assignee": "assignee",
  "Assignee": "assignee",
  "Assigned To": "assignee",
  "reporter": "reporter",
  "Reporter": "reporter",
  "Created By": "reporter",
  
  "createdDate": "created",
  "Created": "created",
  "Created Date": "created",
  "Creation Date": "created",
  "updatedDate": "updated",
  "Updated": "updated",
  "Updated Date": "updated",
  "Last Modified": "updated",
  "Last Modified Date": "updated",
  
  "projectName": "project",
  "Project": "project",
  "Project Key": "project",
  "Project Name": "project",
  "parentSummary": "epic",
  "Epic": "epic",
  "Epic Link": "epic",
  "Epic Name": "epic",
  
  "storyPoints": "storyPoints",
  "Story Points": "storyPoints",
  "Points": "storyPoints",
  "Estimate": "storyPoints",
  "Effort": "storyPoints",
  "Story Point Estimate": "storyPoints",
  
  "components": "components",
  "Components": "components",
  "Component": "components",
  "labels": "labels",
  "Labels": "labels",
  "Tags": "labels",
  
  "fixVersions": "fixVersions",
  "Fix Version": "fixVersions",
  "Fix Versions": "fixVersions",
  "Target Version": "fixVersions",
  "Release": "fixVersions",
  "Version": "fixVersions",
  
  "acceptanceCriteria": "acceptanceCriteria",
  "Acceptance Criteria": "acceptanceCriteria",
  "AC": "acceptanceCriteria",
  "Definition of Done": "acceptanceCriteria",
  "Acceptance": "acceptanceCriteria",
  
  "businessValue": "businessValue",
  "Business Value": "businessValue",
  "risk": "risk",
  "Risk": "risk",
  "dependencies": "dependencies",
  "Dependencies": "dependencies",
  "notes": "notes",
  "Notes": "notes",
  "Comments": "notes",
  "Remarks": "notes",
  
  "Sprint": "sprint",
  "Current Sprint": "sprint",
  "Sprint Name": "sprint",
  
  "Team": "team",
  "Squad": "team",
  "Development Team": "team"
};

function parseArrayField(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map(item => item.trim()).filter(item => item.length > 0);
}

function getStatusCategory(status) {
  const statusLower = status.toLowerCase();
  if (statusLower.includes('done') || statusLower.includes('complete') || statusLower.includes('closed') || statusLower.includes('resolved')) {
    return 'Done';
  } else if (statusLower.includes('progress') || statusLower.includes('dev') || statusLower.includes('testing') || statusLower.includes('review')) {
    return 'In Progress';
  } else {
    return 'To Do';
  }
}

function getPriorityId(priority) {
  const priorityMap = {
    'highest': '1',
    'high': '2', 
    'medium': '3',
    'low': '4',
    'lowest': '5'
  };
  return priorityMap[priority.toLowerCase()] || '3';
}

function formatDate(dateString) {
  if (!dateString) return null;
  if (dateString instanceof Date) {
    return dateString.toISOString();
  }
  if (typeof dateString === 'string') {
    if (dateString.trim() === '') return null;
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return null;
      return date.toISOString();
    } catch (error) {
      return null;
    }
  }
  if (typeof dateString === 'number') {
    try {
      const date = new Date((dateString - 25569) * 86400 * 1000);
      if (isNaN(date.getTime())) return null;
      return date.toISOString();
    } catch (error) {
      return null;
    }
  }
  return null;
}

function transformToUserStoryFormat(rawRow, index) {
  const mappedRow = {};
  for (const [excelCol, jsonKey] of Object.entries(columnMap)) {
    if (rawRow.hasOwnProperty(excelCol) && rawRow[excelCol]) {
      mappedRow[jsonKey] = rawRow[excelCol];
    }
  }

  const transformedRow = {
    key: mappedRow.key || \`US-\${String(index + 1).padStart(3, '0')}\`,
    summary: mappedRow.summary || "Untitled User Story",
    description: mappedRow.description || "No description provided",
    status: {
      name: mappedRow.status || "To Do",
      category: getStatusCategory(mappedRow.status || "To Do")
    },
    priority: {
      name: mappedRow.priority || "Medium",
      id: getPriorityId(mappedRow.priority || "Medium")
    },
    assignee: mappedRow.assignee ? {
      displayName: mappedRow.assignee,
      emailAddress: null,
      accountId: null
    } : null,
    reporter: mappedRow.reporter ? {
      displayName: mappedRow.reporter,
      emailAddress: null,
      accountId: null
    } : null,
    created: formatDate(mappedRow.created) || new Date().toISOString(),
    updated: formatDate(mappedRow.updated) || new Date().toISOString(),
    components: parseArrayField(mappedRow.components),
    labels: parseArrayField(mappedRow.labels),
    fixVersions: parseArrayField(mappedRow.fixVersions),
    storyPoints: parseFloat(mappedRow.storyPoints) || null,
    project: mappedRow.project || "UNKNOWN",
    epic: mappedRow.epic || null,
    acceptanceCriteria: mappedRow.acceptanceCriteria || "",
    businessValue: mappedRow.businessValue || "",
    risk: mappedRow.risk || "",
    dependencies: mappedRow.dependencies || "",
    notes: mappedRow.notes || "",
    sprint: mappedRow.sprint || null,
    team: mappedRow.team || null,
    issueLinks: [],
    url: "",
    sourceType: "excel",
    importedAt: new Date().toISOString(),
    originalRowIndex: index + 1
  };

  return transformedRow;
}

try {
  if (!fs.existsSync(excelFile)) {
    throw new Error(\`Input file does not exist: \${excelFile}\`);
  }

  const workbook = xlsx.readFile(excelFile);
  
  let worksheet = workbook.Sheets[sheetName];
  let actualSheetName = sheetName;
  
  if (!worksheet) {
    const sheetNames = workbook.SheetNames;
    if (sheetNames.length === 0) {
      throw new Error(\`No sheets found in Excel file\`);
    }
    actualSheetName = sheetNames[0];
    worksheet = workbook.Sheets[actualSheetName];
    console.log(\`⚠️ Sheet "\${sheetName}" not found. Using first sheet: "\${actualSheetName}"\`);
  }

  const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

  if (rawData.length === 0) {
    throw new Error(\`No data found in sheet "\${actualSheetName}"\`);
  }

  console.log(\`🔄 Converting \${rawData.length} rows from sheet "\${actualSheetName}"...\`);
  
  const transformedData = rawData.map((row, index) => transformToUserStoryFormat(row, index));
  
  const validUserStories = transformedData.filter(story => 
    story.summary && story.summary !== "Untitled User Story" && story.summary.trim() !== ""
  );

  fs.writeFileSync(outputFile, JSON.stringify(validUserStories, null, 2), "utf-8");
  console.log(\`✅ Converted \${validUserStories.length} user stories from "\${actualSheetName}" into \${outputFile}\`);
  console.log(\`⚠️ Filtered out: \${transformedData.length - validUserStories.length} empty rows\`);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
`;
    } else {
      // Test Cases conversion script (default)
      scriptContent = `
import xlsx from "xlsx";
import fs from "fs";

const excelFile = "${inputFileNormalized}";      
const sheetName = "${req.body.sheetName || 'Testcases'}";   
const outputFile = "${outputPathNormalized}";      

const columnMap = {
  "module": "module",
  "testCaseId": "id",
  "preRequisites": "preRequisites",
  "title": "title",
  "description": "description",
  "steps": "steps",
  "expectedResults": "expectedResults",
  "automationManual": "automationManual",
  "priority": "priority",
  "createdBy": "createdBy",
  "createdDate": "createdDate",
  "lastModifiedDate": "lastModifiedDate",
  "linkedStories": "linkedStories",
  "risk": "risk",
  "version": "version",
  "type": "type"
};

try {
  // Check if input file exists
  if (!fs.existsSync(excelFile)) {
    throw new Error(\`Input file does not exist: \${excelFile}\`);
  }

  const workbook = xlsx.readFile(excelFile);
  
  // Try to get the specified sheet, or fall back to the first sheet
  let worksheet = workbook.Sheets[sheetName];
  let actualSheetName = sheetName;
  
  if (!worksheet) {
    const sheetNames = workbook.SheetNames;
    if (sheetNames.length === 0) {
      throw new Error(\`No sheets found in Excel file\`);
    }
    actualSheetName = sheetNames[0];
    worksheet = workbook.Sheets[actualSheetName];
    console.log(\`⚠️ Sheet "\${sheetName}" not found. Using first sheet: "\${actualSheetName}"\`);
  }

  const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

  if (rawData.length === 0) {
    throw new Error(\`No data found in sheet "\${actualSheetName}"\`);
  }

  const jsonData = rawData.map((row, index) => {
    const mappedRow = {};
    for (const [excelCol, jsonKey] of Object.entries(columnMap)) {
      mappedRow[jsonKey] = row[excelCol] || "";
    }
    return mappedRow;
  });

  fs.writeFileSync(outputFile, JSON.stringify(jsonData, null, 2), "utf-8");
  console.log(\`✅ Converted \${jsonData.length} rows from "\${actualSheetName}" into \${outputFile}\`);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
`;
    }

    tempScriptPath = path.join(__dirname, `temp-excel-convert-${Date.now()}.js`);
    fs.writeFileSync(tempScriptPath, scriptContent);

    // Execute the conversion script with proper promise handling
    const conversionPromise = new Promise((resolve, reject) => {
      const child = spawn('node', [tempScriptPath], { cwd: __dirname });

      let output = '';
      let error = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        error += data.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn child process: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output, outputFile: path.basename(outputPath) });
        } else {
          reject(new Error(error || output || 'Conversion script exited with error'));
        }
      });

      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Conversion script timeout after 30 seconds'));
      }, 30000);

      child.on('exit', () => {
        clearTimeout(timeout);
      });
    });

    // Await the conversion
    const result = await conversionPromise;

    // Clean up temporary files
    if (tempScriptPath && fs.existsSync(tempScriptPath)) {
      fs.unlinkSync(tempScriptPath);
    }
    if (inputFile && fs.existsSync(inputFile)) {
      fs.unlinkSync(inputFile);
    }

    const dataTypeLabel = dataType === 'userstories' ? 'User stories' : 'Test cases';
    res.json({
      success: true,
      message: `${dataTypeLabel} file converted successfully`,
      outputFile: result.outputFile,
      output: result.output
    });

  } catch (error) {
    console.error('❌ Upload error:', error.message);

    // Clean up temporary files on error
    try {
      if (tempScriptPath && fs.existsSync(tempScriptPath)) {
        fs.unlinkSync(tempScriptPath);
      }
      if (inputFile && fs.existsSync(inputFile)) {
        fs.unlinkSync(inputFile);
      }
    } catch (cleanupError) {
      console.error('⚠️ Error cleaning up temporary files:', cleanupError.message);
    }

    res.status(500).json({
      error: 'Upload failed',
      details: error.message
    });
  }
});

// Create embeddings for selected files
app.post('/api/create-embeddings', async (req, res) => {
  try {
    const { files } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files selected' });
    }

    // Validate DB and collection exist (no documents required for creating embeddings)
    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    try {
      await mongoClient.connect();
      const validation = await validateDbCollectionIndex(mongoClient, process.env.DB_NAME, process.env.COLLECTION_NAME, null, false);
      if (!validation.ok) {
        await mongoClient.close();
        return res.status(400).json({ error: validation.error });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to validate database/collection', details: err.message });
    } finally {
      try { await mongoClient.close(); } catch (e) { }
    }

    // Create a job and return immediately
    const jobId = createJob(files);

    // Start processing in background
    processEmbeddings(jobId, files);

    // Return job ID to client
    res.json({
      success: true,
      jobId,
      message: 'Embedding creation started',
      filesCount: files.length
    });

  } catch (error) {
    res.status(500).json({ error: 'Embedding creation failed', details: error.message });
  }
});

// Create embeddings using batch processing scripts (FASTER)
app.post('/api/create-embeddings-batch', async (req, res) => {
  try {
    const { files, scriptName, jobType } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files selected' });
    }

    if (!scriptName) {
      return res.status(400).json({ error: 'Script name is required' });
    }

    // Validate DB and collection exist
    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    try {
      await mongoClient.connect();
      const validation = await validateDbCollectionIndex(mongoClient, process.env.DB_NAME, process.env.COLLECTION_NAME, null, false);
      if (!validation.ok) {
        await mongoClient.close();
        return res.status(400).json({ error: validation.error });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to validate database/collection', details: err.message });
    } finally {
      try { await mongoClient.close(); } catch (e) { }
    }

    // Create a job
    const jobId = createJob(files);

    // Start batch processing in background
    processBatchEmbeddings(jobId, files, scriptName, jobType);

    // Return job ID to client
    res.json({
      success: true,
      jobId,
      message: `Batch embedding creation started using ${scriptName}`,
      filesCount: files.length,
      jobType: jobType
    });

  } catch (error) {
    console.error('❌ Batch embedding error:', error);
    res.status(500).json({ error: 'Batch embedding creation failed', details: error.message });
  }
});

// Background batch processing function
async function processBatchEmbeddings(jobId, files, scriptName, jobType) {
  const results = [];

  try {
    console.log(`\n🚀 Starting batch embeddings processing...`);
    console.log(`   Job ID: ${jobId}`);
    console.log(`   Script: ${scriptName}`);
    console.log(`   Job Type: ${jobType}`);
    console.log(`   Files: ${files.join(', ')}\n`);

    updateJob(jobId, {
      status: 'in-progress',
      message: `Launching batch script: ${scriptName}`
    });

    // Determine the full script path
    const scriptPath = path.join(__dirname, '../src/scripts/embeddings', scriptName);

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Batch script not found: ${scriptPath}`);
    }

    // Get project root (go up 2 levels from server to project root)
    const projectRoot = path.join(__dirname, '..');
    console.log(`📁 Project root: ${projectRoot}`);
    console.log(`📁 Script path: ${scriptPath}`);

    // Pass selected file names to the batch script via environment variable
    const inputFiles = files.join(',');
    console.log(`📄 Input files: ${inputFiles}`);

    // Execute the batch script from project root so relative paths work
    const batchScript = spawn('node', [scriptPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        EMBEDDING_INPUT_FILES: inputFiles
      }
    });

    let output = '';
    let error = '';
    let isProcessing = true;

    batchScript.stdout.on('data', (data) => {
      const message = data.toString();
      output += message;
      console.log(`[${jobType}]`, message);

      // Update job with current status
      updateJob(jobId, {
        currentFile: jobType,
        message: message.trim().split('\n').pop() // Last line
      });
    });

    batchScript.stderr.on('data', (data) => {
      const message = data.toString();
      error += message;
      console.error(`[${jobType}]ERROR: `, message);
    });

    batchScript.on('error', (err) => {
      isProcessing = false;
      console.error(`❌ Failed to spawn batch script: `, err.message);
      results.push({
        file: jobType,
        status: 'failed',
        error: `Failed to spawn script: ${err.message}`,
        output
      });

      updateJob(jobId, {
        status: 'failed',
        error: err.message,
        results: results
      });
    });

    // Add timeout (prevent hanging)
    const timeout = setTimeout(() => {
      if (isProcessing) {
        batchScript.kill('SIGTERM');
        isProcessing = false;
        console.error(`❌ Batch script timeout after 5 hours`);

        results.push({
          file: jobType,
          status: 'timeout',
          error: 'Batch processing timeout after 5 hours',
          output
        });

        updateJob(jobId, {
          status: 'failed',
          error: 'Processing timeout',
          results: results
        });
      }
    }, 5 * 60 * 60 * 1000); // 5 hour timeout

    batchScript.on('close', (code) => {
      clearTimeout(timeout);
      isProcessing = false;

      if (code === 0) {
        console.log(`✅ Batch script completed successfully!`);
        results.push({
          file: jobType,
          status: 'completed',
          output: output
        });

        updateJob(jobId, {
          status: 'completed',
          endTime: new Date(),
          results: results,
          message: `Batch processing completed for ${jobType}`
        });
      } else {
        console.error(`❌ Batch script exited with code ${code} `);
        results.push({
          file: jobType,
          status: 'failed',
          error: `Script exited with code ${code} `,
          output: output || error
        });

        updateJob(jobId, {
          status: 'failed',
          endTime: new Date(),
          results: results,
          error: error || output || `Process exited with code ${code} `
        });
      }
    });

  } catch (err) {
    console.error(`❌ Batch processing error: `, err.message);
    results.push({
      file: jobType,
      status: 'failed',
      error: err.message
    });

    updateJob(jobId, {
      status: 'failed',
      endTime: new Date(),
      results: results,
      error: err.message
    });
  }
}

// Background processing function
async function processEmbeddings(jobId, files) {
  const results = [];


  for (const fileName of files) {
    updateJob(jobId, { currentFile: fileName });

    const filePath = path.join(__dirname, '../src/data', fileName);
    // Convert paths to forward slashes for cross-platform compatibility
    const filePathNormalized = filePath.replace(/\\/g, '/');

    // Create a modified version of create-embeddings-store.js for this specific file
    const scriptContent = `
import { MongoClient } from "mongodb";
import dns from "dns";
import dotenv from "dotenv";
import fs from "fs";
import { generateEmbedding } from "../src/scripts/utilities/mistralEmbedding.js";

dotenv.config();

dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  ssl: true,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true,
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
});

async function main() {
  try {
    await mongoClient.connect();
    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    const testcases = JSON.parse(fs.readFileSync("${filePathNormalized}", "utf-8"));

    console.log(\`🚀 Processing \${testcases.length} test cases from ${fileName}...\`);
    
    let totalCost = 0;
    let totalTokens = 0;
    let processed = 0;

    for (const testcase of testcases) {
      try {
        const inputText = \`
          Module: \${testcase.module}
          ID: \${testcase.id}
          Pre-Requisites: \${testcase.preRequisites}
          Title: \${testcase.title}
          Description: \${testcase.description}
          Steps: \${testcase.steps}
          Expected Result: \${testcase.expectedResults}
          Automation/Manual: \${testcase.automationManual}
          Priority: \${testcase.priority}
          Created By: \${testcase.createdBy}
          Created Date: \${testcase.createdDate}
          Last Modified Date: \${testcase.lastModifiedDate}
          Risk: \${testcase.risk}
          Version: \${testcase.version}
          Type: \${testcase.type}
        \`;
        
        // Use Mistral AI for embeddings
        const embeddingResult = await generateEmbedding(inputText);
        
        if (!embeddingResult || !embeddingResult.embedding) {
          throw new Error('Failed to generate embedding with Mistral AI');
        }

        const vector = embeddingResult.embedding;
        const tokens = embeddingResult.usage?.total_tokens || 0;
        const cost = (tokens / 1000000) * 0.10; // Mistral pricing: $0.10 per 1M tokens
        
        totalCost += cost;
        totalTokens += tokens;

        const doc = {
          ...testcase,
          embedding: vector,
          createdAt: new Date(),
          sourceFile: "${fileName}",
          embeddingMetadata: {
            model: 'mistral-embed',
            provider: 'mistral-ai',
            cost: cost,
            tokens: tokens,
            apiSource: 'testleaf'
          }
        };

        await collection.insertOne(doc);
        processed++;
        
        console.log(\`✅ Processed \${processed}/\${testcases.length}: \${testcase.id}\`);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(\`❌ Error processing \${testcase.id}: \${error.message}\`);
        continue;
      }
    }

    console.log(\`\\n🎉 Processing complete for ${fileName}!\`);
    console.log(\`💰 Total Cost: $\${totalCost.toFixed(6)}\`);
    console.log(\`🔢 Total Tokens: \${totalTokens}\`);
    console.log(\`📊 Processed: \${processed}/\${testcases.length}\`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  } finally {
    await mongoClient.close();
  }
}

main();
`;

    const tempScriptPath = path.join(__dirname, `temp-embeddings-${Date.now()}.js`);
    fs.writeFileSync(tempScriptPath, scriptContent);

    try {
      await new Promise((resolve, reject) => {
        const child = spawn('node', [tempScriptPath], { cwd: __dirname });

        let output = '';
        let error = '';

        child.stdout.on('data', (data) => {
          output += data.toString();
        });

        child.stderr.on('data', (data) => {
          error += data.toString();
        });

        child.on('close', (code) => {
          fs.unlinkSync(tempScriptPath);

          if (code === 0) {
            results.push({
              file: fileName,
              status: 'completed',
              output
            });
            resolve();
          } else {
            results.push({
              file: fileName,
              status: 'failed',
              error: error || output
            });
            resolve(); // Continue with other files
          }
        });
      });
    } catch (error) {
      results.push({
        file: fileName,
        status: 'failed',
        error: error.message
      });
    }

    // Update job progress
    updateJob(jobId, {
      progress: results.length,
      results: [...results]
    });
  }

  // Mark job as complete
  updateJob(jobId, {
    status: 'completed',
    endTime: new Date(),
    results
  });
}

// Get environment variables
app.get('/api/env', (req, res) => {
  try {
    const envPath = path.join(__dirname, '../.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');

    const envVars = {};
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && key.trim() && !key.startsWith('#')) {
        envVars[key.trim()] = valueParts.join('=').replace(/"/g, '');
      }
    });

    res.json(envVars);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read environment variables', details: error.message });
  }
});

// Update environment variables
app.post('/api/env', (req, res) => {
  try {
    const { envVars } = req.body;
    const envPath = path.join(__dirname, '../.env');

    let envContent = '';
    Object.entries(envVars).forEach(([key, value]) => {
      envContent += `${key}="${value}"\n`;
    });

    fs.writeFileSync(envPath, envContent);

    res.json({ success: true, message: 'Environment variables updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update environment variables', details: error.message });
  }
});

// ======================== Query Preprocessing ========================
// Preprocess query: normalization, abbreviation expansion, synonym expansion
app.post('/api/search/preprocess', async (req, res) => {
  try {
    const { query, options = {} } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Import preprocessing modules dynamically
    const { preprocessQuery } = await import('../src/scripts/query-preprocessing/queryPreprocessor.js');

    // Preprocess the query
    const result = preprocessQuery(query, {
      enableAbbreviations: options.enableAbbreviations !== false,
      enableSynonyms: options.enableSynonyms !== false,
      maxSynonymVariations: options.maxSynonymVariations || 5,
      customAbbreviations: options.customAbbreviations || {},
      customSynonyms: options.customSynonyms || {},
      smartExpansion: options.smartExpansion || false,
      preserveTestCaseIds: options.preserveTestCaseIds !== false
    });

    res.json(result);
  } catch (error) {
    console.error('Preprocessing error:', error);
    res.status(500).json({
      error: 'Failed to preprocess query',
      details: error.message
    });
  }
});

// Analyze query (show what preprocessing would do without applying)
app.post('/api/search/analyze', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const { analyzeQuery } = await import('../src/scripts/query-preprocessing/queryPreprocessor.js');
    const analysis = analyzeQuery(query);

    res.json(analysis);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze query',
      details: error.message
    });
  }
});

// ======================== Summarization & Deduplication ========================

// Deduplicate results based on similarity
app.post('/api/search/deduplicate', async (req, res) => {
  try {
    const { results, threshold = 0.85 } = req.body;

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'Results array is required' });
    }

    const deduplicated = [];
    const duplicates = [];
    const seenTitles = new Map();

    for (const result of results) {
      const title = result.title?.toLowerCase() || '';
      const id = result.id || '';

      // Check for exact title match
      let isDuplicate = false;

      for (const [seenTitle, seenResult] of seenTitles.entries()) {
        // Calculate similarity (Jaccard similarity for simple implementation)
        const similarity = calculateTextSimilarity(title, seenTitle);

        if (similarity >= threshold) {
          isDuplicate = true;
          duplicates.push({
            ...result,
            duplicateOf: seenResult.id,
            similarity: similarity.toFixed(3)
          });
          break;
        }
      }

      if (!isDuplicate) {
        deduplicated.push(result);
        seenTitles.set(title, result);
      }
    }

    res.json({
      original: results,
      deduplicated,
      duplicates,
      stats: {
        originalCount: results.length,
        deduplicatedCount: deduplicated.length,
        duplicatesRemoved: duplicates.length,
        reductionPercentage: ((duplicates.length / results.length) * 100).toFixed(1)
      }
    });
  } catch (error) {
    console.error('Deduplication error:', error);
    res.status(500).json({
      error: 'Failed to deduplicate results',
      details: error.message
    });
  }
});

// Summarize search results using Groq AI
app.post('/api/search/summarize', async (req, res) => {
  try {
    const { results, summaryType = 'concise', query = '' } = req.body;

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'Results array is required' });
    }

    if (results.length === 0) {
      return res.json({
        success: true,
        summary: 'No results to summarize',
        summaryType,
        resultCount: 0,
        timestamp: new Date().toISOString()
      });
    }

    // Prepare comprehensive content for summarization
    // Handle both field name formats and include ALL available information
    const resultsText = results.map((r, idx) => {
      const id = r.testCaseId || r.id || 'N/A';
      const title = r.testCaseTitle || r.title || 'No title';
      const description = r.testCaseDescription || r.description || 'No description';
      const steps = r.testSteps || r.steps || [];
      const expectedResults = r.expectedResults || r.expectedResults || 'Not specified';
      const module = r.module || 'Unknown';
      const priority = r.priority || 'Not specified';
      const automationManual = r.automationManual || r.automationStatus || 'Not specified';
      const risk = r.risk || 'Not specified';
      const type = r.type || 'Functional';

      let testCaseDetail = `${idx + 1}. TEST CASE: ${id}`;
      testCaseDetail += `\n   MODULE: ${module}`;
      testCaseDetail += `\n   PRIORITY: ${priority} | RISK: ${risk} | TYPE: ${type} | AUTOMATION: ${automationManual}`;
      testCaseDetail += `\n   TITLE: ${title}`;
      testCaseDetail += `\n   DESCRIPTION: ${description}`;

      if (steps) {
        testCaseDetail += `\n   TEST STEPS:`;
        if (Array.isArray(steps) && steps.length > 0) {
          steps.forEach((step, stepIdx) => {
            testCaseDetail += `\n     ${stepIdx + 1}. ${step}`;
          });
        } else if (typeof steps === 'string' && steps.trim()) {
          // Handle case where steps is a string (split by common delimiters)
          const trimmedSteps = steps.trim();

          // Check if it's a placeholder indicating no steps are defined
          if (trimmedSteps.toLowerCase() === 'no steps defined' ||
            trimmedSteps.toLowerCase() === 'n/a' ||
            trimmedSteps === '') {
            testCaseDetail += `\n     ⚠️ No steps defined for this test case`;
          } else {
            const stepArray = trimmedSteps.split(/\r?\n|\r/).filter(step => step.trim());
            if (stepArray.length > 0) {
              stepArray.forEach((step, stepIdx) => {
                testCaseDetail += `\n     ${stepIdx + 1}. ${step.trim()}`;
              });
            } else {
              testCaseDetail += `\n     ${trimmedSteps}`;
            }
          }
        } else {
          testCaseDetail += `\n     ⚠️ No steps defined for this test case`;
        }
      }

      testCaseDetail += `\n   EXPECTED RESULTS: ${expectedResults}`;
      testCaseDetail += `\n   ----------------------------------------`;

      return testCaseDetail;
    }).join('\n\n');

    const systemPrompt = summaryType === 'detailed'
      ? `You are a senior QA expert specializing in healthcare systems with 10+ years of experience. 

Your task is to provide a COMPREHENSIVE analysis of the test cases including:

1. **FUNCTIONAL COVERAGE ANALYSIS**: Group test cases by modules/functionality
2. **PRIORITY & RISK ASSESSMENT**: Analyze priority distribution and risk coverage
3. **TEST SCENARIO DEPTH**: Evaluate completeness of test steps and expected results
4. **EDGE CASES & NEGATIVE SCENARIOS**: Identify what edge cases are covered
5. **AUTOMATION READINESS**: Assess automation vs manual distribution
6. **CRITICAL GAPS**: Identify missing test scenarios that should exist
7. **HEALTHCARE COMPLIANCE**: Note any regulatory/compliance testing gaps
8. **INTEGRATION POINTS**: Identify inter-module dependencies that need testing

Provide detailed insights with specific examples from the test cases. Be thorough and technical.`
      : 'You are a QA expert specializing in healthcare systems. Provide a concise summary of the test cases in 2-3 sentences, highlighting the main functionality being tested and key scenarios covered.';

    const userPrompt = summaryType === 'detailed'
      ? `Analyze the following healthcare test cases in detail. Provide comprehensive coverage analysis:\n\n${resultsText}`
      : `Summarize the following test cases:\n\n${resultsText}`;

    // Use Groq AI for summarization
    console.log('🤖 Using Groq AI for summarization...');

    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
      throw new Error('GROQ_API_KEY is required for summarization feature. Please add it to your .env file. Get a free key at: https://console.groq.com');
    }

    // Use our Groq utility for summarization
    // If no query provided, use a generic context
    const searchQuery = query || 'test cases';

    const summary = await summarizeResults(searchQuery, results, {
      style: summaryType === 'concise' ? 'detailed' : 'concise',
      maxLength: summaryType === 'concise' ? 800 : 200,
      includeMetrics: summaryType === 'concise'
    });

    console.log('✅ Summarization complete with Groq AI');

    // Estimate token usage (rough approximation for display)
    const promptTokens = Math.ceil(resultsText.length / 4); // ~4 chars per token
    const completionTokens = Math.ceil(summary.length / 4);
    const totalTokens = promptTokens + completionTokens;

    // Groq pricing is much cheaper than OpenAI, but we'll show $0 for free tier
    const inputCost = 0; // Groq is currently free
    const outputCost = 0; // Groq is currently free
    const totalCost = 0;

    res.json({
      success: true,
      summary: summary,
      summaryType,
      resultCount: results.length,
      model: process.env.GROQ_SUMMARIZATION_MODEL || 'llama-3.3-70b-versatile',
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens
      },
      cost: {
        input: inputCost.toFixed(6),
        output: outputCost.toFixed(6),
        total: totalCost.toFixed(6)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Summarization error:', error);
    res.status(500).json({
      error: 'Summarization failed',
      details: error.message
    });
  }
});

// ======================== Test Prompt Endpoint ========================
app.post('/api/test-prompt', async (req, res) => {
  try {
    const { prompt, temperature = 0.2, maxTokens = 4000 } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Use Groq AI for chat completion
    console.log('🤖 Using Groq AI for prompt testing...');

    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
      throw new Error('GROQ_API_KEY is required for prompt testing. Please add it to your .env file.');
    }

    // Import Groq client dynamically
    const Groq = (await import('groq-sdk')).default;
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'user', content: prompt }
      ],
      model: process.env.GROQ_RERANK_MODEL || 'llama-3.2-3b-preview',
      temperature: temperature,
      max_tokens: Math.min(maxTokens, 16000),
      // Reasoning models (e.g. qwen3) emit <think> blocks in content unless reasoning is hidden
      reasoning_format: 'hidden'
    });

    let aiResponse = completion.choices[0].message.content;
    const usage = completion.usage;

    console.log('✅ Groq response received');

    // Strip any leftover <think>...</think> block (closed or truncated mid-thought)
    aiResponse = aiResponse.replace(/<think>[\s\S]*?(<\/think>|$)/i, '').trim();

    // Calculate estimated cost (Groq pricing: $0.05/M input, $0.10/M output)
    const inputCost = (usage.prompt_tokens / 1000000) * 0.05;
    const outputCost = (usage.completion_tokens / 1000000) * 0.10;
    const totalCost = inputCost + outputCost;

    // Try to parse as JSON with better error handling
    let parsedResponse;
    try {
      // First try direct parsing
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      // Try to extract and fix JSON if it's partially valid
      try {
        // Look for JSON object patterns
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const jsonStr = jsonMatch[0];
          // Try to fix common issues
          const fixedJson = jsonStr
            .replace(/[\r\n]+/g, ' ')  // Replace newlines with spaces
            .replace(/,\s*}/g, '}')     // Remove trailing commas before }
            .replace(/,\s*]/g, ']');    // Remove trailing commas before ]

          parsedResponse = JSON.parse(fixedJson);
        } else {
          // If no JSON found, return raw response
          console.warn('⚠️ No valid JSON found in response, using raw text');
          parsedResponse = { raw: aiResponse };
        }
      } catch (fixError) {
        console.warn('⚠️ Failed to parse JSON response:', fixError.message);
        // Return as raw text with preview
        parsedResponse = {
          raw: aiResponse,
          parsingError: fixError.message,
          responseLength: aiResponse.length
        };
      }
    }

    return res.json({
      success: true,
      response: parsedResponse,
      model: process.env.GROQ_RERANK_MODEL || 'llama-3.2-3b-preview',
      provider: 'groq-ai',
      tokens: {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens
      },
      cost: {
        input: inputCost.toFixed(6),
        output: outputCost.toFixed(6),
        total: totalCost.toFixed(6)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Prompt test error:', error);
    return res.status(500).json({
      error: 'Failed to test prompt',
      details: error.message
    });
  }
});

// Helper function to calculate text similarity (Jaccard similarity)
function calculateTextSimilarity(text1, text2) {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

// Groq-only reranking (skip score fusion, use LLM for ranking)
async function handleGroqOnlyReranking(req, res, query, limit, filters) {
  const startTime = Date.now();

  try {
    console.log(`\n🤖 GROQ-ONLY RERANKING MODE`);
    console.log(`   Query: "${query}"`);
    console.log(`   Limit: ${limit}`);
    console.log(`   Filters: ${JSON.stringify(filters)}`);

    // 1. Hybrid Search (get candidates)
    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    await mongoClient.connect();

    // Validate indexes
    const bm25Validation = await validateDbCollectionIndex(
      mongoClient,
      process.env.DB_NAME,
      process.env.COLLECTION_NAME,
      process.env.BM25_INDEX_NAME,
      true
    );

    const vectorValidation = await validateDbCollectionIndex(
      mongoClient,
      process.env.DB_NAME,
      process.env.COLLECTION_NAME,
      process.env.VECTOR_INDEX_NAME,
      true
    );

    if (!bm25Validation.ok || !vectorValidation.ok) {
      await mongoClient.close();
      return res.status(400).json({
        error: 'Search indexes not available',
        details: bm25Validation.error || vectorValidation.error
      });
    }

    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // 2. Get candidates from both BM25 and Vector (50 results)
    console.log(`📊 Fetching candidates from BM25 and Vector search...`);
    const candidateLimit = 50;

    // BM25 search
    const bm25Pipeline = [
      {
        $search: {
          index: process.env.BM25_INDEX_NAME,
          text: {
            query: query,
            path: ['id', 'title', 'description', 'steps', 'expectedResults', 'module'],
            fuzzy: { maxEdits: 1, prefixLength: 2 }
          }
        }
      },
      { $addFields: { bm25Score: { $meta: "searchScore" } } }
    ];

    // Apply filters to BM25 search
    if (Object.keys(filters).length > 0) {
      const matchConditions = {};
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== '') {
          matchConditions[key] = value;
        }
      });
      if (Object.keys(matchConditions).length > 0) {
        bm25Pipeline.push({ $match: matchConditions });
      }
    }

    bm25Pipeline.push(
      { $project: { _id: 1, id: 1, title: 1, description: 1, module: 1, priority: 1, risk: 1, steps: 1, expectedResults: 1, bm25Score: 1 } },
      { $limit: candidateLimit }
    );

    // Vector search
    const embeddingResult = await generateEmbedding(query);
    if (!embeddingResult || !embeddingResult.embedding) {
      throw new Error('Failed to generate embedding');
    }

    const vectorPipeline = [
      {
        $vectorSearch: {
          queryVector: embeddingResult.embedding,
          path: "embedding",
          numCandidates: 100,
          limit: candidateLimit,
          index: process.env.VECTOR_INDEX_NAME
        }
      },
      { $addFields: { vectorScore: { $meta: "vectorSearchScore" } } }
    ];

    // Apply filters to Vector search
    if (Object.keys(filters).length > 0) {
      const matchConditions = {};
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== '') {
          matchConditions[key] = value;
        }
      });
      if (Object.keys(matchConditions).length > 0) {
        vectorPipeline.push({ $match: matchConditions });
      }
    }

    vectorPipeline.push(
      { $project: { _id: 1, id: 1, title: 1, description: 1, module: 1, priority: 1, risk: 1, steps: 1, expectedResults: 1, vectorScore: 1 } }
    );

    // Get candidates from both
    const [bm25Results, vectorResults] = await Promise.all([
      collection.aggregate(bm25Pipeline).toArray(),
      collection.aggregate(vectorPipeline).toArray()
    ]);

    // Merge results (deduplicate)
    const candidateMap = new Map();
    [...bm25Results, ...vectorResults].forEach(doc => {
      if (!candidateMap.has(doc.id)) {
        candidateMap.set(doc.id, doc);
      }
    });

    const candidates = Array.from(candidateMap.values());
    console.log(`✅ Retrieved ${candidates.length} candidates for Groq reranking`);

    await mongoClient.close();

    // 3. Send to Groq for reranking
    console.log(`🤖 Sending ${candidates.length} candidates to Groq for semantic reranking...`);
    const groqStartTime = Date.now();

    const groqReranked = await rerankDocuments(query, candidates, limit);

    const groqTime = Date.now() - groqStartTime;
    const totalTime = Date.now() - startTime;

    console.log(`✅ Groq reranking complete in ${groqTime}ms`);

    res.json({
      success: true,
      mode: 'groq-only',
      query,
      filters,
      results: groqReranked || [],
      count: (groqReranked || []).length,
      candidatesEvaluated: candidates.length,
      timing: {
        searchTime: groqTime - (startTime),
        groqTime: groqTime,
        totalTime: totalTime
      },
      rerankModel: process.env.GROQ_RERANK_MODEL || 'groq-ai',
      model: 'mistral-embed',
      tokens: embeddingResult.usage?.total_tokens || 0,
      cost: ((embeddingResult.usage?.total_tokens || 0) / 1000000) * 0.10,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Groq-only reranking error:', error);
    res.status(500).json({
      error: 'Groq-only reranking failed',
      details: error.message
    });
  }
}

// Search vector database
app.post('/api/search', async (req, res) => {
  try {
    const { query, limit = 5, filters = {} } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Create a MongoClient, connect once, validate DB/collection/index and reuse for the search
    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });
    await mongoClient.connect();
    // Validate DB/collection/index and ensure documents exist
    const validation = await validateDbCollectionIndex(mongoClient, process.env.DB_NAME, process.env.COLLECTION_NAME, process.env.VECTOR_INDEX_NAME, true);
    if (!validation.ok) {
      try { await mongoClient.close(); } catch (e) { }
      return res.status(400).json({ error: validation.error });
    }

    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Generate embedding for query using Mistral AI
    console.log('🔄 Generating embedding with Mistral AI...');
    const embeddingResult = await generateEmbedding(query);

    if (!embeddingResult || !embeddingResult.embedding) {
      throw new Error('Failed to generate embedding with Mistral AI');
    }

    const queryVector = embeddingResult.embedding;
    const tokens = embeddingResult.usage?.total_tokens || 0;
    const cost = (tokens / 1000000) * 0.10; // Mistral pricing: $0.10 per 1M tokens

    console.log(`✅ Embedding generated! Cost: $${cost.toFixed(6)}, Tokens: ${tokens}`);

    // Calculate candidates and internal limit for vector search
    const requestedLimit = parseInt(limit);
    const numCandidates = Math.max(100, requestedLimit * 10); // At least 100 candidates
    const vectorSearchLimit = Math.min(numCandidates, requestedLimit * 10); // Limit must be <= numCandidates

    // Build vector search WITHOUT pre-filtering (to avoid index requirement)
    const vectorSearchStage = {
      $vectorSearch: {
        queryVector,
        path: "embedding",
        numCandidates: numCandidates,
        limit: vectorSearchLimit, // Get more candidates for post-filtering
        index: process.env.VECTOR_INDEX_NAME
      }
    };

    // Build the pipeline
    const pipeline = [
      vectorSearchStage,
      {
        $addFields: {
          score: { $meta: "vectorSearchScore" }
        }
      }
    ];

    // Apply metadata filters using $match stage (works without index)
    if (Object.keys(filters).length > 0) {
      const matchConditions = {};
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          matchConditions[key] = value;
        }
      });
      pipeline.push({
        $match: matchConditions
      });
      console.log('🔍 Applying filters with $match:', matchConditions);
    }

    // Add limit after filtering
    pipeline.push({
      $limit: requestedLimit
    });

    // Project fields
    pipeline.push({
      $project: {
        id: 1,
        module: 1,
        preRequisites: 1,
        title: 1,
        description: 1,
        steps: 1,
        expectedResults: 1,
        automationManual: 1,
        priority: 1,
        createdBy: 1,
        createdDate: 1,
        lastModifiedDate: 1,
        risk: 1,
        version: 1,
        type: 1,
        sourceFile: 1,
        createdAt: 1,
        score: 1
      }
    });

    console.log('🔍 Search Query:', query);
    console.log('🔍 Filters:', JSON.stringify(filters));
    console.log('🔍 Pipeline:', JSON.stringify(pipeline, null, 2));

    const results = await collection.aggregate(pipeline).toArray();
    console.log('✅ Found results:', results.length);

    await mongoClient.close();

    const responseData = {
      success: true,
      query,
      filters,
      results,
      cost: cost,
      tokens: tokens,
      model: 'mistral-embed'
    };

    console.log('📤 Sending response with', results.length, 'results');
    res.json(responseData);

  } catch (error) {
    console.error('❌ Search failed:', error.message);
    console.error('Error details:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

// ======================== BM25 Search Endpoint ========================
app.post('/api/search/bm25', async (req, res) => {
  try {
    const { query, limit = 10, filters = {}, fields = ['id', 'title', 'description', 'steps', 'expectedResults', 'module'] } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`🔤 BM25 Search request: "${query}"`);
    console.log(`   Limit: ${limit}`);
    console.log(`   Filters:`, filters);

    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    await mongoClient.connect();

    const validation = await validateDbCollectionIndex(
      mongoClient,
      process.env.DB_NAME,
      process.env.COLLECTION_NAME,
      process.env.BM25_INDEX_NAME,
      true
    );

    if (!validation.ok) {
      try { await mongoClient.close(); } catch (e) { }
      return res.status(400).json({ error: validation.error });
    }

    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Build BM25 search pipeline
    const pipeline = [
      {
        $search: {
          index: process.env.BM25_INDEX_NAME,
          text: {
            query: query,
            path: fields,
            fuzzy: {
              maxEdits: 1,
              prefixLength: 2
            }
          }
        }
      },
      {
        $addFields: {
          score: { $meta: "searchScore" }
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
          priority: 1,
          risk: 1,
          automationManual: 1,
          sourceFile: 1,
          createdAt: 1,
          score: 1
        }
      },
      { $limit: parseInt(limit) }
    );

    console.log('🔍 BM25 Pipeline:', JSON.stringify(pipeline, null, 2));

    const startTime = Date.now();
    const results = await collection.aggregate(pipeline).toArray();
    const searchTime = Date.now() - startTime;

    await mongoClient.close();

    console.log(`✅ BM25 Search complete: ${results.length} results in ${searchTime}ms`);

    res.json({
      success: true,
      searchType: 'bm25',
      query,
      filters,
      results,
      count: results.length,
      searchTime,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ BM25 Search error:', error);
    res.status(500).json({
      error: 'BM25 search failed',
      details: error.message
    });
  }
});

// ======================== Hybrid Search Endpoint (BM25 + Vector) ========================
app.post('/api/search/hybrid', async (req, res) => {
  try {
    const {
      query,
      limit = 10,
      filters = {},
      bm25Weight = 0.5,
      vectorWeight = 0.5,
      bm25Fields = ['id', 'title', 'description', 'steps', 'expectedResults', 'module']
    } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`🔀 Hybrid Search request: "${query}"`);
    console.log(`   BM25 Weight: ${bm25Weight}, Vector Weight: ${vectorWeight}`);

    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    await mongoClient.connect();

    // Validate both indexes exist
    const bm25Validation = await validateDbCollectionIndex(
      mongoClient,
      process.env.DB_NAME,
      process.env.COLLECTION_NAME,
      process.env.BM25_INDEX_NAME,
      true
    );

    const vectorValidation = await validateDbCollectionIndex(
      mongoClient,
      process.env.DB_NAME,
      process.env.COLLECTION_NAME,
      process.env.VECTOR_INDEX_NAME,
      true
    );

    if (!bm25Validation.ok) {
      await mongoClient.close();
      return res.status(400).json({ error: `BM25 Index: ${bm25Validation.error}` });
    }

    if (!vectorValidation.ok) {
      await mongoClient.close();
      return res.status(400).json({ error: `Vector Index: ${vectorValidation.error}` });
    }

    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    const searchLimit = parseInt(limit) * 3; // Get more for better combination

    // 1. BM25 Search
    console.log('🔤 Running BM25 search...');
    const bm25StartTime = Date.now();

    const bm25Pipeline = [
      {
        $search: {
          index: process.env.BM25_INDEX_NAME,
          text: {
            query: query,
            path: bm25Fields,
            fuzzy: {
              maxEdits: 1,
              prefixLength: 2
            }
          }
        }
      },
      {
        $addFields: {
          bm25Score: { $meta: "searchScore" }
        }
      },
      {
        $project: {
          _id: 1,
          id: 1,
          module: 1,
          title: 1,
          description: 1,
          steps: 1,
          expectedResults: 1,
          priority: 1,
          risk: 1,
          automationManual: 1,
          sourceFile: 1,
          createdAt: 1,
          bm25Score: 1
        }
      },
      { $limit: searchLimit }
    ];

    const bm25Results = await collection.aggregate(bm25Pipeline).toArray();
    const bm25Time = Date.now() - bm25StartTime;

    // 2. Vector Search with Mistral AI
    console.log('🧠 Running vector search with Mistral AI...');
    const vectorStartTime = Date.now();

    const embeddingResult = await generateEmbedding(query);

    if (!embeddingResult || !embeddingResult.embedding) {
      throw new Error('Failed to generate embedding with Mistral AI');
    }

    const queryVector = embeddingResult.embedding;
    const tokens = embeddingResult.usage?.total_tokens || 0;
    const embeddingCost = (tokens / 1000000) * 0.10;

    const vectorNumCandidates = Math.max(searchLimit * 2, 200);

    const vectorPipeline = [
      {
        $vectorSearch: {
          queryVector,
          path: "embedding",
          numCandidates: vectorNumCandidates,
          limit: searchLimit,
          index: process.env.VECTOR_INDEX_NAME
        }
      },
      {
        $addFields: {
          vectorScore: { $meta: "vectorSearchScore" }
        }
      },
      {
        $project: {
          _id: 1,
          id: 1,
          module: 1,
          title: 1,
          description: 1,
          steps: 1,
          expectedResults: 1,
          priority: 1,
          risk: 1,
          automationManual: 1,
          sourceFile: 1,
          createdAt: 1,
          vectorScore: 1
        }
      }
    ];

    const vectorResults = await collection.aggregate(vectorPipeline).toArray();
    const vectorTime = Date.now() - vectorStartTime;

    // 3. Normalize and combine scores
    console.log('🔀 Combining results...');

    // Normalize BM25 scores
    const bm25Scores = bm25Results.map(r => r.bm25Score);
    const bm25Max = Math.max(...bm25Scores, 1);
    const bm25Min = Math.min(...bm25Scores, 0);
    const bm25Range = bm25Max - bm25Min || 1;

    // Normalize Vector scores
    const vectorScores = vectorResults.map(r => r.vectorScore);
    const vectorMax = Math.max(...vectorScores, 1);
    const vectorMin = Math.min(...vectorScores, 0);
    const vectorRange = vectorMax - vectorMin || 1;

    // Create result map
    const resultMap = new Map();

    // Add BM25 results with normalized scores
    bm25Results.forEach(result => {
      const key = result._id.toString();
      const normalizedScore = (result.bm25Score - bm25Min) / bm25Range;
      resultMap.set(key, {
        ...result,
        bm25ScoreNormalized: normalizedScore,
        vectorScore: 0,
        vectorScoreNormalized: 0,
        hybridScore: normalizedScore * bm25Weight,
        foundIn: 'bm25'
      });
    });

    // Add/merge vector results with normalized scores
    vectorResults.forEach(result => {
      const key = result._id.toString();
      const normalizedScore = (result.vectorScore - vectorMin) / vectorRange;

      if (resultMap.has(key)) {
        // Merge - found in both
        const existing = resultMap.get(key);
        existing.vectorScore = result.vectorScore;
        existing.vectorScoreNormalized = normalizedScore;
        existing.hybridScore += normalizedScore * vectorWeight;
        existing.foundIn = 'both';
      } else {
        // New result - only in vector
        resultMap.set(key, {
          ...result,
          bm25Score: 0,
          bm25ScoreNormalized: 0,
          vectorScoreNormalized: normalizedScore,
          hybridScore: normalizedScore * vectorWeight,
          foundIn: 'vector'
        });
      }
    });

    // Convert to array and sort by hybrid score
    let combinedResults = Array.from(resultMap.values());
    combinedResults.sort((a, b) => b.hybridScore - a.hybridScore);

    // Apply filters if provided
    if (Object.keys(filters).length > 0) {
      combinedResults = combinedResults.filter(result => {
        return Object.entries(filters).every(([key, value]) => {
          if (!value || value === '') return true;
          return result[key] === value;
        });
      });
    }

    // Limit results
    const finalResults = combinedResults.slice(0, parseInt(limit));

    await mongoClient.close();

    const totalTime = Date.now() - bm25StartTime;
    console.log(`✅ Hybrid Search complete: ${finalResults.length} results in ${totalTime}ms`);

    // Calculate statistics
    const bothCount = finalResults.filter(r => r.foundIn === 'both').length;
    const bm25OnlyCount = finalResults.filter(r => r.foundIn === 'bm25').length;
    const vectorOnlyCount = finalResults.filter(r => r.foundIn === 'vector').length;

    res.json({
      success: true,
      searchType: 'hybrid',
      query,
      filters,
      weights: { bm25: bm25Weight, vector: vectorWeight },
      results: finalResults,
      count: finalResults.length,
      stats: {
        foundInBoth: bothCount,
        foundInBm25Only: bm25OnlyCount,
        foundInVectorOnly: vectorOnlyCount,
        bm25ResultCount: bm25Results.length,
        vectorResultCount: vectorResults.length
      },
      timing: {
        bm25Time,
        vectorTime,
        totalTime
      },
      cost: embeddingCost,
      tokens: tokens,
      model: 'mistral-embed',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Hybrid Search error:', error);
    res.status(500).json({
      error: 'Hybrid search failed',
      details: error.message
    });
  }
});

// Reranking endpoint - Uses Groq AI for semantic reranking (best quality)
app.post('/api/search/rerank', async (req, res) => {
  try {
    const {
      query,
      limit = 5,
      filters = {},
      rerankTopK = 10
    } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Check if Groq API is configured
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
      return res.status(400).json({
        error: 'Groq API Key not configured',
        hint: 'Add GROQ_API_KEY to your .env file. Get a free key at: https://console.groq.com'
      });
    }

    return handleGroqOnlyReranking(req, res, query, limit, filters);

  } catch (error) {
    console.error('❌ Reranking error:', error);
    res.status(500).json({
      error: 'Reranking failed',
      details: error.message
    });
  }
});

// Get the latest test case ID from the database
app.get('/api/testcases/latest-id', async (req, res) => {
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
    });

    await mongoClient.connect();
    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Find the highest numeric test case ID
    const testCases = await collection.find({}, { projection: { id: 1 } }).toArray();

    let maxId = 0;
    testCases.forEach(tc => {
      if (tc.id) {
        // Extract numeric part from TC_XXXX format
        const match = tc.id.match(/TC_(\d+)/);
        if (match) {
          const numId = parseInt(match[1], 10);
          if (numId > maxId) {
            maxId = numId;
          }
        }
      }
    });

    await mongoClient.close();

    res.json({
      success: true,
      latestId: maxId,
      nextId: maxId + 1,
      nextTestCaseId: `TC_${String(maxId + 1).padStart(4, '0')}`,
      totalTestCases: testCases.length
    });

  } catch (error) {
    console.error('❌ Error fetching latest test case ID:', error);
    res.status(500).json({
      error: 'Failed to fetch latest test case ID',
      details: error.message
    });
  }
});

// ======================== User Stories Hybrid Search Endpoint ========================
// Searches the user_stories collection using BM25 + Vector hybrid search
// Computes impact reason and regression risk for each retrieved story
app.post('/api/search/user-stories', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      query,
      limit = 10,
      filters = {},
      bm25Weight = 0.4,
      vectorWeight = 0.6
    } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const usCollectionName = process.env.USER_STORIES_COLLECTION_NAME;
    const usVectorIndex = process.env.USER_STORIES_VECTOR_INDEX_NAME;
    const usBm25Index = process.env.USER_STORIES_BM25_INDEX_NAME;

    if (!usCollectionName || !usVectorIndex) {
      return res.status(400).json({
        error: 'USER_STORIES_COLLECTION_NAME and USER_STORIES_VECTOR_INDEX_NAME must be set in .env'
      });
    }

    console.log(`\n📖 User Stories Hybrid Search`);
    console.log(`   Query: "${query}"`);
    console.log(`   Collection: ${usCollectionName}`);
    console.log(`   Vector Index: ${usVectorIndex}`);
    console.log(`   BM25 Index: ${usBm25Index || 'not configured – vector-only mode'}`);

    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    await mongoClient.connect();

    // Validate collection exists and has documents
    const collectionValidation = await validateDbCollectionIndex(
      mongoClient,
      process.env.DB_NAME,
      usCollectionName,
      null,   // index check done separately below
      true
    );

    if (!collectionValidation.ok) {
      await mongoClient.close();
      return res.status(400).json({ error: collectionValidation.error });
    }

    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(usCollectionName);
    const searchLimit = parseInt(limit) * 3;

    // ── 1. Vector Search ──────────────────────────────────────────────────────
    console.log('🧠 Running vector search on user_stories...');
    const vectorStart = Date.now();

    const embeddingResult = await generateEmbedding(query);
    if (!embeddingResult || !embeddingResult.embedding) {
      throw new Error('Failed to generate embedding');
    }

    const vectorPipeline = [
      {
        $vectorSearch: {
          queryVector: embeddingResult.embedding,
          path: 'embedding',
          numCandidates: Math.max(searchLimit * 2, 100),
          limit: searchLimit,
          index: usVectorIndex
        }
      },
      { $addFields: { vectorScore: { $meta: 'vectorSearchScore' } } },
      {
        $project: {
          _id: 1,
          key: 1,
          storyId: 1,
          summary: 1,
          description: 1,
          status: 1,
          priority: 1,
          components: 1,
          labels: 1,
          fixVersions: 1,
          epic: 1,
          sprint: 1,
          team: 1,
          acceptanceCriteria: 1,
          dependencies: 1,
          notes: 1,
          module: 1,
          vectorScore: 1
        }
      }
    ];

    const vectorResults = await collection.aggregate(vectorPipeline).toArray();
    const vectorTime = Date.now() - vectorStart;
    console.log(`✅ Vector search: ${vectorResults.length} results in ${vectorTime}ms`);

    // ── 2. BM25 Search (graceful fallback if index missing) ─────────────────
    let bm25Results = [];
    let bm25Time = 0;
    let bm25Available = false;

    if (usBm25Index) {
      try {
        console.log('🔤 Running BM25 search on user_stories...');
        const bm25Start = Date.now();

        const bm25Pipeline = [
          {
            $search: {
              index: usBm25Index,
              text: {
                query,
                path: ['summary', 'description', 'acceptanceCriteria', 'key'],
                fuzzy: { maxEdits: 1, prefixLength: 2 }
              }
            }
          },
          { $addFields: { bm25Score: { $meta: 'searchScore' } } },
          {
            $project: {
              _id: 1,
              key: 1,
              storyId: 1,
              summary: 1,
              description: 1,
              status: 1,
              priority: 1,
              components: 1,
              labels: 1,
              fixVersions: 1,
              epic: 1,
              sprint: 1,
              team: 1,
              acceptanceCriteria: 1,
              dependencies: 1,
              notes: 1,
              module: 1,
              bm25Score: 1
            }
          },
          { $limit: searchLimit }
        ];

        bm25Results = await collection.aggregate(bm25Pipeline).toArray();
        bm25Time = Date.now() - bm25Start;
        bm25Available = true;
        console.log(`✅ BM25 search: ${bm25Results.length} results in ${bm25Time}ms`);
      } catch (bm25Err) {
        console.warn(`⚠️ BM25 search on user_stories failed (index may not exist): ${bm25Err.message}`);
        console.warn('   Falling back to vector-only mode');
      }
    }

    // ── 3. Score Normalisation & Hybrid Fusion ───────────────────────────────
    const vectorScores = vectorResults.map(r => r.vectorScore);
    const vectorMax = Math.max(...vectorScores, 1);
    const vectorMin = Math.min(...vectorScores, 0);
    const vectorRange = vectorMax - vectorMin || 1;

    const resultMap = new Map();

    // Seed map with vector results
    vectorResults.forEach(doc => {
      const key = doc._id.toString();
      const normVector = (doc.vectorScore - vectorMin) / vectorRange;
      resultMap.set(key, {
        ...doc,
        vectorScoreNormalized: normVector,
        bm25ScoreNormalized: 0,
        hybridScore: normVector * vectorWeight,
        foundIn: 'vector'
      });
    });

    if (bm25Available && bm25Results.length > 0) {
      const bm25Scores = bm25Results.map(r => r.bm25Score);
      const bm25Max = Math.max(...bm25Scores, 1);
      const bm25Min = Math.min(...bm25Scores, 0);
      const bm25Range = bm25Max - bm25Min || 1;

      bm25Results.forEach(doc => {
        const key = doc._id.toString();
        const normBm25 = (doc.bm25Score - bm25Min) / bm25Range;

        if (resultMap.has(key)) {
          const existing = resultMap.get(key);
          existing.bm25ScoreNormalized = normBm25;
          existing.hybridScore += normBm25 * bm25Weight;
          existing.foundIn = 'both';
        } else {
          resultMap.set(key, {
            ...doc,
            vectorScoreNormalized: 0,
            bm25ScoreNormalized: normBm25,
            hybridScore: normBm25 * bm25Weight,
            foundIn: 'bm25'
          });
        }
      });
    }

    // ── 4. Sort, Filter, Deduplicate ─────────────────────────────────────────
    let combined = Array.from(resultMap.values());
    combined.sort((a, b) => b.hybridScore - a.hybridScore);

    // Apply optional filters
    if (Object.keys(filters).length > 0) {
      combined = combined.filter(doc =>
        Object.entries(filters).every(([k, v]) => !v || doc[k] === v)
      );
    }

    // Deduplicate by story key/id
    const seenKeys = new Set();
    combined = combined.filter(doc => {
      const storyKey = doc.key || doc.storyId || doc._id.toString();
      if (seenKeys.has(storyKey)) return false;
      seenKeys.add(storyKey);
      return true;
    });

    const finalResults = combined.slice(0, parseInt(limit));

    await mongoClient.close();

    // ── 5. Compute Impact Reason & Regression Risk per story ─────────────────
    const enrichedResults = finalResults.map(doc => {
      const score = doc.hybridScore;

      // Regression risk tier
      let regressionRisk = 'Low';
      if (score >= 0.80) regressionRisk = 'High';
      else if (score >= 0.60) regressionRisk = 'Medium';

      // Rule-based impact reason
      const reasons = [];

      if (score >= 0.80) {
        reasons.push('High functional similarity — directly related feature');
      } else if (score >= 0.60) {
        reasons.push('Related workflow or business flow');
      } else {
        reasons.push('Potentially impacted via shared functionality');
      }

      const docComponents = Array.isArray(doc.components) ? doc.components : [];
      const docLabels = Array.isArray(doc.labels) ? doc.labels : [];

      if (docComponents.length > 0) {
        reasons.push(`Shared component(s): ${docComponents.slice(0, 3).join(', ')}`);
      }
      if (docLabels.length > 0) {
        reasons.push(`Common label(s): ${docLabels.slice(0, 3).join(', ')}`);
      }
      if (doc.epic) {
        reasons.push(`Same epic/feature area: ${doc.epic}`);
      }
      if (doc.dependencies) {
        reasons.push(`Dependency: ${String(doc.dependencies).substring(0, 80)}`);
      }

      return {
        storyId: doc.key || doc.storyId || doc._id.toString(),
        title: doc.summary || 'Untitled User Story',
        description: doc.description || '',
        module: doc.module || doc.epic || 'General',
        status: typeof doc.status === 'object' ? (doc.status?.name || '') : (doc.status || ''),
        priority: typeof doc.priority === 'object' ? (doc.priority?.name || '') : (doc.priority || ''),
        components: docComponents,
        labels: docLabels,
        sprint: doc.sprint || null,
        team: doc.team || null,
        acceptanceCriteria: doc.acceptanceCriteria || '',
        dependencies: doc.dependencies || '',
        hybridScore: parseFloat(score.toFixed(4)),
        vectorScore: parseFloat((doc.vectorScoreNormalized || 0).toFixed(4)),
        bm25Score: parseFloat((doc.bm25ScoreNormalized || 0).toFixed(4)),
        foundIn: doc.foundIn,
        impactReason: reasons.join(' | '),
        regressionRisk,
        isHighRisk: regressionRisk === 'High'
      };
    });

    const totalTime = Date.now() - startTime;
    const tokens = embeddingResult.usage?.total_tokens || 0;
    const cost = (tokens / 1000000) * 0.10;

    console.log(`✅ User Stories search complete: ${enrichedResults.length} results in ${totalTime}ms`);

    res.json({
      success: true,
      query,
      filters,
      results: enrichedResults,
      count: enrichedResults.length,
      searchMode: bm25Available ? 'hybrid' : 'vector-only',
      stats: {
        vectorResultCount: vectorResults.length,
        bm25ResultCount: bm25Results.length,
        bm25Available,
        highRiskCount: enrichedResults.filter(r => r.regressionRisk === 'High').length,
        mediumRiskCount: enrichedResults.filter(r => r.regressionRisk === 'Medium').length
      },
      timing: { vectorTime, bm25Time, totalTime },
      tokens,
      cost,
      model: 'mistral-embed',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ User stories search error:', error);
    res.status(500).json({
      error: 'User stories search failed',
      details: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
});