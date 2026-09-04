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
  IconButton,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  Divider,
  Slider,
  Tooltip
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ArticleIcon from '@mui/icons-material/Article';
import InfoIcon from '@mui/icons-material/Info';
import { useSnackbar } from 'notistack';

const API_BASE = 'http://localhost:3001/api';

function HybridSearch() {
  const [query, setQuery] = useState('Share Diagnostic Reports with Patients via WhatsApp');
  const [limit, setLimit] = useState(10);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [searchInfo, setSearchInfo] = useState(null);
  const [error, setError] = useState(null);
  
  // Weight sliders
  const [bm25Weight, setBm25Weight] = useState(50);
  const [vectorWeight, setVectorWeight] = useState(50);
  const [showWeightInfo, setShowWeightInfo] = useState(false);
  
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

  const handleWeightChange = (type, value) => {
    if (type === 'bm25') {
      setBm25Weight(value);
      setVectorWeight(100 - value);
    } else {
      setVectorWeight(value);
      setBm25Weight(100 - value);
    }
  };

  const setBalancedWeights = () => {
    setBm25Weight(50);
    setVectorWeight(50);
  };

  const setKeywordHeavy = () => {
    setBm25Weight(70);
    setVectorWeight(30);
  };

  const setSemanticHeavy = () => {
    setBm25Weight(30);
    setVectorWeight(70);
  };

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

      const response = await fetch(`${API_BASE}/search/hybrid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          limit,
          filters,
          bm25Weight: bm25Weight / 100,
          vectorWeight: vectorWeight / 100
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
          timing: data.timing,
          stats: data.stats,
          query: data.query,
          filters: data.filters,
          weights: data.weights,
          searchType: data.searchType,
          cost: data.cost,
          tokens: data.tokens
        });
        
        enqueueSnackbar(
          `Found ${data.count} results (${data.stats.foundInBoth} in both indexes) in ${data.timing.totalTime}ms`, 
          { variant: 'success' }
        );
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
    // Hybrid scores are normalized 0-1, so convert to percentage
    return (score * 100).toFixed(1) + '%';
  };

  const formatRawScore = (score) => {
    // Raw BM25/Vector scores are absolute values
    return score ? score.toFixed(2) : '0.00';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const getScoreColor = (score) => {
    if (score >= 0.8) return 'success';
    if (score >= 0.6) return 'info';
    if (score >= 0.4) return 'warning';
    return 'error';
  };

  const getFoundInColor = (foundIn) => {
    if (foundIn === 'both') return 'success';
    if (foundIn === 'bm25') return 'primary';
    return 'secondary';
  };

  return (
    <Box sx={{ maxWidth: 1400, margin: 'auto', padding: 3 }}>
      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <AutoFixHighIcon sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
          <Typography variant="h4" component="h1">
            Hybrid Search (BM25 + Vector)
          </Typography>
        </Box>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Combines BM25 keyword matching with semantic vector search for best results. Adjust weights to control the balance.
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
              placeholder="e.g., merge UHID, patient registration, login tests..."
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

        {/* Weight Controls */}
        <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mr: 1 }}>
              Search Weights
            </Typography>
            <Tooltip title="Adjust the balance between keyword matching (BM25) and semantic similarity (Vector)">
              <IconButton size="small" onClick={() => setShowWeightInfo(!showWeightInfo)}>
                <InfoIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          <Collapse in={showWeightInfo}>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>BM25 (Keyword):</strong> Better for exact matches, IDs, specific terms<br />
                <strong>Vector (Semantic):</strong> Better for natural language, concepts, synonyms<br />
                <strong>Balanced (50/50):</strong> Recommended for most queries
              </Typography>
            </Alert>
          </Collapse>

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="body2" gutterBottom>
                BM25 Weight: {bm25Weight}%
              </Typography>
              <Slider
                value={bm25Weight}
                onChange={(e, value) => handleWeightChange('bm25', value)}
                min={0}
                max={100}
                step={5}
                marks={[
                  { value: 0, label: '0%' },
                  { value: 50, label: '50%' },
                  { value: 100, label: '100%' }
                ]}
                valueLabelDisplay="auto"
                disabled={searching}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography variant="body2" gutterBottom>
                Vector Weight: {vectorWeight}%
              </Typography>
              <Slider
                value={vectorWeight}
                onChange={(e, value) => handleWeightChange('vector', value)}
                min={0}
                max={100}
                step={5}
                marks={[
                  { value: 0, label: '0%' },
                  { value: 50, label: '50%' },
                  { value: 100, label: '100%' }
                ]}
                valueLabelDisplay="auto"
                disabled={searching}
              />
            </Grid>
          </Grid>

          <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={setBalancedWeights} disabled={searching}>
              Balanced (50/50)
            </Button>
            <Button size="small" variant="outlined" onClick={setKeywordHeavy} disabled={searching}>
              Keyword Heavy (70/30)
            </Button>
            <Button size="small" variant="outlined" onClick={setSemanticHeavy} disabled={searching}>
              Semantic Heavy (30/70)
            </Button>
          </Box>
        </Paper>

        {/* Filters Section */}
        <Box sx={{ mt: 2 }}>
          <Button
            startIcon={<FilterListIcon />}
            endIcon={showFilters ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            onClick={() => setShowFilters(!showFilters)}
            variant="outlined"
            size="small"
          >
            {showFilters ? 'Hide' : 'Show'} Filters
          </Button>

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
                    {filterOptions.modules.map((module) => (
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
                    {filterOptions.priorities.map((priority) => (
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
                    {filterOptions.risks.map((risk) => (
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
                    {filterOptions.types.map((type) => (
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
          severity="success" 
          icon={<AutoFixHighIcon />}
          sx={{ mb: 3 }}
        >
          <Typography variant="body2">
            <strong>Hybrid Search Results:</strong> Found {searchInfo.count} test cases in {searchInfo.timing.totalTime}ms
            <br />
            <strong>Stats:</strong> {searchInfo.stats.foundInBoth} in both indexes, 
            {searchInfo.stats.foundInBm25Only} BM25 only, 
            {searchInfo.stats.foundInVectorOnly} vector only
            <br />
            <strong>Timing:</strong> BM25: {searchInfo.timing.bm25Time}ms, Vector: {searchInfo.timing.vectorTime}ms
            {searchInfo.cost > 0 && (
              <><br /><strong>Cost:</strong> ${searchInfo.cost.toFixed(6)} ({searchInfo.tokens} tokens)</>
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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
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
                        label={`Hybrid: ${formatScore(result.hybridScore)}`} 
                        color={getScoreColor(result.hybridScore)} 
                        size="small"
                      />
                      <Chip 
                        label={`Found in: ${result.foundIn}`} 
                        color={getFoundInColor(result.foundIn)} 
                        size="small"
                        variant="outlined"
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
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        <strong>Expected Results:</strong> {result.expectedResults}
                      </Typography>
                    )}

                    <Divider sx={{ my: 1 }} />

                    {/* Score Breakdown */}
                    <Paper variant="outlined" sx={{ p: 1, mb: 1, bgcolor: 'grey.50' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        <strong>Score Breakdown:</strong>
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <Typography variant="caption" color="text.secondary">
                          🔤 BM25: {formatScore(result.bm25ScoreNormalized || 0)} (raw: {formatRawScore(result.bm25Score)})
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          🧠 Vector: {formatScore(result.vectorScoreNormalized || 0)} (raw: {formatRawScore(result.vectorScore)})
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          ⚖️ Hybrid: {formatScore(result.hybridScore)}
                        </Typography>
                      </Box>
                    </Paper>

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
          No test cases found matching your search query. Try adjusting your search terms, weights, or filters.
        </Alert>
      )}
    </Box>
  );
}

export default HybridSearch;
