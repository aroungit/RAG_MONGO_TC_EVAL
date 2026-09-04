import React, { useState, useEffect, useCallback } from 'react';
import {
  Paper,
  Typography,
  Box,
  Button,
  Alert,
  CircularProgress,
  TextField,
  Grid,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip
} from '@mui/material';
import {
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Info as InfoIcon,
  Settings as SettingsIcon,
  Security as SecurityIcon
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

const envFieldsConfig = [
  {
    key: 'MONGODB_URI',
    label: 'MongoDB URI',
    description: 'MongoDB Atlas connection string',
    sensitive: true,
    multiline: false
  },
  {
    key: 'DB_NAME',
    label: 'Database Name',
    description: 'Name of the MongoDB database',
    sensitive: false,
    multiline: false
  },
  {
    key: 'COLLECTION_NAME',
    label: 'Collection Name',
    description: 'Name of the MongoDB collection',
    sensitive: false,
    multiline: false
  },
  {
    key: 'VECTOR_INDEX_NAME',
    label: 'Vector Index Name',
    description: 'Name of the vector index used for embeddings',
    sensitive: false,
    multiline: false
  },
  {
    key: 'USER_STORIES_COLLECTION_NAME',
    label: 'User Stories Collection',
    description: 'MongoDB collection name for user stories',
    sensitive: false,
    multiline: false
  },
  {
    key: 'USER_STORIES_VECTOR_INDEX_NAME',
    label: 'User Stories Vector Index',
    description: 'Vector index name for user stories embeddings',
    sensitive: false,
    multiline: false
  },
  {
    key: 'MISTRAL_API_KEY',
    label: 'Mistral API Key',
    description: 'API key for Mistral AI (for embeddings)',
    sensitive: true,
    multiline: false
  },
  {
    key: 'MISTRAL_EMBEDDING_MODEL',
    label: 'Mistral Embedding Model',
    description: 'Model name for Mistral embeddings (default: mistral-embed)',
    sensitive: false,
    multiline: false
  },
  {
    key: 'GROQ_API_KEY',
    label: 'Groq API Key',
    description: 'API key for Groq (for LLM operations)',
    sensitive: true,
    multiline: false
  },
  {
    key: 'GROQ_RERANK_MODEL',
    label: 'Groq Rerank Model',
    description: 'Model for document reranking (default: llama-3.2-3b-preview)',
    sensitive: false,
    multiline: false
  },
  {
    key: 'GROQ_SUMMARIZATION_MODEL',
    label: 'Groq Summarization Model',
    description: 'Model for result summarization (default: llama-3.3-70b-versatile)',
    sensitive: false,
    multiline: false
  },
  {
    key: 'BM25_INDEX_NAME',
    label: 'BM25 Index Name',
    description: 'Name of the BM25 search index for keyword-based search',
    sensitive: false,
    multiline: false
  }
];

function Settings() {
  const [envVars, setEnvVars] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [showSensitive, setShowSensitive] = useState({});
  const [showInfo, setShowInfo] = useState(false);
  const { enqueueSnackbar } = useSnackbar();

  const loadEnvVars = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/env`);
      setEnvVars(response.data);
      enqueueSnackbar('Environment variables loaded', { variant: 'success' });
    } catch (err) {
      const errorMessage = 'Failed to load environment variables';
      setError(errorMessage);
      enqueueSnackbar(errorMessage, { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [enqueueSnackbar]);

  useEffect(() => {
    loadEnvVars();
  }, [loadEnvVars]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await axios.post(`${API_BASE}/env`, { envVars });
      setSuccess(true);
      enqueueSnackbar('Environment variables saved successfully!', { variant: 'success' });
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'Failed to save environment variables';
      setError(errorMessage);
      enqueueSnackbar(errorMessage, { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key, value) => {
    setEnvVars(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const toggleSensitiveVisibility = (key) => {
    setShowSensitive(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const renderField = (field) => {
    const value = envVars[field.key] || '';
    const isVisible = !field.sensitive || showSensitive[field.key];

    return (
      <Grid item xs={12} md={6} key={field.key}>
        <Card elevation={2} sx={{ height: '100%' }}>
          <CardHeader
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6">{field.label}</Typography>
                {field.sensitive && (
                  <Chip
                    label="Sensitive"
                    size="small"
                    color="warning"
                    variant="outlined"
                    icon={<SecurityIcon />}
                  />
                )}
              </Box>
            }
            subheader={field.description}
          />
          <CardContent>
            <TextField
              fullWidth
              value={value}
              onChange={(e) => handleChange(field.key, e.target.value)}
              type={isVisible ? 'text' : 'password'}
              multiline={field.multiline}
              rows={field.multiline ? 3 : 1}
              variant="outlined"
              size="small"
              InputProps={{
                endAdornment: field.sensitive && (
                  <IconButton
                    onClick={() => toggleSensitiveVisibility(field.key)}
                    edge="end"
                  >
                    {isVisible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                )
              }}
            />
          </CardContent>
        </Card>
      </Grid>
    );
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <SettingsIcon color="primary" sx={{ fontSize: '2rem' }} />
            Settings
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Configure environment variables for the RAG MongoDB pipeline.
          </Typography>
        </Box>
        <Tooltip title="Information">
          <IconButton onClick={() => setShowInfo(true)} size="large">
            <InfoIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Environment variables saved successfully!
        </Alert>
      )}

      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6">
            Environment Configuration
          </Typography>
          <Box>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadEnvVars}
              disabled={loading || saving}
              sx={{ mr: 1 }}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={loading || saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </Box>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={3}>
            {envFieldsConfig.map(renderField)}
          </Grid>
        )}
      </Paper>

      <Paper elevation={1} sx={{ p: 2, bgcolor: 'warning.light', color: 'warning.contrastText' }}>
        <Typography variant="h6" gutterBottom>
          ⚠️ Important Notes
        </Typography>
        <Typography variant="body2">
          • Changes to environment variables require a server restart to take effect.<br />
          • Keep your authentication tokens secure and never share them.<br />
          • Make sure your MongoDB URI includes the correct credentials and database name.<br />
          • Test your configuration after making changes.
        </Typography>
      </Paper>

      {/* Information Dialog */}
      <Dialog open={showInfo} onClose={() => setShowInfo(false)} maxWidth="md" fullWidth>
        <DialogTitle>Environment Variables Information</DialogTitle>
        <DialogContent>
          <Typography variant="body1" paragraph>
            This section allows you to configure the essential environment variables for your RAG MongoDB pipeline:
          </Typography>
          
          <Box sx={{ mt: 2 }}>
            {envFieldsConfig.map((field) => (
              <Box key={field.key} sx={{ mb: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold">
                  {field.label}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {field.description}
                </Typography>
              </Box>
            ))}
          </Box>

          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="body2">
              <strong>Security:</strong> Sensitive values like MongoDB URI and authentication tokens are masked by default. 
              Click the visibility icon to show/hide these values.
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowInfo(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Settings;