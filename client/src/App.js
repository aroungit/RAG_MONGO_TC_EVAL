import React, { useState, useEffect } from 'react';
import {
  CssBaseline,
  ThemeProvider,
  createTheme,
  Box,
  AppBar,
  Toolbar,
  Typography,
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Divider,
  Container,
  IconButton,
  Tooltip,
  Breadcrumbs,
  Link,
  useMediaQuery,
  Collapse,
  Switch,
  FormControlLabel,
  Fade
} from '@mui/material';
import {
  Transform as TransformIcon,
  Storage as StorageIcon,
  Settings as SettingsIcon,
  Search as SearchIcon,
  Dashboard as DashboardIcon,
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  Brightness4 as DarkModeIcon,
  Brightness7 as LightModeIcon,
  NavigateNext as NavigateNextIcon,
  TextFields as KeywordIcon,
  AutoFixHigh as HybridIcon,
  CompareArrows as RerankIcon,
  Psychology as PreprocessIcon,
  Summarize as SummarizeIcon,
  Schema as SchemaIcon
} from '@mui/icons-material';
import { SnackbarProvider } from 'notistack';

// Import components
import ConvertToJson from './components/data/ConvertToJson';
import EmbeddingsStore from './components/data/EmbeddingsStore';
import QuerySearch from './components/search/QuerySearch';
import BM25Search from './components/search/BM25Search';
import HybridSearch from './components/search/HybridSearch';
import RerankingSearch from './components/search/RerankingSearch';
import QueryPreprocessing from './components/processing/QueryPreprocessing';
import SummarizationDedup from './components/processing/SummarizationDedup';
import PromptSchemaManager from './components/processing/PromptSchemaManager';
import Settings from './components/settings/Settings';

// Enterprise color palette
const createEnterpriseTheme = (mode) => createTheme({
  palette: {
    mode,
    primary: {
      main: '#0D47A1', // Deep blue
      light: '#5472D3',
      dark: '#002171',
      contrastText: '#ffffff'
    },
    secondary: {
      main: '#FF6F00', // Amber
      light: '#FF9F40',
      dark: '#C43E00',
      contrastText: '#000000'
    },
    background: {
      default: mode === 'light' ? '#F4F6F8' : '#121212',
      paper: mode === 'light' ? '#FFFFFF' : '#1E1E1E'
    },
    text: {
      primary: mode === 'light' ? '#1A1A1A' : '#FFFFFF',
      secondary: mode === 'light' ? '#6B7280' : '#B0B0B0'
    }
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 700,
      fontSize: '2rem',
      lineHeight: 1.2,
      letterSpacing: '-0.02em'
    },
    h6: {
      fontWeight: 600,
      fontSize: '1.125rem',
      lineHeight: 1.3
    },
    subtitle1: {
      fontWeight: 500,
      fontSize: '1rem',
      lineHeight: 1.4
    },
    body1: {
      fontSize: '0.875rem',
      lineHeight: 1.5
    },
    body2: {
      fontSize: '0.75rem',
      lineHeight: 1.4
    }
  },
  components: {
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }
      }
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: '8px',
          margin: '2px 8px',
          '&.Mui-selected': {
            borderLeft: '4px solid #FF6F00',
            backgroundColor: 'rgba(13, 71, 161, 0.08)',
            '&:hover': {
              backgroundColor: 'rgba(13, 71, 161, 0.12)',
            }
          },
          '&:hover': {
            backgroundColor: 'rgba(13, 71, 161, 0.04)',
          }
        }
      }
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }
      }
    }
  }
});

const drawerWidth = 280;
const collapsedDrawerWidth = 72;

