import xlsx from "xlsx";
import fs from "fs";

// ✅ CONFIGURATION
const excelFile = "src/data/userstories.xlsx";      
const sheetName = "stories";   // Update this based on your Excel sheet name
const outputFile = "src/data/stories.json";      

// Map Excel column headers → JSON keys (based on common user story fields)
const columnMap = {
  // Core user story fields - Excel already uses lowercase/camelCase
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
  
  // Status and priority
  "statusCategory": "status",
  "Status": "status",
  "Story Status": "status",
  "Issue Status": "status",
  "priority": "priority",
  "Priority": "priority",
  "Story Priority": "priority",
  "Issue Priority": "priority",
  
  // People
  "assignee": "assignee",
  "Assignee": "assignee",
  "Assigned To": "assignee",
  "reporter": "reporter",
  "Reporter": "reporter",
  "Created By": "reporter",
  
  // Dates
  "createdDate": "created",
  "Created": "created",
  "Created Date": "created",
  "Creation Date": "created",
  "updatedDate": "updated",
  "Updated": "updated",
  "Updated Date": "updated",
  "Last Modified": "updated",
  "Last Modified Date": "updated",
  
  // Project and organization
  "projectName": "project",
  "Project": "project",
  "Project Key": "project",
  "Project Name": "project",
  "parentSummary": "epic",
  "Epic": "epic",
  "Epic Link": "epic",
  "Epic Name": "epic",
  
  // Story points and estimation
  "storyPoints": "storyPoints",
  "Story Points": "storyPoints",
  "Points": "storyPoints",
  "Estimate": "storyPoints",
  "Effort": "storyPoints",
  "Story Point Estimate": "storyPoints",
  
  // Components and labels
  "components": "components",
  "Components": "components",
  "Component": "components",
  "labels": "labels",
  "Labels": "labels",
  "Tags": "labels",
  
  // Versions
  "fixVersions": "fixVersions",
  "Fix Version": "fixVersions",
  "Fix Versions": "fixVersions",
  "Target Version": "fixVersions",
  "Release": "fixVersions",
  "Version": "fixVersions",
  
  // Acceptance criteria
  "acceptanceCriteria": "acceptanceCriteria",
  "Acceptance Criteria": "acceptanceCriteria",
  "AC": "acceptanceCriteria",
  "Definition of Done": "acceptanceCriteria",
  "Acceptance": "acceptanceCriteria",
  
  // Additional fields
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
  
  // Sprint information
  "Sprint": "sprint",
  "Current Sprint": "sprint",
  "Sprint Name": "sprint",
  
  // Team information
  "Team": "team",
  "Squad": "team",
  "Development Team": "team"
};

/**
 * Transform raw Excel data to user story format
 */
function transformToUserStoryFormat(rawRow, index) {
  // First, map columns according to columnMap
  const mappedRow = {};
  for (const [excelCol, jsonKey] of Object.entries(columnMap)) {
    // Only map if the column exists in the Excel row AND has a value
    if (rawRow.hasOwnProperty(excelCol) && rawRow[excelCol]) {
      mappedRow[jsonKey] = rawRow[excelCol];
    }
  }

  // Transform to match Jira-like user stories structure
  const transformedRow = {
    // Core fields
    key: mappedRow.key || `US-${String(index + 1).padStart(3, '0')}`,
    summary: mappedRow.summary || "Untitled User Story",
    description: mappedRow.description || "No description provided",
    
    // Status object (to match Jira format)
    status: {
      name: mappedRow.status || "To Do",
      category: getStatusCategory(mappedRow.status || "To Do")
    },
    
    // Priority object (to match Jira format)
    priority: {
      name: mappedRow.priority || "Medium",
      id: getPriorityId(mappedRow.priority || "Medium")
    },
    
    // Assignee object (if provided)
    assignee: mappedRow.assignee ? {
      displayName: mappedRow.assignee,
      emailAddress: null,
      accountId: null
    } : null,
    
    // Reporter object (if provided)
    reporter: mappedRow.reporter ? {
      displayName: mappedRow.reporter,
      emailAddress: null,
      accountId: null
    } : null,
    
    // Dates (convert to ISO format if possible)
    created: formatDate(mappedRow.created) || new Date().toISOString(),
    updated: formatDate(mappedRow.updated) || new Date().toISOString(),
    
    // Arrays (handle comma-separated values)
    components: parseArrayField(mappedRow.components),
    labels: parseArrayField(mappedRow.labels),
    fixVersions: parseArrayField(mappedRow.fixVersions),
    
    // Story points (convert to number)
    storyPoints: parseFloat(mappedRow.storyPoints) || null,
    
    // Additional fields for Excel import
    project: mappedRow.project || "UNKNOWN",
    epic: mappedRow.epic || null,
    acceptanceCriteria: mappedRow.acceptanceCriteria || "",
    businessValue: mappedRow.businessValue || "",
    risk: mappedRow.risk || "",
    dependencies: mappedRow.dependencies || "",
    notes: mappedRow.notes || "",
    sprint: mappedRow.sprint || null,
    team: mappedRow.team || null,
    
    // Issue links (empty for Excel import)
    issueLinks: [],
    
    // URL (will be empty for Excel import)
    url: "",
    
    // Metadata for tracking source
    sourceType: "excel",
    importedAt: new Date().toISOString(),
    originalRowIndex: index + 1
  };

  return transformedRow;
}

