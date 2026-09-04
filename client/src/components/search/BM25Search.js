import React, { useState, useCallback } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Chip,
  Alert,
  Collapse,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  Divider
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SpeedIcon from '@mui/icons-material/Speed';
import ArticleIcon from '@mui/icons-material/Article';
import { useSnackbar } from 'notistack';

const API_BASE = 'http://localhost:3001/api';

function BM25Search() {
  const [query, setQuery] = useState('Share Diagnostic Reports with Patients via WhatsApp');
  const [limit, setLimit] = useState(10);
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
      const response = await fetch(`${API_BASE}/metadata/distinct`);
      const data = await response.json();
      
      if (data.success && data.metadata) {
        setFilterOptions(data.metadata);
      } else if (data.success && data.data) {
        setFilterOptions(data.data);
      } else {
        // Set empty arrays if no data
        setFilterOptions({
          modules: [],
          priorities: [],
          risks: [],
          types: []
        });
      }
    } catch (err) {
      console.error('Failed to load filter options:', err);
      // Set empty arrays on error
      setFilterOptions({
        modules: [],
        priorities: [],
        risks: [],
        types: []
      });
    }
  }, []);

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

      const response = await fetch(`${API_BASE}/search/bm25`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          limit,
          filters
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      if (data.success) {
        setResults(data.results);
        setSearchInfo({
          count: data.count,
          searchTime: data.searchTime,
          query: data.query,
          filters: data.filters,
          searchType: data.searchType
        });
        
        enqueueSnackbar(`Found ${data.count} results in ${data.searchTime}ms`, { 
          variant: 'success' 
        });
      } else {
        throw new Error(data.error || 'Search failed');
      }
    } catch (err) {
      setError(err.message);
      enqueueSnackbar(`Search failed: ${err.message}`, { variant: 'error' });
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
    // BM25 scores are absolute values, not 0-1 normalized
    // Display as-is for BM25, they typically range from 0-100
    return score.toFixed(2);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const getScoreColor = (score) => {
    // BM25 scores are absolute, typically 0-100+
    // High scores (50+) are excellent matches
    if (score >= 50) return 'success';
    if (score >= 30) return 'info';
    if (score >= 15) return 'warning';
    return 'error';
  };

  return (
    <Box sx={{ maxWidth: 1400, margin: 'auto', padding: 3 }}>
      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <SearchIcon sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
          <Typography variant="h4" component="h1">
            BM25 Keyword Search
          </Typography>
        </Box>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Fast keyword-based search using BM25 algorithm. Best for exact matches, IDs, and specific terms.
        </Typography>

        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={8}>
            <TextField
              fullWidth
              label="Search Query"
              variant="outlined"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="e.g., merge UHID, TC_027, registration tests..."
              disabled={searching}
               sx={{ 
                '& .MuiOutlinedInput-root': { 
                  minWidth: '800px',
                  width: '100%'
                } 
              }}
            />
          </Grid>

          <Grid item xs={6} md={2}>
            <TextField
              fullWidth
              label="Results Limit"
              type="number"
              variant="outlined"
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))}
              disabled={searching}
              inputProps={{ min: 1, max: 50 }}
            />
          </Grid>

          <Grid item xs={6} md={2}>
            <Button
              fullWidth
              variant="contained"
              color="primary"
              size="large"
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              startIcon={searching ? <CircularProgress size={20} /> : <SearchIcon />}
              sx={{ height: '56px' }}
            >
              {searching ? 'Searching...' : 'Search'}
            </Button>
          </Grid>
        </Grid>

        {/* Filters Section */}
        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button
              startIcon={<FilterListIcon />}
              endIcon={showFilters ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              onClick={() => setShowFilters(!showFilters)}
              variant="outlined"
              size="small"
            >
              {showFilters ? 'Hide' : 'Show'} Filters
            </Button>
            
            {/* Show active filters count */}
            {(moduleFilter || priorityFilter || riskFilter || automationFilter) && (
              <Chip 
                label={`${[moduleFilter, priorityFilter, riskFilter, automationFilter].filter(Boolean).length} filter(s) active`}
                size="small"
                color="primary"
              />
            )}
          </Box>

          <Collapse in={showFilters}>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Module</InputLabel>
                  <Select
                    value={moduleFilter}
                    onChange={(e) => setModuleFilter(e.target.value)}
                    label="Module"
                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%'}}

                  >
                    <MenuItem value="">All Modules</MenuItem>
                    {(filterOptions.modules || []).map((module) => (
                      <MenuItem key={module} value={module}>{module}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Priority</InputLabel>
                  <Select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    label="Priority"
                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%'}}
                  >
                    <MenuItem value="">All Priorities</MenuItem>
                    {(filterOptions.priorities || []).map((priority) => (
                      <MenuItem key={priority} value={priority}>{priority}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Risk</InputLabel>
                  <Select
                    value={riskFilter}
                    onChange={(e) => setRiskFilter(e.target.value)}
                    label="Risk"
                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%'}}

                  >
                    <MenuItem value="">All Risk Levels</MenuItem>
                    {(filterOptions.risks || []).map((risk) => (
                      <MenuItem key={risk} value={risk}>{risk}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={automationFilter}
                    onChange={(e) => setAutomationFilter(e.target.value)}
                    label="Type"
                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%'}}
                  >
                    <MenuItem value="">All Types</MenuItem>
                    {(filterOptions.types || []).map((type) => (
                      <MenuItem key={type} value={type}>{type}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Collapse>
        </Box>
      </Paper>

      {/* Search Info */}
      {searchInfo && (
        <Alert 
          severity="info" 
          icon={<SpeedIcon />}
          sx={{ mb: 3 }}
        >
          <Typography variant="body2">
            <strong>BM25 Search Results:</strong> Found {searchInfo.count} test cases in {searchInfo.searchTime}ms
            <br />
            <strong>Search Type:</strong> {searchInfo.searchType}
            {Object.keys(searchInfo.filters || {}).length > 0 && (
              <>
                <br />
                <strong>Active Filters:</strong> 
                {Object.entries(searchInfo.filters).map(([key, value]) => (
                  <Chip 
                    key={key}
                    label={`${key}: ${value}`}
                    size="small"
                    variant="outlined"
                    sx={{ ml: 1 }}
                  />
                ))}
              </>
            )}
          </Typography>
        </Alert>
      )}

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Results */}
      {results.length > 0 && (
        <Box>
          <Typography variant="h6" sx={{ mb: 2 }}>
            <ArticleIcon sx={{ verticalAlign: 'middle', mr: 1 }} />
            Search Results ({results.length})
          </Typography>

          {results.map((result, index) => (
            <Card key={result._id || index} sx={{ mb: 2 }} elevation={2}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Chip 
                        label={`#${index + 1}`} 
                        size="small" 
                        color="primary" 
                        variant="outlined"
                      />
                      <Typography variant="h6" component="div">
                        {result.id || 'No ID'}
                      </Typography>
                      <Chip 
                        label={`Score: ${formatScore(result.score)}`}
                        color={getScoreColor(result.score)} 
                        size="small"
                      />
                    </Box>

                    <Typography variant="h6" color="text.primary" sx={{ mb: 1 }}>
                      {result.title || 'No Title'}
                    </Typography>

                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                      {result.module && (
                        <Chip label={`Module: ${result.module}`} size="small" variant="outlined" />
                      )}
                      {result.priority && (
                        <Chip 
                          label={result.priority} 
                          size="small" 
                          color={result.priority === 'P1' ? 'error' : result.priority === 'P2' ? 'warning' : 'default'}
                        />
                      )}
                      {result.risk && (
                        <Chip 
                          label={`Risk: ${result.risk}`} 
                          size="small" 
                          color={result.risk === 'High' ? 'error' : result.risk === 'Medium' ? 'warning' : 'success'}
                          variant="outlined"
                        />
                      )}
                      {result.automationManual && (
                        <Chip label={result.automationManual} size="small" color="info" variant="outlined" />
                      )}
                    </Box>

                    {result.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        <strong>Description:</strong> {result.description}
                      </Typography>
                    )}

                    {result.steps && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        <strong>Steps:</strong> {result.steps}
                      </Typography>
                    )}

                    {result.expectedResults && (
                      <Typography variant="body2" color="text.secondary">
                        <strong>Expected Results:</strong> {result.expectedResults}
                      </Typography>
                    )}

                    <Divider sx={{ my: 1 }} />

                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      {result.sourceFile && (
                        <Typography variant="caption" color="text.secondary">
                          📄 Source: {result.sourceFile}
                        </Typography>
                      )}
                      {result.createdAt && (
                        <Typography variant="caption" color="text.secondary">
                          📅 Created: {formatDate(result.createdAt)}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* No Results Message */}
      {!searching && results.length === 0 && searchInfo && (
        <Alert severity="info">
          No test cases found matching your search query. Try adjusting your search terms or filters.
        </Alert>
      )}
    </Box>
  );
}

export default BM25Search;
