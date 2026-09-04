import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Jira configuration from environment variables
const JIRA_CONFIG = {
    baseURL: process.env.JIRA_BASE_URL,
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
    projectKey: process.env.JIRA_PROJECT_KEY
};

// Validate configuration
if (!JIRA_CONFIG.baseURL || !JIRA_CONFIG.email || !JIRA_CONFIG.apiToken || !JIRA_CONFIG.projectKey) {
    console.error('❌ Missing Jira configuration in .env file');
    console.error('Required variables: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY');
    process.exit(1);
}

// Create axios instance with authentication
const jiraApi = axios.create({
    baseURL: `${JIRA_CONFIG.baseURL}/rest/api/3`,
    auth: {
        username: JIRA_CONFIG.email,
        password: JIRA_CONFIG.apiToken
    },
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }
});

/**
 * Fetch user stories from Jira
 * @param {string} projectKey - Jira project key
 * @param {number} maxResults - Maximum number of results to fetch
 * @returns {Array} Array of user stories
 */
async function fetchUserStories(projectKey, maxResults = 100) {
    try {
        console.log(`🔍 Fetching user stories from project: ${projectKey}...`);
        
        // JQL query to get user stories (Story issue type)
        const jql = `project = ${projectKey} AND issuetype = Story ORDER BY created DESC`;
        
        const response = await jiraApi.get('/search/jql', {
            params: {
                jql: jql,
                maxResults: maxResults,
                fields: [
                    'key',
                    'summary',
                    'description',
                    'status',
                    'priority',
                    'assignee',
                    'reporter',
                    'created',
                    'updated',
                    'components',
                    'labels',
                    'fixVersions',
                    'customfield_10016', // Story Points (may vary)
                    'issuelinks'
                ].join(',')
            }
        });

        console.log(`✅ Found ${response.data.total} user stories`);
        return response.data.issues;
    } catch (error) {
        console.error('❌ Error fetching user stories:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Transform Jira issue to a clean format
 * @param {Object} issue - Jira issue object
 * @returns {Object} Cleaned user story object
 */
function transformUserStory(issue) {
    return {
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description?.content?.[0]?.content?.[0]?.text || 
                    issue.fields.description || 
                    'No description available',
        status: {
            name: issue.fields.status.name,
            category: issue.fields.status.statusCategory.name
        },
        priority: {
            name: issue.fields.priority?.name || 'None',
            id: issue.fields.priority?.id || null
        },
        assignee: issue.fields.assignee ? {
            displayName: issue.fields.assignee.displayName,
            emailAddress: issue.fields.assignee.emailAddress,
            accountId: issue.fields.assignee.accountId
        } : null,
        reporter: issue.fields.reporter ? {
            displayName: issue.fields.reporter.displayName,
            emailAddress: issue.fields.reporter.emailAddress,
            accountId: issue.fields.reporter.accountId
        } : null,
        created: issue.fields.created,
        updated: issue.fields.updated,
        components: issue.fields.components?.map(comp => comp.name) || [],
        labels: issue.fields.labels || [],
        fixVersions: issue.fields.fixVersions?.map(version => version.name) || [],
        storyPoints: issue.fields.customfield_10016 || null,
        issueLinks: issue.fields.issuelinks?.map(link => ({
            type: link.type.name,
            direction: link.type.inward || link.type.outward,
            linkedIssue: link.inwardIssue?.key || link.outwardIssue?.key
        })) || [],
        url: `${JIRA_CONFIG.baseURL}/browse/${issue.key}`
    };
}

/**
 * Save user stories to JSON file
 * @param {Array} userStories - Array of user stories
 * @param {string} filename - Output filename
 */
function saveToJSON(userStories, filename) {
    try {
        // Ensure data directory exists
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            console.log('📁 Created data directory');
        }

        const filePath = path.join(dataDir, filename);
        
        // Create metadata
        const output = {
            metadata: {
                projectKey: JIRA_CONFIG.projectKey,
                totalStories: userStories.length,
                fetchedAt: new Date().toISOString(),
                jiraBaseUrl: JIRA_CONFIG.baseURL
            },
            userStories: userStories
        };

        fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
        console.log(`💾 Saved ${userStories.length} user stories to: ${filePath}`);
        
        return filePath;
    } catch (error) {
        console.error('❌ Error saving to JSON:', error.message);
        throw error;
    }
}

/**
 * Main function to orchestrate the process
 */
async function main() {
    try {
        console.log('🚀 Starting Jira user stories extraction...');
        console.log(`📊 Project: ${JIRA_CONFIG.projectKey}`);
        console.log(`🔗 Jira URL: ${JIRA_CONFIG.baseURL}`);
        
        // Fetch user stories
        const rawUserStories = await fetchUserStories(JIRA_CONFIG.projectKey);
        
        // Transform the data
        console.log('🔄 Transforming user stories...');
        const transformedUserStories = rawUserStories.map(transformUserStory);
        
        // Save to JSON
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `jira-user-stories.json`;
        const savedPath = saveToJSON(transformedUserStories, filename);
        
        // Summary
        console.log('\n📈 Summary:');
        console.log(`   Total user stories: ${transformedUserStories.length}`);
        console.log(`   File saved: ${savedPath}`);
        console.log(`   Project: ${JIRA_CONFIG.projectKey}`);
        
        // Show sample of statuses
        const statusCounts = transformedUserStories.reduce((acc, story) => {
            acc[story.status.name] = (acc[story.status.name] || 0) + 1;
            return acc;
        }, {});
        
        console.log('\n📊 Stories by status:');
        Object.entries(statusCounts).forEach(([status, count]) => {
            console.log(`   ${status}: ${count}`);
        });
        
        console.log('\n✅ Process completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Process failed:', error.message);
        process.exit(1);
    }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { fetchUserStories, transformUserStory, saveToJSON };