const menuItems = [
  {
    id: 'convert',
    label: 'Convert to JSON',
    icon: <TransformIcon />,
    component: ConvertToJson,
    description: 'Upload and convert Excel files (Test Cases or User Stories)'
  },
  {
    id: 'embeddings',
    label: 'Embeddings & Store',
    icon: <StorageIcon />,
    component: EmbeddingsStore,
    description: 'Create and manage embeddings'
  },
  {
    id: 'preprocess',
    label: 'Query Preprocessing',
    icon: <PreprocessIcon />,
    component: QueryPreprocessing,
    description: 'Transform & expand queries'
  },
  {
    id: 'query',
    label: 'Vector Search',
    icon: <SearchIcon />,
    component: QuerySearch,
    description: 'Semantic vector search'
  },
  {
    id: 'bm25',
    label: 'BM25 Search',
    icon: <KeywordIcon />,
    component: BM25Search,
    description: 'Keyword-based search'
  },
  {
    id: 'hybrid',
    label: 'Hybrid Search',
    icon: <HybridIcon />,
    component: HybridSearch,
    description: 'Combined BM25 + Vector'
  },
  {
    id: 'rerank',
    label: 'Score Fusion',
    icon: <RerankIcon />,
    component: RerankingSearch,
    description: 'BM25+Vector fusion reranking'
  },
  {
    id: 'summarize',
    label: 'Summarize & Dedup',
    icon: <SummarizeIcon />,
    component: SummarizationDedup,
    description: 'AI summarization & deduplication'
  },
  {
    id: 'prompt-schema',
    label: 'Prompt & Schema',
    icon: <SchemaIcon />,
    component: PromptSchemaManager,
    description: 'Configure prompt templates & JSON schemas'
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <SettingsIcon />,
    component: Settings,
    description: 'Configure environment'
  },
];

