import React, { useState, useCallback } from 'react';
import {
  Typography,
  Box,
  Button,
  Alert,
  CircularProgress,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Grid,
  Fade
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search as SearchIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Score as ScoreIcon,
  Description as DescriptionIcon,
  Assignment as AssignmentIcon,
  FilterList as FilterIcon
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

function QuerySearch() {
  const [query, setQuery] = useState('Share Diagnostic Reports with Patients via WhatsApp');
  const [limit, setLimit] = useState(5);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [searchInfo, setSearchInfo] = useState(null);
  const [error, setError] = useState(null);
  
  // Metadata filters
  const [moduleFilter, setModuleFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [automationFilter, setAutomationFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  
  // Dynamic filter options
  const [filterOptions, setFilterOptions] = useState({
    modules: [],
    priorities: [],
    risks: [],
    types: []
  });
  
  const { enqueueSnackbar } = useSnackbar();

  // Fetch distinct metadata values for filters
  const loadFilterOptions = useCallback(async () => {
    try {
      console.log('🔄 Fetching filter options from:', `${API_BASE}/metadata/distinct`);
      const response = await axios.get(`${API_BASE}/metadata/distinct`);
      console.log('✅ Filter options response:', response.data);
      if (response.data.success && response.data.metadata) {
        setFilterOptions(response.data.metadata);
        console.log('✅ Filter options set:', response.data.metadata);
        
        // Show notification about loaded data
        const totalOptions = 
          (response.data.metadata.modules?.length || 0) +
          (response.data.metadata.priorities?.length || 0) +
          (response.data.metadata.risks?.length || 0) +
          (response.data.metadata.types?.length || 0);
          
        if (totalOptions === 0) {
          enqueueSnackbar('No metadata found. Please add test cases with embeddings first.', { 
            variant: 'warning',
            autoHideDuration: 5000
          });
        } else {
          console.log(`✅ Loaded ${response.data.metadata.modules?.length || 0} modules, ${response.data.metadata.priorities?.length || 0} priorities`);
        }
      }
    } catch (err) {
      console.error('❌ Failed to load filter options:', err);
      console.error('❌ Error details:', err.response?.data || err.message);
      enqueueSnackbar('Failed to load filter options. Check console for details.', { variant: 'error' });
    }
  }, [enqueueSnackbar]);

  React.useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  const handleSearch = async () => {
    if (!query.trim()) {
      enqueueSnackbar('Please enter a search query', { variant: 'warning' });
      return;
    }

    setSearching(true);
    setError(null);
    setResults([]);
    setSearchInfo(null);

    try {
      const filters = {};
      if (moduleFilter) filters.module = moduleFilter;
      if (priorityFilter) filters.priority = priorityFilter;
      if (riskFilter) filters.risk = riskFilter;
      if (automationFilter) filters.automationManual = automationFilter;
      
      const response = await axios.post(`${API_BASE}/search`, {
        query: query.trim(),
        limit: parseInt(limit),
        filters: Object.keys(filters).length > 0 ? filters : undefined
      });

      setResults(response.data.results);
      setSearchInfo({
        query: response.data.query,
        cost: response.data.cost,
        tokens: response.data.tokens,
        resultCount: response.data.results.length,
        filters: response.data.filters
      });

      enqueueSnackbar(`Found ${response.data.results.length} results`, { variant: 'success' });
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'Search failed';
      setError(errorMessage);
      enqueueSnackbar(errorMessage, { variant: 'error' });
    } finally {
      setSearching(false);
    }
  };

  const handleKeyPress = (event) => {
    if (event.key === 'Enter' && !searching) {
      handleSearch();
    }
  };

  const formatScore = (score) => {
    return parseFloat(score).toFixed(4);
  };

  const getScoreColor = (score) => {
    if (score >= 0.8) return 'success';
    if (score >= 0.6) return 'primary';
    if (score >= 0.4) return 'warning';
    return 'default';
  };

  const columns = [
    {
      field: 'title',
      headerName: 'Test Case',
      flex: 1,
      minWidth: 200,
      renderCell: (params) => (
        <Box>
          <Typography variant="subtitle2" fontWeight={600}>
            {params.value || params.row.id}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {params.row.module}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'score',
      headerName: 'Similarity',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={`${(params.value * 100).toFixed(1)}%`}
          color={getScoreColor(params.value)}
          size="small"
          variant="outlined"
        />
      ),
    },
    {
      field: 'description',
      headerName: 'Description',
      flex: 2,
      minWidth: 300,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ 
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {params.value?.substring(0, 100)}
          {params.value?.length > 100 && '...'}
        </Typography>
      ),
    },
    {
      field: 'sourceFile',
      headerName: 'Source',
      width: 150,
      renderCell: (params) => (
        <Chip label={params.value} size="small" variant="outlined" />
      ),
    },
  ];

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <SearchIcon color="primary" sx={{ fontSize: '2rem' }} />
          Query Search
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Search through your test cases using semantic similarity with AI embeddings.
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Search Panel */}
        <Grid item xs={12} lg={8}>
          <Card elevation={3}>
            <CardHeader
              title="Search Query"
              subheader="Enter your search terms and find similar test cases"
              avatar={<SearchIcon color="primary" />}
            />
            <CardContent>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Enter your search query"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyPress={handleKeyPress}
                    variant="outlined"
                    placeholder="e.g., 'Find all login test cases for the Billing module with High priority'"
                    multiline
                    rows={3}
                    helperText="Use descriptive terms related to test functionality"
                     sx={{ 
                      '& .MuiOutlinedInput-root': { 
                        minWidth: '800px',
                        width: '100%'
                      } 
                    }}
                    
                  />
                </Grid>

                {/* Metadata Filters Section */}
                <Grid item xs={12}>
                  <Card 
                    variant="outlined" 
                    sx={{ 
                      bgcolor: showFilters ? 'primary.50' : 'grey.50',
                      border: showFilters ? '2px solid' : '1px solid',
                      borderColor: showFilters ? 'primary.main' : 'divider',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: showFilters ? 2 : 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="subtitle1" fontWeight={600} color={showFilters ? 'primary' : 'text.secondary'}>
                            Advanced Metadata Filters
                          </Typography>
                          {filterOptions.modules && filterOptions.modules.length > 0 && (
                            <Chip 
                              size="small" 
                              color="success" 
                              variant="outlined"
                              sx={{ ml: 1 }}
                            />
                          )}
                          {(moduleFilter || priorityFilter || riskFilter || automationFilter) && (
                            <Chip 
                              label="Active" 
                              size="small" 
                              color="primary" 
                              sx={{ ml: 1 }}
                            />
                          )}
                        </Box>
                        <Button
                          variant={showFilters ? 'contained' : 'outlined'}
                          onClick={() => setShowFilters(!showFilters)}
                          size="small"
                          startIcon={showFilters ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        >
                          {showFilters ? 'Hide Filters' : 'Show Filters'}
                        </Button>
                      </Box>

                      {showFilters && (
                        <Fade in={showFilters}>
                          <Box>
                            <Divider sx={{ mb: 2 }} />
                            <Grid container spacing={2}>
                              <Grid item xs={12} sm={6} md={3}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Module</InputLabel>
                                  <Select
                                    value={moduleFilter}
                                    label="Module"
                                    onChange={(e) => setModuleFilter(e.target.value)}
                                    sx={{ bgcolor: 'background.paper', minWidth: '200px',width: '100%'}}
                                    MenuProps={{
                                      PaperProps: {
                                        sx: {
                                          minWidth: 250,
                                          maxHeight: 400,
                                          '& .MuiMenuItem-root': {
                                            py: 1.5,
                                            fontSize: '0.95rem'
                                          }
                                        }
                                      }
                                    }}
                                  >
                                    <MenuItem value="">
                                      <em>All Modules</em>
                                    </MenuItem>
                                    {filterOptions.modules && filterOptions.modules.length > 0 ? (
                                      filterOptions.modules.map((module) => (
                                        <MenuItem key={module} value={module}>
                                          {module}
                                        </MenuItem>
                                      ))
                                    ) : (
                                      <MenuItem disabled>
                                        <em>No data - Upload & create embeddings first</em>
                                      </MenuItem>
                                    )}
                                  </Select>
                                </FormControl>
                              </Grid>

                              <Grid item xs={12} sm={6} md={3}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Priority</InputLabel>
                                  <Select
                                    value={priorityFilter}
                                    label="Priority"
                                    onChange={(e) => setPriorityFilter(e.target.value)}
                                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%' }}
                                    MenuProps={{
                                      PaperProps: {
                                        sx: {
                                          minWidth: 250,
                                          '& .MuiMenuItem-root': {
                                            py: 1.5,
                                            fontSize: '0.95rem'
                                          }
                                        }
                                      }
                                    }}
                                  >
                                    <MenuItem value="">
                                      <em>All Priorities</em>
                                    </MenuItem>
                                    {filterOptions.priorities.map((priority) => (
                                      <MenuItem key={priority} value={priority}>
                                        {priority}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Grid>

                              <Grid item xs={12} sm={6} md={3}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Risk Level</InputLabel>
                                  <Select
                                    value={riskFilter}
                                    label="Risk Level"
                                    onChange={(e) => setRiskFilter(e.target.value)}
                                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%'}}
                                    MenuProps={{
                                      PaperProps: {
                                        sx: {
                                          minWidth: 250,
                                          '& .MuiMenuItem-root': {
                                            py: 1.5,
                                            fontSize: '0.95rem'
                                          }
                                        }
                                      }
                                    }}
                                  >
                                    <MenuItem value="">
                                      <em>All Risk Levels</em>
                                    </MenuItem>
                                    {filterOptions.risks.map((risk) => (
                                      <MenuItem key={risk} value={risk}>
                                        {risk}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Grid>

                              <Grid item xs={12} sm={6} md={3}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Test Type</InputLabel>
                                  <Select
                                    value={automationFilter}
                                    label="Test Type"
                                    onChange={(e) => setAutomationFilter(e.target.value)}
                                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%'}}
                                    MenuProps={{
                                      PaperProps: {
                                        sx: {
                                          minWidth: 250,
                                          '& .MuiMenuItem-root': {
                                            py: 1.5,
                                            fontSize: '0.95rem'
                                          }
                                        }
                                      }
                                    }}
                                  >
                                    <MenuItem value="">
                                      <em></em>
                                    </MenuItem>
                                    {filterOptions.types.map((type) => (
                                      <MenuItem key={type} value={type}>
                                        {type}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Grid>

                              {/* Active Filters Display */}
                              {(moduleFilter || priorityFilter || riskFilter || automationFilter) && (
                                <Grid item xs={12}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
                                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                      Active Filters:
                                    </Typography>
                                    {moduleFilter && (
                                      <Chip
                                        label={`Module: ${moduleFilter}`}
                                        onDelete={() => setModuleFilter('')}
                                        color="primary"
                                        size="small"
                                        variant="outlined"
                                      />
                                    )}
                                    {priorityFilter && (
                                      <Chip
                                        label={`Priority: ${priorityFilter}`}
                                        onDelete={() => setPriorityFilter('')}
                                        color={priorityFilter === 'High' ? 'error' : priorityFilter === 'Medium' ? 'warning' : 'default'}
                                        size="small"
                                        variant="outlined"
                                      />
                                    )}
                                    {riskFilter && (
                                      <Chip
                                        label={`Risk: ${riskFilter}`}
                                        onDelete={() => setRiskFilter('')}
                                        color={riskFilter === 'High' ? 'error' : riskFilter === 'Medium' ? 'warning' : 'success'}
                                        size="small"
                                        variant="outlined"
                                      />
                                    )}
                                    {automationFilter && (
                                      <Chip
                                        label={`Type: ${automationFilter}`}
                                        onDelete={() => setAutomationFilter('')}
                                        color="secondary"
                                        size="small"
                                        variant="outlined"
                                      />
                                    )}
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        setModuleFilter('');
                                        setPriorityFilter('');
                                        setRiskFilter('');
                                        setAutomationFilter('');
                                      }}
                                      color="error"
                                      sx={{ ml: 'auto' }}
                                    >
                                      Clear All
                                    </Button>
                                  </Box>
                                </Grid>
                              )}
                            </Grid>
                          </Box>
                        </Fade>
                      )}
                    </CardContent>
                  </Card>
                </Grid>

                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Results Limit</InputLabel>
                    <Select
                      value={limit}
                      label="Results Limit"
                      onChange={(e) => setLimit(e.target.value)}
                    >
                      <MenuItem value={3}>3 Results</MenuItem>
                      <MenuItem value={5}>5 Results</MenuItem>
                      <MenuItem value={10}>10 Results</MenuItem>
                      <MenuItem value={20}>20 Results</MenuItem>
                      <MenuItem value={50}>50 Results</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Button
                    fullWidth
                    variant="contained"
                    size="large"
                    startIcon={searching ? <CircularProgress size={20} /> : <SearchIcon />}
                    onClick={handleSearch}
                    disabled={searching || !query.trim()}
                  >
                    {searching ? 'Searching...' : 'Search'}
                  </Button>
                </Grid>
              </Grid>

              {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}

              {searchInfo && (
                <Fade in={true}>
                  <Box sx={{ mt: 2 }}>
                    <Alert 
                      severity={searchInfo.resultCount > 0 ? "success" : "warning"}
                      sx={{ 
                        '& .MuiAlert-message': { width: '100%' }
                      }}
                    >
                      <Box sx={{ width: '100%' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 1 }}>
                          <Typography variant="body2" fontWeight={600}>
                            Search Query:
                          </Typography>
                          <Typography variant="body2" sx={{ fontStyle: 'italic', flexGrow: 1 }}>
                            "{searchInfo.query}"
                          </Typography>
                          <Chip 
                            label={`${searchInfo.resultCount} results`} 
                            size="small" 
                            color={searchInfo.resultCount > 0 ? "success" : "default"}
                            sx={{ fontWeight: 600 }}
                          />
                        </Box>
                        
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="caption" color="text.secondary">
                            Performance:
                          </Typography>
                          <Chip label={`$${searchInfo.cost.toFixed(6)} cost`} size="small" color="primary" variant="outlined" />
                          <Chip label={`${searchInfo.tokens} tokens`} size="small" color="secondary" variant="outlined" />
                          
                          {searchInfo.filters && Object.keys(searchInfo.filters).length > 0 && (
                            <>
                              <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
                              <Typography variant="caption" color="text.secondary">
                                Applied Filters:
                              </Typography>
                              {Object.entries(searchInfo.filters).map(([key, value]) => (
                                <Chip 
                                  key={key}
                                  label={`${key}: ${value}`} 
                                  size="small" 
                                  color="info"
                                  variant="outlined"
                                />
                              ))}
                            </>
                          )}
                        </Box>
                      </Box>
                    </Alert>
                  </Box>
                </Fade>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Results Section */}
      {results.length > 0 && (
        <Fade in={true}>
          <Card elevation={3} sx={{ mt: 3 }}>
            <CardHeader
              title="Search Results"
              subheader={`${results.length} results ranked by semantic similarity`}
            />
            <CardContent>
              <Box sx={{ height: 400, width: '100%', mb: 3 }}>
                <DataGrid
                  rows={results}
                  columns={columns}
                  getRowId={(row) => row._id || row.id}
                  density="comfortable"
                  pageSizeOptions={[5, 10, 25]}
                  initialState={{
                    pagination: {
                      paginationModel: { page: 0, pageSize: 10 },
                    },
                  }}
                  sx={{
                    '& .MuiDataGrid-cell:focus': {
                      outline: 'none',
                    },
                    '& .MuiDataGrid-row:hover': {
                      backgroundColor: 'action.hover',
                    },
                  }}
                />
              </Box>

              {/* Detailed Results */}
              <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>
                Detailed View
              </Typography>
              <Box sx={{ mt: 2 }}>
                {results.slice(0, 5).map((result, index) => (
                  <Accordion key={result._id || index} elevation={2} sx={{ mb: 1 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 2 }}>
                        <Typography variant="h6" sx={{ flexGrow: 1 }}>
                          {result.title || result.id}
                        </Typography>
                        <Chip
                          label={`Score: ${formatScore(result.score)}`}
                          color={getScoreColor(result.score)}
                          size="small"
                          icon={<ScoreIcon />}
                        />
                        {result.module && (
                          <Chip
                            label={result.module}
                            variant="outlined"
                            size="small"
                          />
                        )}
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                          <Card variant="outlined">
                            <CardContent>
                              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                <DescriptionIcon sx={{ mr: 1 }} />
                                <Typography variant="subtitle1" fontWeight="bold">
                                  Description
                                </Typography>
                              </Box>
                              <Typography variant="body2">
                                {result.description || 'No description available'}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>

                        <Grid item xs={12} md={6}>
                          <Card variant="outlined">
                            <CardContent>
                              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                <AssignmentIcon sx={{ mr: 1 }} />
                                <Typography variant="subtitle1" fontWeight="bold">
                                  Test Steps
                                </Typography>
                              </Box>
                              <Typography variant="body2">
                                {result.steps || 'No steps available'}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>

                        <Grid item xs={12}>
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                                Expected Results
                              </Typography>
                              <Typography variant="body2">
                                {result.expectedResults || 'No expected results available'}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>

                        <Grid item xs={12}>
                          <Divider sx={{ my: 1 }} />
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
                            <Typography variant="caption" color="text.secondary">
                              <strong>Test Case ID:</strong> {result.id}
                            </Typography>
                            {result.module && (
                              <Chip label={`Module: ${result.module}`} size="small" color="primary" variant="outlined" />
                            )}
                            {result.priority && (
                              <Chip 
                                label={`Priority: ${result.priority}`} 
                                size="small" 
                                color={result.priority === 'High' ? 'error' : result.priority === 'Medium' ? 'warning' : 'default'}
                              />
                            )}
                            {result.risk && (
                              <Chip 
                                label={`Risk: ${result.risk}`} 
                                size="small" 
                                color={result.risk === 'High' ? 'error' : result.risk === 'Medium' ? 'warning' : 'success'}
                              />
                            )}
                            {result.automationManual && (
                              <Chip label={result.automationManual} size="small" variant="outlined" />
                            )}
                            <Chip
                              label={`Similarity: ${(result.score * 100).toFixed(1)}%`}
                              size="small"
                              color={getScoreColor(result.score)}
                            />
                          </Box>
                          
                          {/* Additional Metadata */}
                          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                            {result.createdBy && (
                              <Typography variant="caption" color="text.secondary">
                                <strong>Created By:</strong> {result.createdBy}
                              </Typography>
                            )}
                            {result.createdDate && (
                              <Typography variant="caption" color="text.secondary">
                                <strong>Created:</strong> {result.createdDate}
                              </Typography>
                            )}
                            {result.lastModifiedDate && (
                              <Typography variant="caption" color="text.secondary">
                                <strong>Modified:</strong> {result.lastModifiedDate}
                              </Typography>
                            )}
                            {result.version && (
                              <Typography variant="caption" color="text.secondary">
                                <strong>Version:</strong> {result.version}
                              </Typography>
                            )}
                            {result.type && (
                              <Typography variant="caption" color="text.secondary">
                                <strong>Type:</strong> {result.type}
                              </Typography>
                            )}
                            {result.sourceFile && (
                              <Typography variant="caption" color="text.secondary">
                                <strong>Source:</strong> {result.sourceFile}
                              </Typography>
                            )}
                          </Box>
                        </Grid>
                      </Grid>
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Fade>
      )}

      {results.length === 0 && searchInfo && (
        <Fade in={true}>
          <Card elevation={1} sx={{ mt: 3, textAlign: 'center', p: 4 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No results found
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Try adjusting your search query or check if there are embedded documents in the database.
            </Typography>
          </Card>
        </Fade>
      )}
    </Box>
  );
}

export default QuerySearch;