/**
 * Parse comma-separated values into array
 */
function parseArrayField(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map(item => item.trim()).filter(item => item.length > 0);
}

/**
 * Map status to category (basic mapping)
 */
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

/**
 * Map priority to ID (basic mapping)
 */
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

/**
 * Format date string to ISO format
 */
function formatDate(dateString) {
  if (!dateString) return null;
  
  // Handle if it's already a Date object
  if (dateString instanceof Date) {
    return dateString.toISOString();
  }
  
  // Handle string dates
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
  
  // Handle Excel numeric dates
  if (typeof dateString === 'number') {
    try {
      // Excel dates are days since 1899-12-30
      const date = new Date((dateString - 25569) * 86400 * 1000);
      if (isNaN(date.getTime())) return null;
      return date.toISOString();
    } catch (error) {
      return null;
    }
  }
  
  return null;
}

try {
  console.log(`📖 Loading Excel file: ${excelFile}`);
  
  // ✅ LOAD EXCEL FILE
  const workbook = xlsx.readFile(excelFile);
  console.log(`📊 Available sheets: ${workbook.SheetNames.join(', ')}`);
  
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    console.error(`❌ Sheet "${sheetName}" not found in ${excelFile}`);
    console.log(`💡 Available sheets: ${workbook.SheetNames.join(', ')}`);
    console.log(`💡 Please update the 'sheetName' variable in the script to match your Excel sheet name.`);
    process.exit(1);
  }

  // Convert sheet to JSON
  console.log(`🔄 Converting sheet "${sheetName}" to JSON...`);
  const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: "" });
  console.log(`📝 Found ${rawData.length} rows in Excel`);

  // Show first row for debugging
  if (rawData.length > 0) {
    console.log(`🔍 Sample columns found:`, Object.keys(rawData[0]).slice(0, 10));
    console.log(`📋 Column mapping available for:`, Object.keys(columnMap).slice(0, 10));
  }

  // ✅ TRANSFORM USING columnMap and user story structure
  console.log(`🔧 Transforming data to user story format...`);
  const transformedData = rawData.map((row, index) => transformToUserStoryFormat(row, index));

  // Filter out completely empty rows
  const validUserStories = transformedData.filter(story => 
    story.summary && story.summary !== "Untitled User Story" && story.summary.trim() !== ""
  );

  console.log(`✅ Transformed ${transformedData.length} rows`);
  console.log(`✅ Valid user stories: ${validUserStories.length}`);
  console.log(`⚠️  Filtered out: ${transformedData.length - validUserStories.length} empty rows`);

  // ✅ WRITE TO FILE
  fs.writeFileSync(outputFile, JSON.stringify(validUserStories, null, 2), "utf-8");

  console.log(`\n🎉 SUCCESS! Converted user stories from Excel to JSON`);
  console.log(`📁 Input: ${excelFile} (sheet: "${sheetName}")`);
  console.log(`📁 Output: ${outputFile}`);
  console.log(`📊 Total user stories: ${validUserStories.length}`);

  // Show sample of converted data
  if (validUserStories.length > 0) {
    console.log(`\n📋 Sample converted user story:`);
    const sample = validUserStories[0];
    console.log(`   Key: ${sample.key}`);
    console.log(`   Summary: ${sample.summary}`);
    console.log(`   Status: ${sample.status.name}`);
    console.log(`   Priority: ${sample.priority.name}`);
    console.log(`   Story Points: ${sample.storyPoints || 'Not set'}`);
    console.log(`   Project: ${sample.project}`);
  }

  console.log(`\n💡 Next steps:`);
  console.log(`   1. Review the generated ${outputFile} file`);
  console.log(`   2. Run: node src/scripts/create-userstories-embeddings-batch.js`);
  console.log(`   3. Create vector index in MongoDB Atlas for user stories search`);

} catch (error) {
  console.error(`❌ Error processing Excel file:`, error.message);
  
  if (error.code === 'ENOENT') {
    console.log(`💡 Make sure the file exists: ${excelFile}`);
  } else if (error.message.includes('Cannot read properties')) {
    console.log(`💡 Check if the sheet name "${sheetName}" exists in your Excel file`);
  }
  
  process.exit(1);
}