function App() {
  const [selectedMenuItem, setSelectedMenuItem] = useState('convert');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });

  const isMobile = useMediaQuery('(max-width:768px)');
  const theme = createEnterpriseTheme(darkMode ? 'dark' : 'light');

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
  }, [darkMode]);

  useEffect(() => {
    if (isMobile) {
      setDrawerOpen(false);
    } else {
      setDrawerOpen(true);
    }
  }, [isMobile]);

  const handleDrawerToggle = () => {
    setDrawerOpen(!drawerOpen);
  };

  const handleThemeToggle = () => {
    setDarkMode(!darkMode);
  };

  const getCurrentComponent = () => {
    const menuItem = menuItems.find(item => item.id === selectedMenuItem);
    const Component = menuItem?.component;
    return Component ? <Component /> : <div>Select a menu item</div>;
  };

  const getCurrentMenuItem = () => {
    return menuItems.find(item => item.id === selectedMenuItem);
  };

  const actualDrawerWidth = drawerOpen ? drawerWidth : collapsedDrawerWidth;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider
        maxSnack={3}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        dense
        preventDuplicate
      >
        <Box sx={{ display: 'flex' }}>
          {/* App Bar */}
          <AppBar
            position="fixed"
            sx={{
              width: { sm: `calc(100% - ${actualDrawerWidth}px)` },
              ml: { sm: `${actualDrawerWidth}px` },
              transition: theme.transitions.create(['width', 'margin'], {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.leavingScreen,
              }),
            }}
          >
            <Toolbar>
              <IconButton
                color="inherit"
                edge="start"
                onClick={handleDrawerToggle}
                sx={{ mr: 2 }}
              >
                {drawerOpen ? <ChevronLeftIcon /> : <MenuIcon />}
              </IconButton>

              <DashboardIcon sx={{ mr: 2 }} />
              <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
                RAG Pipeline
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={darkMode}
                    onChange={handleThemeToggle}
                    icon={<LightModeIcon />}
                    checkedIcon={<DarkModeIcon />}
                  />
                }
                label=""
                sx={{ mr: 1 }}
              />
            </Toolbar>

            {/* Secondary Toolbar for Breadcrumbs */}
            <Toolbar variant="dense" sx={{ bgcolor: 'primary.dark', minHeight: '48px !important' }}>
              <Breadcrumbs
                separator={<NavigateNextIcon fontSize="small" />}
                sx={{ color: 'primary.contrastText' }}
              >
                <Link
                  component="button"
                  variant="body2"
                  sx={{
                    color: 'inherit',
                    textDecoration: 'none',
                    '&:hover': { textDecoration: 'underline' }
                  }}
                  onClick={() => setSelectedMenuItem('convert')}
                >
                  Home
                </Link>
                <Typography variant="body2" sx={{ color: 'primary.contrastText' }}>
                  {getCurrentMenuItem()?.label}
                </Typography>
              </Breadcrumbs>

              <Box sx={{ flexGrow: 1 }} />

              <Typography variant="caption" sx={{ color: 'primary.contrastText', opacity: 0.8 }}>
                {getCurrentMenuItem()?.description}
              </Typography>
            </Toolbar>
          </AppBar>

          {/* Sidebar */}
          <Drawer
            variant={isMobile ? 'temporary' : 'permanent'}
            open={isMobile ? drawerOpen : true}
            onClose={handleDrawerToggle}
            sx={{
              width: actualDrawerWidth,
              flexShrink: 0,
              '& .MuiDrawer-paper': {
                width: actualDrawerWidth,
                boxSizing: 'border-box',
                transition: theme.transitions.create('width', {
                  easing: theme.transitions.easing.sharp,
                  duration: theme.transitions.duration.enteringScreen,
                }),
                overflowX: 'hidden',
              },
            }}
          >
            <Toolbar>
              <Fade in={drawerOpen} timeout={300}>
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 'bold',
                      color: 'primary.main',
                      fontSize: '1.1rem'
                    }}
                  >
                    Navigation
                  </Typography>
                </Box>
              </Fade>
              {!drawerOpen && (
                <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                  <DashboardIcon color="primary" />
                </Box>
              )}
            </Toolbar>

            <Divider />

            <List sx={{ pt: 2 }}>
              {menuItems.map((item) => (
                <ListItem key={item.id} disablePadding>
                  <Tooltip
                    title={drawerOpen ? '' : item.label}
                    placement="right"
                    arrow
                  >
                    <ListItemButton
                      selected={selectedMenuItem === item.id}
                      onClick={() => setSelectedMenuItem(item.id)}
                      sx={{
                        minHeight: 48,
                        justifyContent: drawerOpen ? 'initial' : 'center',
                        px: 2.5,
                      }}
                    >
                      <ListItemIcon
                        sx={{
                          minWidth: 0,
                          mr: drawerOpen ? 3 : 'auto',
                          justifyContent: 'center',
                          color: selectedMenuItem === item.id ? 'primary.main' : 'inherit'
                        }}
                      >
                        {item.icon}
                      </ListItemIcon>

                      <Collapse in={drawerOpen} orientation="horizontal" timeout={300}>
                        <ListItemText
                          primary={item.label}
                          secondary={item.description}
                          primaryTypographyProps={{
                            fontSize: '0.875rem',
                            fontWeight: selectedMenuItem === item.id ? 600 : 400,
                          }}
                          secondaryTypographyProps={{
                            fontSize: '0.75rem',
                            color: 'text.secondary'
                          }}
                        />
                      </Collapse>
                    </ListItemButton>
                  </Tooltip>
                </ListItem>
              ))}
            </List>

            <Divider sx={{ mt: 'auto' }} />

            <Box sx={{ p: 2 }}>
              <Collapse in={drawerOpen} timeout={300}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                  RAG Demo v1.2
                </Typography>
                <br />
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                  Enterprise Edition
                </Typography>
              </Collapse>
            </Box>
          </Drawer>

          {/* Main Content */}
          <Box
            component="main"
            sx={{
              flexGrow: 1,
              bgcolor: 'background.default',
              p: { xs: 2, sm: 3 },
              minHeight: '100vh',
              transition: theme.transitions.create(['margin', 'width'], {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.leavingScreen,
              }),
            }}
          >
            <Toolbar />
            <Toolbar variant="dense" /> {/* Space for secondary toolbar */}

            <Container maxWidth={false} sx={{ mt: 2, px: 4 }}>
              <Fade in={true} timeout={500}>
                <Box>
                  {getCurrentComponent()}
                </Box>
              </Fade>
            </Container>
          </Box>
        </Box>
      </SnackbarProvider>
    </ThemeProvider>
  );
}

export default App;
