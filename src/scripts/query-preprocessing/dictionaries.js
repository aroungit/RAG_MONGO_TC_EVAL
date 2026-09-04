/**
 * Healthcare Domain Dictionaries
 * Abbreviations and Synonyms for Query Preprocessing
 */

// Healthcare and Test Case Abbreviations
export const abbreviationMap = {
  // Healthcare IDs
  "uhid": "unique health id",
  "mrn": "medical record number",
  "pid": "patient identification",
  
  // Department/Location
  "op": "outpatient",
  "ip": "inpatient",
  "opd": "outpatient department",
  "ipd": "inpatient department",
  "er": "emergency room",
  "icu": "intensive care unit",
  "ot": "operation theater",
  "ccu": "critical care unit",
  "nicu": "neonatal intensive care unit",
  
  // Authentication/Security
  "otp": "one time password",
  "pwd": "password",
  "2fa": "two factor authentication",
  
  // Medical Terms
  "bp": "blood pressure",
  "hr": "heart rate",
  "rr": "respiratory rate",
  "temp": "temperature",
  "wt": "weight",
  "ht": "height",
  "bmi": "body mass index",
  
  // Prescription/Treatment
  "rx": "prescription",
  "dx": "diagnosis",
  "hx": "history",
  "sx": "symptoms",
  "tx": "treatment",
  
  // Time/Date
  "dob": "date of birth",
  "doa": "date of admission",
  "dod": "date of discharge",
  "doe": "date of expiry",
  
  // Document/Test Types
  "lab": "laboratory",
  "rad": "radiology",
  "xray": "x ray",
  "ct": "computed tomography",
  "mri": "magnetic resonance imaging",
  "ecg": "electrocardiogram",
  "echo": "echocardiogram",
  
  // Healthcare System
  "emr": "electronic medical record",
  "ehr": "electronic health record",
  "hc": "healthcare",
  "hms": "hospital management system",
  "his": "hospital information system",
  
  // Testing
  "tc": "test case",
  "qa": "quality assurance",
  "uat": "user acceptance testing",
  
  // Discharge
  "dc": "discharge",
  "dama": "discharge against medical advice",
  
  // Insurance
  "ins": "insurance",
  "preauth": "pre authorization",
  
  // Pharmacy
  "pharm": "pharmacy",
  "med": "medication",
  "drug": "medication"
};

// Healthcare Domain Synonyms
export const synonymMap = {
  // Person/Role
  "patient": ["customer", "user", "individual", "person", "client"],
  "doctor": ["physician", "consultant", "medical officer", "provider", "clinician"],
  "nurse": ["nursing staff", "caregiver", "attendant"],
  "staff": ["employee", "personnel", "worker"],
  
  // Actions - Create/Add
  "create": ["add", "insert", "register", "new", "setup", "initiate"],
  "register": ["signup", "enroll", "create", "add"],
  "add": ["create", "insert", "append", "include"],
  
  // Actions - Update/Modify
  "update": ["modify", "edit", "change", "revise", "alter"],
  "modify": ["update", "edit", "change", "alter"],
  "edit": ["update", "modify", "change"],
  
  // Actions - Delete/Remove
  "delete": ["remove", "cancel", "discard", "erase"],
  "remove": ["delete", "cancel", "discard"],
  "cancel": ["delete", "remove", "abort", "terminate"],
  
  // Actions - Search/Find
  "search": ["find", "lookup", "query", "retrieve", "fetch"],
  "find": ["search", "lookup", "locate", "retrieve"],
  "lookup": ["search", "find", "query"],
  
  // Actions - Verify/Check
  "verify": ["validate", "check", "confirm", "ensure", "test"],
  "validate": ["verify", "check", "confirm", "ensure"],
  "check": ["verify", "validate", "test", "inspect"],
  
  // Actions - Merge/Combine
  "merge": ["combine", "join", "unite", "consolidate", "integrate"],
  "combine": ["merge", "join", "unite"],
  
  // Actions - View/Display
  "view": ["display", "show", "see", "preview"],
  "display": ["view", "show", "render"],
  
  // Medical Processes
  "registration": ["signup", "enrollment", "admission"],
  "appointment": ["booking", "scheduling", "meeting", "consultation"],
  "consultation": ["appointment", "visit", "examination"],
  "admission": ["checkin", "registration", "enrollment"],
  "discharge": ["release", "checkout", "exit", "departure"],
  
  // Medical Services
  "billing": ["invoice", "payment", "charges", "fees"],
  "payment": ["billing", "invoice", "transaction", "settlement"],
  "lab": ["laboratory", "test center", "diagnostic center"],
  "prescription": ["medication", "drug list", "medicines", "rx"],
  "medication": ["prescription", "drug", "medicine", "remedy"],
  
  // Authentication
  "login": ["signin", "authenticate", "access", "logon"],
  "logout": ["signout", "exit", "logoff"],
  "password": ["credential", "passphrase", "passcode"],
  "reset": ["change", "update", "modify", "restore"],
  
  // Records/Documents
  "record": ["document", "file", "report", "entry"],
  "report": ["document", "record", "summary", "analysis"],
  "history": ["record", "log", "past data"],
  
  // Status/State
  "active": ["enabled", "running", "operational", "live"],
  "inactive": ["disabled", "stopped", "suspended"],
  "pending": ["waiting", "queued", "scheduled"],
  "completed": ["finished", "done", "closed"],
  
  // Healthcare Specific
  "diagnosis": ["condition", "disease", "disorder", "illness"],
  "symptom": ["sign", "indication", "manifestation"],
  "treatment": ["therapy", "care", "remedy", "procedure"],
  "test": ["examination", "investigation", "analysis", "screening"],
  
  // Locations
  "ward": ["unit", "department", "section"],
  "room": ["bed", "accommodation", "facility"],
  "pharmacy": ["drugstore", "dispensary"],
  
  // Time
  "schedule": ["timing", "calendar", "plan", "agenda"],
  "date": ["day", "time", "datetime"],
  
  // Emergency
  "emergency": ["urgent", "critical", "immediate"],
  "urgent": ["emergency", "critical", "immediate", "priority"],
  
  // General
  "issue": ["problem", "error", "bug", "defect"],
  "error": ["issue", "problem", "failure", "bug"],
  "working": ["functioning", "operational", "running"],
  "not working": ["failing", "broken", "malfunctioning", "down"]
};

// Context-specific phrase expansions (multi-word)
export const phraseMap = {
  "password reset": ["forgot password", "otp reset", "credential reset", "reset password"],
  "forgot password": ["password reset", "otp reset", "credential reset"],
  "patient registration": ["patient signup", "patient enrollment", "patient admission"],
  "doctor consultation": ["physician appointment", "medical consultation", "doctor visit"],
  "lab test": ["laboratory investigation", "diagnostic test", "lab examination"],
  "bed allocation": ["bed assignment", "room allocation", "patient accommodation"],
  "discharge summary": ["discharge report", "exit summary", "discharge document"]
};

// Stop words to preserve (medical context matters)
export const preservedStopWords = [
  "not", "no", "without", "unable", "cannot", "failed", "error"
];

// Common test case prefixes/patterns
export const testCasePrefixes = [
  "tc", "test case", "testcase", "test", "case"
];
