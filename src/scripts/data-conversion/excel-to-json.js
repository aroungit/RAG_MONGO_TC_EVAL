import xlsx from "xlsx";
import fs from "fs";

// ✅ CONFIGURATION
const excelFile = "src/data/testcases.xlsx";      
const sheetName = "testcases";   
const outputFile = "src/data/testcases.json";      

// Map Excel column headers → JSON keys
// Excel columns are already in camelCase, so we map them directly
const columnMap = {
  // Excel columns (camelCase) → JSON keys
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
  "risk": "risk",
  "version": "version",
  "type": "type",
  "linkedStories": "linkedStories",
  
  // Also support old capitalized column names (fallback)
  "Module": "module",
  "Test ID": "id",
  "Pre-Requisites": "preRequisites",
  "Test Title": "title",
  "Test Case Description": "description",
  "Test Steps": "steps",
  "Expected Results": "expectedResults",
  "Automation/Manual": "automationManual",
  "Priority": "priority",
  "Created By": "createdBy",
  "Created Date": "createdDate",
  "Last modified date": "lastModifiedDate",
  "Risk": "risk",
  "Version": "version",
  "Type": "type"
};

// ✅ LOAD EXCEL FILE
const workbook = xlsx.readFile(excelFile);
const worksheet = workbook.Sheets[sheetName];

if (!worksheet) {
  console.error(`❌ Sheet "${sheetName}" not found in ${excelFile}`);
  process.exit(1);
}

// Convert sheet to JSON
const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

// ✅ TRANSFORM USING columnMap
const jsonData = rawData.map((row, index) => {
  const mappedRow = {};
  for (const [excelCol, jsonKey] of Object.entries(columnMap)) {
    // Only map if the column exists in the Excel row
    if (row.hasOwnProperty(excelCol) && row[excelCol]) {
      mappedRow[jsonKey] = row[excelCol];
    } else if (!mappedRow[jsonKey]) {
      // Set default empty string only if not already set
      mappedRow[jsonKey] = "";
    }
  }
  return mappedRow;
});

// ✅ WRITE TO FILE
fs.writeFileSync(outputFile, JSON.stringify(jsonData, null, 2), "utf-8");

console.log(`✅ Converted ${jsonData.length} rows from "${sheetName}" into ${outputFile}`);
