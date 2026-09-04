import React, { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Paper,
  Typography,
  Grid,
  Chip,
  Card,
  CardContent,
  Divider,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Search as SearchIcon,
  ContentCopy as ContentCopyIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
  Timeline as TimelineIcon,
  Transform as TransformIcon,
  Extension as ExtensionIcon,
  Translate as TranslateIcon
} from '@mui/icons-material';

function TabPanel({ children, value, index }) {
  return (
    <div hidden={value !== index} style={{ paddingTop: 16 }}>
      {value === index && children}
    </div>
  );
}

function QueryPreprocessing() {
  const [query, setQuery] = useState('Share Diagnostic Reports with Patients via WhatsApp');
  const [preprocessResult, setPreprocessResult] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tabValue, setTabValue] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState(null);
  
  // Options
  const [enableAbbreviations] = useState(true);
  const [enableSynonyms] = useState(true);
  const [maxVariations] = useState(5);
  const [searchType] = useState('vector'); // 'vector', 'bm25', 'hybrid'

  // Preprocess query
  const handlePreprocess = async () => {
    if (!query.trim()) {
      setError('Please enter a query');
      return;
    }

    setLoading(true);
    setError(null);
    setPreprocessResult(null);
    setSearchResults(null);

    try {
      const response = await fetch('http://localhost:3001/api/search/preprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          options: {
            enableAbbreviations,
            enableSynonyms,
            maxSynonymVariations: maxVariations
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setPreprocessResult(data);
      setTabValue(0); // Switch to results tab
    } catch (err) {
      setError(err.message);
      console.error('Preprocessing error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Search with preprocessed query
  const handleSearch = async (selectedQuery) => {
    setSearchLoading(true);
    setError(null);

    try {
      const endpoint = searchType === 'vector' 
        ? 'http://localhost:3001/api/search'
        : searchType === 'bm25'
        ? 'http://localhost:3001/api/search/bm25'
        : 'http://localhost:3001/api/search/hybrid';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: selectedQuery || preprocessResult.synonymExpanded[0],
          limit: 10
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setSearchResults(data);
      setTabValue(3); // Switch to search results tab
    } catch (err) {
      setError(err.message);
      console.error('Search error:', err);
    } finally {
      setSearchLoading(false);
    }
  };

  // Copy to clipboard
  const handleCopy = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Format score color
  const getScoreColor = (score) => {
    if (score >= 0.8) return 'success';
    if (score >= 0.6) return 'warning';
    return 'error';
  };

  // Example queries
  const exampleQueries = [
    "UHID patient login issue OTP not working",
    "TC_027 merge UHID records",
    "doctor appointment booking IP admission",
    "password reset OTP verification",
    "ER patient registration BP monitoring"
  ];

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TransformIcon color="primary" />
          Query Preprocessing & Search
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Transform your query through normalization, abbreviation expansion, and synonym generation before searching
        </Typography>
      </Box>

      {/* Input Section */}
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Enter Your Query"
              placeholder="e.g., UHID patient login issue OTP not working"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handlePreprocess()}
              variant="outlined"
              multiline
              rows={4}
              maxRows={8}
              sx={{ 
                '& .MuiOutlinedInput-root': { 
                  minWidth: '800px',
                  width: '100%'
                } 
              }}
            />
          </Grid>

          {/* Example Queries */}
          <Grid item xs={12}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Quick Examples:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {exampleQueries.map((example, index) => (
                <Chip
                  key={index}
                  label={example}
                  size="small"
                  onClick={() => setQuery(example)}
                  variant="outlined"
                />
              ))}
            </Box>
          </Grid>

          {/* Action Buttons */}
          <Grid item xs={12}>
            <Button
              variant="contained"
              color="primary"
              onClick={handlePreprocess}
              disabled={loading || !query.trim()}
              startIcon={<TransformIcon />}
              fullWidth
            >
              {loading ? 'Processing...' : 'Preprocess Query'}
            </Button>
          </Grid>
        </Grid>

        {loading && <LinearProgress sx={{ mt: 2 }} />}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Paper>

      {/* Results Section */}
      {preprocessResult && (
        <Paper elevation={2} sx={{ mb: 3 }}>
          <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
            <Tab icon={<TimelineIcon />} label="Pipeline Steps" />
            <Tab icon={<ExtensionIcon />} label="Abbreviations" />
            <Tab icon={<TranslateIcon />} label="Synonym Variations" />
          </Tabs>
          <Divider />

          {/* Tab 0: Pipeline Steps */}
          <TabPanel value={tabValue} index={0}>
            <Box sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Query Transformation Pipeline
              </Typography>

              {/* Original */}
              <Card sx={{ mb: 2, bgcolor: '#fff3e0' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      📝 ORIGINAL QUERY
                    </Typography>
                  </Box>
                  <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                    "{preprocessResult.original}"
                  </Typography>
                </CardContent>
              </Card>

              {/* Step 1: Normalization */}
              <Card sx={{ mb: 2, bgcolor: '#e3f2fd' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      1️⃣ NORMALIZATION
                    </Typography>
                    {preprocessResult.metadata.testCaseIds?.length > 0 && (
                      <Chip 
                        label={`Test Case: ${preprocessResult.metadata.testCaseIds.map(tc => tc.normalized).join(', ')}`} 
                        size="small" 
                        color="info"
                      />
                    )}
                  </Box>
                  <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                    "{preprocessResult.normalized}"
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <Chip label={`${preprocessResult.metadata.tokens.length} tokens`} size="small" />
                  </Box>
                </CardContent>
              </Card>

              {/* Step 2: Abbreviation Expansion */}
              <Card sx={{ mb: 2, bgcolor: '#e8f5e9' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      2️⃣ ABBREVIATION EXPANSION
                    </Typography>
                    <Chip 
                      label={`${preprocessResult.metadata.abbreviationMappings?.length || 0} expansions`} 
                      size="small" 
                      color="success"
                    />
                  </Box>
                  <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                    "{preprocessResult.abbreviationExpanded}"
                  </Typography>
                  {preprocessResult.metadata.abbreviationMappings?.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        Expanded:
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                        {preprocessResult.metadata.abbreviationMappings.map((mapping, idx) => (
                          <Chip
                            key={idx}
                            label={`${mapping.abbreviation} → ${mapping.expansion}`}
                            size="small"
                            color="success"
                            variant="outlined"
                          />
                        ))}
                      </Box>
                    </Box>
                  )}
                </CardContent>
              </Card>

              {/* Step 3: Synonym Expansion */}
              <Card sx={{ bgcolor: '#f3e5f5' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      3️⃣ SYNONYM EXPANSION
                    </Typography>
                    <Chip 
                      label={`${preprocessResult.synonymExpanded?.length || 0} variations`} 
                      size="small" 
                      color="secondary"
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Multiple query variations generated for comprehensive search coverage
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {preprocessResult.synonymExpanded?.slice(0, 3).map((variation, idx) => (
                      <Box key={idx} sx={{ p: 1, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid #e0e0e0' }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {idx + 1}. "{variation}"
                        </Typography>
                      </Box>
                    ))}
                    {preprocessResult.synonymExpanded?.length > 3 && (
                      <Typography variant="caption" color="text.secondary">
                        + {preprocessResult.synonymExpanded.length - 3} more variations
                      </Typography>
                    )}
                  </Box>
                </CardContent>
              </Card>

              {/* Metadata */}
              <Box sx={{ mt: 3, p: 2, bgcolor: '#fafafa', borderRadius: 1 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Processing Metadata
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary">
                      Processing Time
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {preprocessResult.metadata.processingTime}ms
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary">
                      Token Count
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {preprocessResult.metadata.tokens.length}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary">
                      Abbreviations
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {preprocessResult.metadata.abbreviationMappings?.length || 0}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary">
                      Synonyms
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {preprocessResult.metadata.synonymMappings?.length || 0}
                    </Typography>
                  </Grid>
                </Grid>
              </Box>
            </Box>
          </TabPanel>

          {/* Tab 1: Abbreviations Detail */}
          <TabPanel value={tabValue} index={1}>
            <Box sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Abbreviation Mappings
              </Typography>
              {preprocessResult.metadata.abbreviationMappings?.length > 0 ? (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell><strong>Abbreviation</strong></TableCell>
                        <TableCell><strong>Full Form</strong></TableCell>
                        <TableCell><strong>Position</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {preprocessResult.metadata.abbreviationMappings.map((mapping, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Chip label={mapping.abbreviation.toUpperCase()} size="small" color="primary" />
                          </TableCell>
                          <TableCell>{mapping.expansion}</TableCell>
                          <TableCell>{mapping.position || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">No abbreviations found in this query</Alert>
              )}

              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Before & After Comparison
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 2, bgcolor: '#fff3e0' }}>
                      <Typography variant="caption" color="text.secondary">
                        BEFORE (with abbreviations)
                      </Typography>
                      <Typography variant="body1" sx={{ fontFamily: 'monospace', mt: 1 }}>
                        {preprocessResult.normalized}
                      </Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 2, bgcolor: '#e8f5e9' }}>
                      <Typography variant="caption" color="text.secondary">
                        AFTER (expanded)
                      </Typography>
                      <Typography variant="body1" sx={{ fontFamily: 'monospace', mt: 1 }}>
                        {preprocessResult.abbreviationExpanded}
                      </Typography>
                    </Paper>
                  </Grid>
                </Grid>
              </Box>
            </Box>
          </TabPanel>

          {/* Tab 2: Synonym Variations */}
          <TabPanel value={tabValue} index={2}>
            <Box sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Generated Query Variations ({preprocessResult.synonymExpanded?.length || 0})
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                These variations will be used to perform comprehensive search across the database
              </Typography>

              <Grid container spacing={2}>
                {preprocessResult.synonymExpanded?.map((variation, idx) => (
                  <Grid item xs={12} key={idx}>
                    <Paper 
                      sx={{ 
                        p: 2, 
                        bgcolor: idx === 0 ? '#e8f5e9' : 'background.paper',
                        border: idx === 0 ? '2px solid #4caf50' : '1px solid #e0e0e0'
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <Box sx={{ flex: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Chip 
                              label={`Variation ${idx + 1}`} 
                              size="small" 
                              color={idx === 0 ? 'success' : 'default'}
                            />
                            {idx === 0 && (
                              <Chip label="Primary" size="small" color="success" variant="outlined" />
                            )}
                          </Box>
                          <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                            "{variation}"
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Tooltip title={copiedIndex === idx ? 'Copied!' : 'Copy to clipboard'}>
                            <IconButton 
                              size="small" 
                              onClick={() => handleCopy(variation, idx)}
                              color={copiedIndex === idx ? 'success' : 'default'}
                            >
                              {copiedIndex === idx ? <CheckCircleIcon /> : <ContentCopyIcon />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Search with this variation">
                            <IconButton 
                              size="small" 
                              onClick={() => handleSearch(variation)}
                              color="primary"
                              disabled={searchLoading}
                            >
                              <SearchIcon />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>
                    </Paper>
                  </Grid>
                ))}
              </Grid>

              {/* Synonym Mappings */}
              {preprocessResult.metadata.synonymMappings?.length > 0 && (
                <Box sx={{ mt: 3 }}>
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">
                        Synonym Mappings ({preprocessResult.metadata.synonymMappings.length})
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell><strong>Term</strong></TableCell>
                              <TableCell><strong>Synonyms</strong></TableCell>
                              <TableCell><strong>Position</strong></TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {preprocessResult.metadata.synonymMappings.map((mapping, idx) => (
                              <TableRow key={idx}>
                                <TableCell>
                                  <Chip label={mapping.term} size="small" color="secondary" />
                                </TableCell>
                                <TableCell>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {mapping.synonyms.map((syn, sidx) => (
                                      <Chip key={sidx} label={syn} size="small" variant="outlined" />
                                    ))}
                                  </Box>
                                </TableCell>
                                <TableCell>{mapping.position}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </AccordionDetails>
                  </Accordion>
                </Box>
              )}
            </Box>
          </TabPanel>

          {/* Tab 3: Search Results */}
          <TabPanel value={tabValue} index={3}>
            <Box sx={{ p: 3 }}>
              {searchLoading ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <LinearProgress sx={{ mb: 2 }} />
                  <Typography>Searching database...</Typography>
                </Box>
              ) : searchResults ? (
                <>
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      Search Results ({searchResults.results?.length || 0})
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      <Chip label={`Search Type: ${searchType.toUpperCase()}`} color="primary" />
                      <Chip label={`Query: "${searchResults.query || query}"`} variant="outlined" />
                    </Box>
                  </Box>

                  <Grid container spacing={2}>
                    {searchResults.results?.map((result, idx) => (
                      <Grid item xs={12} key={idx}>
                        <Card>
                          <CardContent>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                              <Box>
                                <Typography variant="h6" color="primary">
                                  {result.id}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {result.module} • {result.priority} Priority
                                </Typography>
                              </Box>
                              <Chip 
                                label={`Score: ${result.score?.toFixed(4) || 'N/A'}`} 
                                color={getScoreColor(result.score || 0)}
                                size="small"
                              />
                            </Box>
                            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold' }}>
                              {result.title}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              {result.description}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                              <Chip label={result.type} size="small" />
                              <Chip label={`Risk: ${result.risk}`} size="small" />
                              {result.tags?.map((tag, tidx) => (
                                <Chip key={tidx} label={tag} size="small" variant="outlined" />
                              ))}
                            </Box>
                          </CardContent>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                </>
              ) : (
                <Alert severity="info">
                  Click "Search" button to execute search with preprocessed queries
                </Alert>
              )}
            </Box>
          </TabPanel>
        </Paper>
      )}

      {/* Info Section */}
      <Paper elevation={1} sx={{ p: 2, bgcolor: '#f5f5f5' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <InfoIcon color="primary" />
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              How Query Preprocessing Works
            </Typography>
            <Typography variant="body2" color="text.secondary">
              1. <strong>Normalization:</strong> Converts text to lowercase, removes special characters, extracts test case IDs
              <br />
              2. <strong>Abbreviation Expansion:</strong> Expands healthcare abbreviations (UHID → unique health id, OTP → one time password)
              <br />
              3. <strong>Synonym Expansion:</strong> Generates multiple query variations using synonyms (patient → customer/user/individual)
              <br />
              4. <strong>Search Execution:</strong> Uses all variations to perform comprehensive search with better recall
            </Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}

export default QueryPreprocessing;
