import React, { useState, useEffect, useCallback } from 'react';
import {
  Paper,
  Typography,
  Box,
  Button,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Tooltip,
  LinearProgress,
  Grid,
  Fade
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Refresh as RefreshIcon,
  PlayArrow as PlayArrowIcon,
  Settings as SettingsIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  Storage as StorageIcon,
  InsertDriveFile as FileIcon
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

function EmbeddingsStore() {
  const [files, setFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(null);
  const { enqueueSnackbar } = useSnackbar();

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/files`);
      const validatedFiles = validateFiles(response.data || []);
      console.log('📁 Raw files:', response.data);
      console.log('📁 Validated files:', validatedFiles);
      
      setFiles(validatedFiles);
      enqueueSnackbar(`Loaded ${validatedFiles.length} files`, { variant: 'success' });
    } catch (err) {
      const errorMessage = 'Failed to load files';
      setError(errorMessage);
      enqueueSnackbar(errorMessage, { variant: 'error' });
      console.error('❌ Load files error:', err);
    } finally {
      setLoading(false);
    }
  }, [enqueueSnackbar]);

  // Check for active jobs on component mount (handles page refresh)
  const checkForActiveJobs = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE}/jobs/active`);
      if (response.data.jobs && response.data.jobs.length > 0) {
        const activeJob = response.data.jobs[0]; // Get the first active job
        setCurrentJobId(activeJob.id);
        setProcessing(true);
        setJobProgress(activeJob);
        enqueueSnackbar('Resuming embedding process...', { variant: 'info' });
      }
    } catch (err) {
      console.error('Failed to check active jobs:', err);
    }
  }, [enqueueSnackbar]);

  useEffect(() => {
    loadFiles();
    checkForActiveJobs();
  }, [loadFiles, checkForActiveJobs]);

  // Poll for job status when processing
  useEffect(() => {
    if (!currentJobId || !processing) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await axios.get(`${API_BASE}/jobs/${currentJobId}`);
        const job = response.data;
        
        setJobProgress(job);
        
        if (job.status === 'completed') {
          setProcessing(false);
          setResults(job.results);
          setCurrentJobId(null);
          setJobProgress(null);
          
          const successful = job.results.filter(r => r.status === 'completed').length;
          const failed = job.results.filter(r => r.status === 'failed').length;
          
          if (failed === 0) {
            enqueueSnackbar(`Successfully processed all ${successful} files!`, { variant: 'success' });
          } else {
            enqueueSnackbar(`Processed ${successful} files, ${failed} failed`, { variant: 'warning' });
          }
          
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error('Failed to poll job status:', err);
        clearInterval(pollInterval);
        setProcessing(false);
        setCurrentJobId(null);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [currentJobId, processing, enqueueSnackbar]);

  // Debug: Add useEffect to monitor selectedFiles changes
  useEffect(() => {
    console.log('🔄 selectedFiles state changed:', selectedFiles);
  }, [selectedFiles]);

  // Enhanced file data validation
  const validateFiles = (fileList) => {
    return fileList.filter(file => 
      file && 
      typeof file === 'object' && 
      file.name && 
      typeof file.size === 'number' &&
      file.modified
    );
  };

  const handleSelectionChange = (newSelection) => {
    console.log('🔍 Selection changed:', newSelection);
    console.log('🔍 Selection type:', typeof newSelection);
    console.log('🔍 Is array:', Array.isArray(newSelection));
    
    try {
      let selectedFileNames = [];
      
      if (Array.isArray(newSelection)) {
        // Old format: direct array of IDs
        selectedFileNames = newSelection.filter(Boolean);
      } else if (newSelection && typeof newSelection === 'object') {
        // New format: object with type and ids
        if (newSelection.type === 'include' && newSelection.ids) {
          // Include selection: use the IDs directly
          selectedFileNames = Array.from(newSelection.ids).filter(Boolean);
        } else if (newSelection.type === 'exclude' && newSelection.ids) {
          // Exclude selection: select all files except the excluded ones
          const excludedIds = new Set(newSelection.ids);
          selectedFileNames = files
            .map(file => file.name)
            .filter(name => !excludedIds.has(name));
        }
      }
      
      console.log('🔍 Processed selection:', selectedFileNames);
      setSelectedFiles(selectedFileNames);
      console.log('🔍 State will be updated to:', selectedFileNames);
    } catch (error) {
      console.error('❌ Error in handleSelectionChange:', error);
      enqueueSnackbar('Selection error: ' + error.message, { variant: 'error' });
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString() + ' ' + 
           new Date(dateString).toLocaleTimeString();
  };

  const handleCreateEmbeddings = async () => {
    if (selectedFiles.length === 0) {
      enqueueSnackbar('Please select at least one file', { variant: 'warning' });
      return;
    }

    setProcessing(true);
    setError(null);
    setResults([]);
    setJobProgress(null);

    try {
      enqueueSnackbar(`Starting batch processing for ${selectedFiles.length} files...`, { variant: 'info' });
      
      // Determine which batch script to use based on file names
      const isTestcasesFile = selectedFiles.some(f => 
        f.toLowerCase().includes('testcase') || f.toLowerCase().includes('test-case')
      );
      const isUserStoriesFile = selectedFiles.some(f => 
        f.toLowerCase().includes('stor') || f.toLowerCase().includes('story')
      );
      
      let scriptName = 'create-embeddings-batch-mistral.js';
      let jobType = 'testcases';
      
      if (isUserStoriesFile) {
        scriptName = 'create-userstories-embeddings-batch-mistral.js';
        jobType = 'user-stories';
      }
      
      console.log(`📊 Auto-detected file type: ${jobType}`);
      console.log(`🚀 Using batch script: ${scriptName}`);
      
      // Call the batch processing endpoint
      const response = await axios.post(`${API_BASE}/create-embeddings-batch`, {
        files: selectedFiles,
        scriptName: scriptName,
        jobType: jobType
      });

      if (response.data.success) {
        const jobId = response.data.jobId;
        setCurrentJobId(jobId);
        enqueueSnackbar(`Batch processing started! Job ID: ${jobId}`, { variant: 'success' });
      } else {
        throw new Error(response.data.error || 'Failed to start batch processing');
      }
      
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || 'Embedding creation failed';
      setError(errorMessage);
      setProcessing(false);
      enqueueSnackbar(errorMessage, { variant: 'error' });
      console.error('❌ Embedding error:', err);
    }
  };

  const columns = [
    {
      field: 'name',
      headerName: 'File Name',
      flex: 1,
      minWidth: 200,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FileIcon color="primary" fontSize="small" />
          <Typography variant="body2">{params.value}</Typography>
        </Box>
      ),
    },
    {
      field: 'size',
      headerName: 'Size',
      width: 120,
      renderCell: (params) => formatFileSize(params.value),
    },
    {
      field: 'modified',
      headerName: 'Modified',
      width: 180,
      renderCell: (params) => formatDate(params.value),
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 100,
      renderCell: (params) => (
        <Chip label={params.value.toUpperCase()} size="small" variant="outlined" />
      ),
    },
  ];

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon color="success" />;
      case 'failed':
        return <ErrorIcon color="error" />;
      case 'in-progress':
        return <ScheduleIcon color="primary" />;
      default:
        return <ScheduleIcon color="disabled" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'in-progress':
        return 'primary';
      default:
        return 'default';
    }
  };

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <StorageIcon color="primary" sx={{ fontSize: '2rem' }} />
          Embeddings & Store
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Select JSON files to create embeddings and store them in MongoDB Atlas Vector Database.
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* File Management */}
        <Grid item xs={12} lg={8}>
          <Card elevation={3}>
            <CardHeader
              title="Available Files"
              subheader={`${files.length} JSON files found`}
              action={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Tooltip title="Settings">
                    <IconButton onClick={() => setShowSettings(true)}>
                      <SettingsIcon />
                    </IconButton>
                  </Tooltip>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={loadFiles}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                </Box>
              }
            />
            <CardContent>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}

              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress />
                </Box>
              ) : files.length === 0 ? (
                <Box sx={{ textAlign: 'center', p: 4 }}>
                  <Typography color="text.secondary">
                    No JSON files found in the data directory
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ height: 400, width: '100%' }}>
                  <DataGrid
                    rows={files}
                    columns={columns}
                    getRowId={(row) => row.name}
                    checkboxSelection
                    onRowSelectionModelChange={handleSelectionChange}
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
              )}

              {selectedFiles.length > 0 && (
                <Fade in={true}>
                  <Box sx={{ mt: 2, p: 2, bgcolor: 'primary.50', borderRadius: 1 }}>
                    <Typography variant="body2" color="primary" fontWeight={600}>
                      Selected {selectedFiles.length} file(s): {selectedFiles.join(', ')}
                    </Typography>
                  </Box>
                </Fade>
              )}

              {processing && jobProgress && (
                <Fade in={true}>
                  <Card variant="outlined" sx={{ mt: 2, bgcolor: 'info.50', borderColor: 'info.main' }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="subtitle1" fontWeight={600} color="info.main">
                          Processing Embeddings...
                        </Typography>
                        <Chip 
                          label={`${jobProgress.progress}/${jobProgress.total}`} 
                          color="info" 
                          size="small"
                        />
                      </Box>
                      
                      {jobProgress.currentFile && (
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Current file: <strong>{jobProgress.currentFile}</strong>
                        </Typography>
                      )}
                      
                      <Box sx={{ mt: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            Progress: {Math.round((jobProgress.progress / jobProgress.total) * 100)}%
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Job ID: {currentJobId?.substring(0, 20)}...
                          </Typography>
                        </Box>
                        <LinearProgress 
                          variant="determinate" 
                          value={(jobProgress.progress / jobProgress.total) * 100}
                          sx={{ height: 8, borderRadius: 1 }}
                        />
                      </Box>
                      
                      <Alert severity="info" sx={{ mt: 2 }}>
                        <Typography variant="caption">
                          ✨ This process continues even if you refresh the page!
                        </Typography>
                      </Alert>
                    </CardContent>
                  </Card>
                </Fade>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Action Panel */}
        <Grid item xs={12} lg={4}>
          <Card elevation={2}>
            <CardHeader
              title="Actions"
              subheader="Process selected files"
              avatar={<PlayArrowIcon color="primary" />}
            />
            <CardContent>
              <Button
                variant="contained"
                startIcon={processing ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                onClick={handleCreateEmbeddings}
                disabled={selectedFiles.length === 0 || processing}
                size="large"
                fullWidth
                sx={{ mb: 2 }}
              >
                {processing ? 'Processing...' : 'Create Embeddings'}
              </Button>

              {/* Debug info */}
              <Alert severity="info" sx={{ mb: 2, fontSize: '0.75rem' }}>
                <Typography variant="caption" component="div">
                  🐛 Debug Info:<br/>
                  Selected Files: {selectedFiles.length} ({selectedFiles.join(', ')})<br/>
                  Processing: {processing.toString()}<br/>
                  Button Disabled: {(selectedFiles.length === 0 || processing).toString()}<br/>
                  Files loaded: {files.length}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <Button 
                    size="small" 
                    variant="outlined" 
                    onClick={() => {
                      console.log('🧪 Manual test - current files:', files);
                      handleSelectionChange(['test-file-1', 'test-file-2']);
                    }}
                    sx={{ mr: 1 }}
                  >
                    Test Selection
                  </Button>
                  <Button 
                    size="small" 
                    variant="outlined" 
                    onClick={() => {
                      console.log('🧪 Files array:', files);
                      if (files.length > 0) {
                        console.log('🧪 First file:', files[0]);
                        handleSelectionChange([files[0].name]);
                      }
                    }}
                  >
                    Select First File
                  </Button>
                </Box>
              </Alert>

              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>Processing Time:</strong> ~10-30 seconds per file<br />
                  <strong>Cost:</strong> ~$0.0001 per test case
                </Typography>
              </Alert>

              {selectedFiles.length > 0 && (
                <Card variant="outlined">
                  <CardContent sx={{ py: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Selected Files
                    </Typography>
                    <List dense>
                      {selectedFiles.slice(0, 3).map((file) => (
                        <ListItem key={file} sx={{ px: 0, py: 0.5 }}>
                          <ListItemText 
                            primary={file}
                            primaryTypographyProps={{ fontSize: '0.875rem' }}
                          />
                        </ListItem>
                      ))}
                      {selectedFiles.length > 3 && (
                        <ListItem sx={{ px: 0, py: 0.5 }}>
                          <ListItemText 
                            primary={`... and ${selectedFiles.length - 3} more`}
                            primaryTypographyProps={{ 
                              fontSize: '0.875rem',
                              fontStyle: 'italic',
                              color: 'text.secondary'
                            }}
                          />
                        </ListItem>
                      )}
                    </List>
                  </CardContent>
                </Card>
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
              title="Processing Results"
              subheader={`${results.filter(r => r.status === 'completed').length} completed, ${results.filter(r => r.status === 'failed').length} failed`}
            />
            <CardContent>
              <List>
                {results.map((result, index) => (
                  <ListItem key={index} sx={{ display: 'flex', alignItems: 'flex-start', border: 1, borderColor: 'divider', borderRadius: 1, mb: 1 }}>
                    <Box sx={{ mr: 2, mt: 0.5 }}>
                      {getStatusIcon(result.status)}
                    </Box>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <Typography variant="subtitle1" fontWeight={600}>
                            {result.file}
                          </Typography>
                          <Chip 
                            label={result.status} 
                            size="small" 
                            color={getStatusColor(result.status)}
                          />
                        </Box>
                      }
                      secondary={
                        <Box>
                          {result.error ? (
                            <Alert severity="error" size="small" sx={{ mt: 1 }}>
                              {result.error}
                            </Alert>
                          ) : (
                            result.output && (
                              <Paper elevation={1} sx={{ p: 1, mt: 1, bgcolor: 'grey.50' }}>
                                <Typography variant="body2" component="pre" sx={{ 
                                  whiteSpace: 'pre-wrap', 
                                  fontSize: '0.75rem',
                                  fontFamily: 'monospace'
                                }}>
                                  {result.output.substring(0, 200)}
                                  {result.output.length > 200 && '...'}
                                </Typography>
                              </Paper>
                            )
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Fade>
      )}

      {/* Settings Dialog */}
      <Dialog open={showSettings} onClose={() => setShowSettings(false)} maxWidth="md" fullWidth>
        <DialogTitle>Embedding Configuration</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" paragraph>
            Current embedding configuration and settings:
          </Typography>
          
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom>Model Settings</Typography>
                  <List dense>
                    <ListItem>
                      <ListItemText primary="Model" secondary="text-embedding-3-small" />
                    </ListItem>
                    <ListItem>
                      <ListItemText primary="Dimensions" secondary="1536" />
                    </ListItem>
                    <ListItem>
                      <ListItemText primary="API Source" secondary="TestLeaf API" />
                    </ListItem>
                  </List>
                </CardContent>
              </Card>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom>Database Settings</Typography>
                  <List dense>
                    <ListItem>
                      <ListItemText primary="Database" secondary="MongoDB Atlas" />
                    </ListItem>
                    <ListItem>
                      <ListItemText primary="Collection" secondary="collection_test_cases" />
                    </ListItem>
                    <ListItem>
                      <ListItemText primary="Vector Index" secondary="test_cases" />
                    </ListItem>
                  </List>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSettings(false)} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default EmbeddingsStore;