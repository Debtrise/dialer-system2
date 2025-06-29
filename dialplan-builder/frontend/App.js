import React, { useState, useEffect } from 'react';
import { Calendar, Users, Phone, Upload, Settings, PieChart } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = 'http://http://34.122.156.88:3001';

const DialerSystem = () => {
  // Authentication state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState('');
  
  // Current view state
  const [currentView, setCurrentView] = useState('login');
  
  // Schedule configuration
  const [schedule, setSchedule] = useState({
    monday: { enabled: true, start: '09:00', end: '17:00' },
    tuesday: { enabled: true, start: '09:00', end: '17:00' },
    wednesday: { enabled: true, start: '09:00', end: '17:00' },
    thursday: { enabled: true, start: '09:00', end: '17:00' },
    friday: { enabled: true, start: '09:00', end: '17:00' },
    saturday: { enabled: false, start: '09:00', end: '17:00' },
    sunday: { enabled: false, start: '09:00', end: '17:00' }
  });
  
  // Dialer configuration
  const [dialerConfig, setDialerConfig] = useState({
    enabled: true,
    speed: 1.5,
    minAgentsAvailable: 2,
    source: 'BTR',
    apiEndpoint: 'test',
    apiUser: 'Ytel2618231',
    apiPassword: '4USz9PfeiV8',
    autoDelete: false,
    sortOrder: 'oldest',
    didDistribution: 'even'
  });
  
  // AMI configuration
  const [amiConfig, setAmiConfig] = useState({
    host: '34.29.105.211',
    port: 5038,
    username: 'admin',
    password: 'admin',
    trunk: 'MC',
    context: 'p1Dialer'
  });
  
  // Agent status
  const [agentStatus, setAgentStatus] = useState({
    agentsLoggedIn: 0,
    agentsWaiting: 0,
    totalCalls: 0,
    callsWaiting: 0
  });
  
  // DIDs state
  const [dids, setDids] = useState([]);
  
  // Stats
  const [stats, setStats] = useState({
    dailyCalls: 0,
    transfers: 0,
    callsOver1Min: 0,
    callsOver5Min: 0,
    callsOver15Min: 0,
    connectionRate: 0,
    answerRate: 0
  });
  
  // Setup HTTP service with auth token
  const http = axios.create({
    baseURL: API_BASE_URL
  });
  
  http.interceptors.request.use(
    config => {
      if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
      }
      return config;
    },
    error => Promise.reject(error)
  );
  
  // Handle login
  const handleLogin = async (event) => {
    event.preventDefault();
    try {
      const response = await axios.post(`${API_BASE_URL}/login`, {
        username: event.target.username.value,
        password: event.target.password.value
      });
      
      setToken(response.data.token);
      setIsLoggedIn(true);
      setUser({
        username: response.data.username,
        role: response.data.role,
        tenantId: response.data.tenantId
      });
      
      // Store token in localStorage for persistence
      localStorage.setItem('token', response.data.token);
      
      // Fetch tenant data
      fetchTenantData(response.data.tenantId, response.data.token);
      
      setCurrentView('dashboard');
    } catch (error) {
      console.error('Login failed:', error);
      alert('Login failed: ' + (error.response?.data?.error || 'Unknown error'));
    }
  };
  
  // Fetch tenant data
  const fetchTenantData = async (tenantId, authToken) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/tenants/${tenantId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      
      const tenantData = response.data;
      
      // Update schedule
      if (tenantData.schedule) {
        setSchedule(tenantData.schedule);
      }
      
      // Update dialer config
      if (tenantData.dialerConfig) {
        setDialerConfig({
          ...dialerConfig,
          enabled: tenantData.dialerConfig.enabled !== false,
          speed: tenantData.dialerConfig.speed || 1.5,
          minAgentsAvailable: tenantData.dialerConfig.minAgentsAvailable || 2,
          source: tenantData.apiConfig?.source || 'BTR',
          apiEndpoint: tenantData.apiConfig?.endpoint || 'test',
          apiUser: tenantData.apiConfig?.user || 'Ytel2618231',
          apiPassword: tenantData.apiConfig?.password || '4USz9PfeiV8',
          autoDelete: tenantData.dialerConfig.autoDelete || false,
          sortOrder: tenantData.dialerConfig.sortOrder || 'oldest',
          didDistribution: tenantData.dialerConfig.didDistribution || 'even'
        });
      }
      
      // Update AMI config
      if (tenantData.amiConfig) {
        setAmiConfig({
          host: tenantData.amiConfig.host || '34.29.105.211',
          port: tenantData.amiConfig.port || 5038,
          username: tenantData.amiConfig.username || 'admin',
          password: tenantData.amiConfig.password || 'admin',
          trunk: tenantData.amiConfig.trunk || 'MC',
          context: tenantData.amiConfig.context || 'p1Dialer'
        });
      }
    } catch (error) {
      console.error('Error fetching tenant data:', error);
    }
  };
  
  // Check for saved token on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      // Validate token here
      setToken(savedToken);
      setIsLoggedIn(true);
      setCurrentView('dashboard');
      
      // Fetch user data
      // This would be a separate endpoint in a real system
    }
  }, []);
  
  // Fetch agent status
  useEffect(() => {
    if (isLoggedIn && token) {
      const fetchAgentStatus = async () => {
        try {
          const response = await axios.get(`${API_BASE_URL}/agent-status`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (response.data && response.data.length > 0) {
            const data = response.data[0];
            setAgentStatus({
              agentsLoggedIn: parseInt(data.agents_logged_in, 10) || 0,
              agentsWaiting: parseInt(data.agents_waiting, 10) || 0,
              totalCalls: parseInt(data.total_calls, 10) || 0,
              callsWaiting: parseInt(data.calls_waiting, 10) || 0
            });
          }
        } catch (error) {
          console.error('Error fetching agent status:', error);
        }
      };
      
      // Fetch initially
      fetchAgentStatus();
      
      // Then set up polling
      const interval = setInterval(fetchAgentStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn, token]);
  
  // Fetch DIDs when viewing DID management
  useEffect(() => {
    if (isLoggedIn && token && currentView === 'dids') {
      const fetchDIDs = async () => {
        try {
          const response = await axios.get(`${API_BASE_URL}/dids`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          setDids(response.data.dids || []);
        } catch (error) {
          console.error('Error fetching DIDs:', error);
        }
      };
      
      fetchDIDs();
    }
  }, [isLoggedIn, token, currentView]);
  
  // Handle schedule update
  const updateSchedule = (day, field, value) => {
    setSchedule({
      ...schedule,
      [day]: {
        ...schedule[day],
        [field]: value
      }
    });
  };
  
  // Handle dialer config update
  const updateDialerConfig = (field, value) => {
    setDialerConfig({
      ...dialerConfig,
      [field]: value
    });
  };
  
  // Handle AMI config update
  const updateAmiConfig = (field, value) => {
    setAmiConfig({
      ...amiConfig,
      [field]: value
    });
  };
  
  // Save tenant settings
  const saveTenantSettings = async () => {
    try {
      if (!user?.tenantId || !token) return;
      
      const tenantData = {
        apiConfig: {
          source: dialerConfig.source,
          endpoint: dialerConfig.apiEndpoint,
          user: dialerConfig.apiUser,
          password: dialerConfig.apiPassword
        },
        amiConfig: amiConfig,
        schedule: schedule,
        dialerConfig: {
          enabled: dialerConfig.enabled,
          speed: dialerConfig.speed,
          minAgentsAvailable: dialerConfig.minAgentsAvailable,
          autoDelete: dialerConfig.autoDelete,
          sortOrder: dialerConfig.sortOrder,
          didDistribution: dialerConfig.didDistribution
        }
      };
      
      await axios.put(`${API_BASE_URL}/tenants/${user.tenantId}`, tenantData, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      alert('Settings saved successfully!');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Error saving settings: ' + (error.response?.data?.error || 'Unknown error'));
    }
  };
  
  // Handle logout
  const handleLogout = () => {
    setIsLoggedIn(false);
    setUser(null);
    setToken('');
    localStorage.removeItem('token');
    setCurrentView('login');
  };
  
  // Navigate to view
  const navigateTo = (view) => {
    setCurrentView(view);
  };
  
  // Login view
  const LoginView = () => (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-96">
        <h1 className="text-2xl font-bold mb-6 text-center">Dialer System Login</h1>
        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-gray-700 mb-2">Username</label>
            <input
              type="text"
              name="username"
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
          </div>
          <div className="mb-6">
            <label className="block text-gray-700 mb-2">Password</label>
            <input
              type="password"
              name="password"
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600"
          >
            Log In
          </button>
        </form>
      </div>
    </div>
  );
  
  // Dashboard view
  const DashboardView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      <div className="bg-white p-4 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <Users className="mr-2" /> Agent Status
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-100 p-3 rounded">
            <p className="text-sm text-gray-500">Agents Logged In</p>
            <p className="text-2xl font-bold">{agentStatus.agentsLoggedIn}</p>
          </div>
          <div className="bg-gray-100 p-3 rounded">
            <p className="text-sm text-gray-500">Agents Waiting</p>
            <p className="text-2xl font-bold">{agentStatus.agentsWaiting}</p>
          </div>
          <div className="bg-gray-100 p-3 rounded">
            <p className="text-sm text-gray-500">Total Calls</p>
            <p className="text-2xl font-bold">{agentStatus.totalCalls}</p>
          </div>
          <div className="bg-gray-100 p-3 rounded">
            <p className="text-sm text-gray-500">Calls Waiting</p>
            <p className="text-2xl font-bold">{agentStatus.callsWaiting}</p>
          </div>
        </div>
      </div>
      
      <div className="bg-white p-4 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <Settings className="mr-2" /> Dialer Settings
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Dialer Speed</label>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={dialerConfig.speed}
              onChange={(e) => updateDialerConfig('speed', parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between">
              <span>0.5</span>
              <span className="font-bold">{dialerConfig.speed}</span>
              <span>3.0</span>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Min Agents</label>
            <input
              type="number"
              min="1"
              max="20"
              value={dialerConfig.minAgentsAvailable}
              onChange={(e) => updateDialerConfig('minAgentsAvailable', parseInt(e.target.value))}
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
          <button
            onClick={saveTenantSettings}
            className="w-full bg-green-500 text-white py-2 rounded hover:bg-green-600"
          >
            Save Settings
          </button>
        </div>
      </div>
      
      <div className="bg-white p-4 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <PieChart className="mr-2" /> Today's Stats
        </h2>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Daily Calls:</span>
            <span className="font-bold">{stats.dailyCalls}</span>
          </div>
          <div className="flex justify-between">
            <span>Transfers:</span>
            <span className="font-bold">{stats.transfers}</span>
          </div>
          <div className="flex justify-between">
            <span>Calls &gt; 1min:</span>
            <span className="font-bold">{stats.callsOver1Min}</span>
          </div>
          <div className="flex justify-between">
            <span>Connection Rate:</span>
            <span className="font-bold">{stats.connectionRate}%</span>
          </div>
          <div className="flex justify-between">
            <span>Answer Rate:</span>
            <span className="font-bold">{stats.answerRate}%</span>
          </div>
        </div>
      </div>
    </div>
  );

  // Schedule configuration view
  const ScheduleView = () => (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-4 flex items-center">
        <Calendar className="mr-2" /> Schedule Configuration (PST)
      </h2>
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(schedule).map(([day, config]) => (
            <div key={day} className="border p-4 rounded">
              <div className="flex justify-between items-center mb-3">
                <h3 className="capitalize font-medium">{day}</h3>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => updateSchedule(day, 'enabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={config.start}
                    onChange={(e) => updateSchedule(day, 'start', e.target.value)}
                    disabled={!config.enabled}
                    className="w-full p-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">End Time</label>
                  <input
                    type="time"
                    value={config.end}
                    onChange={(e) => updateSchedule(day, 'end', e.target.value)}
                    disabled={!config.enabled}
                    className="w-full p-2 border border-gray-300 rounded"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <button
            onClick={saveTenantSettings}
            className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600"
          >
            Save Schedule
          </button>
        </div>
      </div>
    </div>
  );
  
  // Settings view
  const SettingsView = () => (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-4 flex items-center">
        <Settings className="mr-2" /> System Configuration
      </h2>
      
      <div className="bg-white p-4 rounded-lg shadow mb-4">
        <h3 className="font-medium mb-3">API Configuration</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Source</label>
            <select
              value={dialerConfig.source}
              onChange={(e) => updateDialerConfig('source', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            >
              <option value="BTR">BTR</option>
              <option value="BDS">BDS</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">API Endpoint</label>
            <input
              type="text"
              value={dialerConfig.apiEndpoint}
              onChange={(e) => updateDialerConfig('apiEndpoint', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
              placeholder="e.g. test"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">API Username</label>
            <input
              type="text"
              value={dialerConfig.apiUser}
              onChange={(e) => updateDialerConfig('apiUser', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">API Password</label>
            <input
              type="password"
              value={dialerConfig.apiPassword}
              onChange={(e) => updateDialerConfig('apiPassword', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
        </div>
      </div>
      
      <div className="bg-white p-4 rounded-lg shadow mb-4">
        <h3 className="font-medium mb-3">AMI Configuration</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Host</label>
            <input
              type="text"
              value={amiConfig.host}
              onChange={(e) => updateAmiConfig('host', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Port</label>
            <input
              type="number"
              value={amiConfig.port}
              onChange={(e) => updateAmiConfig('port', parseInt(e.target.value))}
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Username</label>
            <input
              type="text"
              value={amiConfig.username}
              onChange={(e) => updateAmiConfig('username', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Password</label>
            <input
              type="password"
              value={amiConfig.password}
              onChange={(e) => updateAmiConfig('password', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Trunk</label>
            <input
              type="text"
              value={amiConfig.trunk}
              onChange={(e) => updateAmiConfig('trunk', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Context</label>
            <input
              type="text"
              value={amiConfig.context}
              onChange={(e) => updateAmiConfig('context', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            />
          </div>
        </div>
      </div>
      
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="font-medium mb-3">Lead Management</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-center">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={dialerConfig.enabled}
              onChange={(e) => updateDialerConfig('enabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            <span className="ml-3 text-sm font-medium text-gray-900">Dialer Enabled</span>
          </label>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Sort Order</label>
          <select
            value={dialerConfig.sortOrder}
            onChange={(e) => updateDialerConfig('sortOrder', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            >
              <option value="oldest">Oldest to Newest</option>
              <option value="fewest">Fewest Calls First</option>
            </select>
          </div>
          <div className="flex items-center">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={dialerConfig.autoDelete}
                onChange={(e) => updateDialerConfig('autoDelete', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              <span className="ml-3 text-sm font-medium text-gray-900">Auto Delete</span>
            </label>
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">DID Distribution</label>
            <select
              value={dialerConfig.didDistribution}
              onChange={(e) => updateDialerConfig('didDistribution', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
            >
              <option value="even">Even Distribution</option>
              <option value="local">Local-Based</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={saveTenantSettings}
            className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
  
  // Lead upload view
  const LeadUploadView = () => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    
    const handleFileChange = (event) => {
      setSelectedFile(event.target.files[0]);
    };
    
    const handleUpload = async () => {
      if (!selectedFile) {
        alert('Please select a file first');
        return;
      }
      
      setIsUploading(true);
      
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const fileContent = e.target.result;
          
          const options = {
            sortOrder: dialerConfig.sortOrder,
            autoDelete: dialerConfig.autoDelete
          };
          
          await axios.post(`${API_BASE_URL}/leads/upload`, {
            fileContent,
            options
          }, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          alert('Leads uploaded successfully!');
          setSelectedFile(null);
          
          // Reset file input
          const fileInput = document.getElementById('file-upload');
          if (fileInput) fileInput.value = '';
        } catch (error) {
          console.error('Upload failed:', error);
          alert('Upload failed: ' + (error.response?.data?.error || 'Unknown error'));
        } finally {
          setIsUploading(false);
        }
      };
      
      reader.readAsText(selectedFile);
    };
    
    return (
      <div className="p-4">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <Upload className="mr-2" /> Lead Upload
        </h2>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="border-dashed border-2 border-gray-300 rounded-lg p-8 text-center">
            <Upload className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-1 text-sm text-gray-600">Drag and drop a CSV file here, or click to select files</p>
            <input
              type="file"
              className="hidden"
              accept=".csv"
              id="file-upload"
              onChange={handleFileChange}
            />
            <button
              onClick={() => document.getElementById('file-upload').click()}
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Select File
            </button>
            {selectedFile && (
              <p className="mt-2 text-sm text-gray-600">
                Selected: {selectedFile.name}
              </p>
            )}
          </div>
          
          <div className="mt-6">
            <h3 className="font-medium mb-3">Upload Options</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dialerConfig.enabled}
                    onChange={(e) => updateDialerConfig('enabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  <span className="ml-3 text-sm font-medium text-gray-900">Dialer Enabled</span>
                </label>
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">Sort Order</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded"
                  value={dialerConfig.sortOrder}
                  onChange={(e) => updateDialerConfig('sortOrder', e.target.value)}
                >
                  <option value="oldest">Oldest to Newest</option>
                  <option value="fewest">Fewest Calls First</option>
                </select>
              </div>
              <div className="flex items-center">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dialerConfig.autoDelete}
                    onChange={(e) => updateDialerConfig('autoDelete', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  <span className="ml-3 text-sm font-medium text-gray-900">Auto Delete</span>
                </label>
              </div>
            </div>
            
            <button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              className={`mt-4 w-full py-2 rounded ${
                !selectedFile || isUploading
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-green-500 text-white hover:bg-green-600'
              }`}
            >
              {isUploading ? 'Uploading...' : 'Upload Leads'}
            </button>
          </div>
        </div>
      </div>
    );
  };
  
  // DID Management View
  const DIDManagementView = () => {
    const [newDID, setNewDID] = useState({ phoneNumber: '', description: '', areaCode: '', state: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [filterActive, setFilterActive] = useState('all');
    
    const handleAddDID = async (e) => {
      e.preventDefault();
      try {
        setIsLoading(true);
        
        await axios.post(`${API_BASE_URL}/dids`, newDID, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        // Refresh DIDs
        const response = await axios.get(`${API_BASE_URL}/dids`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        setDids(response.data.dids || []);
        setNewDID({ phoneNumber: '', description: '', areaCode: '', state: '' });
        
        alert('DID added successfully!');
      } catch (error) {
        console.error('Error adding DID:', error);
        alert('Error adding DID: ' + (error.response?.data?.error || 'Unknown error'));
      } finally {
        setIsLoading(false);
      }
    };
    
    const handleToggleDID = async (id, currentActive) => {
      try {
        setIsLoading(true);
        
        await axios.put(`${API_BASE_URL}/dids/${id}`, {
          isActive: !currentActive
        }, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        // Update local state
        setDids(dids.map(did => 
          did._id === id ? { ...did, isActive: !currentActive } : did
        ));
      } catch (error) {
        console.error('Error toggling DID:', error);
        alert('Error toggling DID: ' + (error.response?.data?.error || 'Unknown error'));
      } finally {
        setIsLoading(false);
      }
    };
    
    // Filter DIDs based on active status
    const filteredDids = dids.filter(did => {
      if (filterActive === 'all') return true;
      if (filterActive === 'active') return did.isActive;
      if (filterActive === 'inactive') return !did.isActive;
      return true;
    });
    
    return (
      <div className="p-4">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <Phone className="mr-2" /> DID Management
        </h2>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left column: Add new DID */}
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="font-medium mb-3">Add New DID</h3>
            <form onSubmit={handleAddDID}>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={newDID.phoneNumber}
                    onChange={(e) => setNewDID({...newDID, phoneNumber: e.target.value})}
                    placeholder="e.g. 8001234567"
                    className="w-full p-2 border border-gray-300 rounded"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Description</label>
                  <input
                    type="text"
                    value={newDID.description}
                    onChange={(e) => setNewDID({...newDID, description: e.target.value})}
                    placeholder="e.g. Sales Line"
                    className="w-full p-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Area Code</label>
                  <input
                    type="text"
                    value={newDID.areaCode}
                    onChange={(e) => setNewDID({...newDID, areaCode: e.target.value})}
                    placeholder="e.g. 800"
                    className="w-full p-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">State</label>
                  <input
                    type="text"
                    value={newDID.state}
                    onChange={(e) => setNewDID({...newDID, state: e.target.value})}
                    placeholder="e.g. CA"
                    className="w-full p-2 border border-gray-300 rounded"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600"
                >
                  {isLoading ? 'Adding...' : 'Add DID'}
                </button>
              </div>
            </form>
          </div>
          
          {/* Right column: DID Distribution Options */}
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="font-medium mb-3">DID Distribution Settings</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-500 mb-2">Distribution Method</label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="distribution"
                      checked={dialerConfig.didDistribution === 'even'}
                      onChange={() => updateDialerConfig('didDistribution', 'even')}
                      className="mr-2"
                    />
                    <span>Even Distribution (Round Robin)</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="distribution"
                      checked={dialerConfig.didDistribution === 'local'}
                      onChange={() => updateDialerConfig('didDistribution', 'local')}
                      className="mr-2"
                    />
                    <span>Local-Based (Match Area Code)</span>
                  </label>
                </div>
              </div>
              
              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">DID Statistics</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-100 p-2 rounded">
                    <p className="text-sm text-gray-500">Total DIDs</p>
                    <p className="text-lg font-bold">{dids.length}</p>
                  </div>
                  <div className="bg-gray-100 p-2 rounded">
                    <p className="text-sm text-gray-500">Active DIDs</p>
                    <p className="text-lg font-bold">{dids.filter(d => d.isActive).length}</p>
                  </div>
                </div>
              </div>
              
              <button
                onClick={saveTenantSettings}
                className="w-full mt-4 bg-green-500 text-white py-2 rounded hover:bg-green-600"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
        
        {/* DID Listing */}
        <div className="bg-white p-4 rounded-lg shadow mt-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-medium">Your DIDs</h3>
            <div className="flex space-x-2">
              <button
                className={`px-3 py-1 rounded ${filterActive === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                onClick={() => setFilterActive('all')}
              >
                All
              </button>
              <button
                className={`px-3 py-1 rounded ${filterActive === 'active' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                onClick={() => setFilterActive('active')}
              >
                Active
              </button>
              <button
                className={`px-3 py-1 rounded ${filterActive === 'inactive' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                onClick={() => setFilterActive('inactive')}
              >
                Inactive
              </button>
            </div>
          </div>
          
          {isLoading ? (
            <div className="text-center py-8">
              <p>Loading DIDs...</p>
            </div>
          ) : (
            <>
              {filteredDids.length === 0 ? (
                <div className="text-center py-8">
                  <p>No DIDs found. Add your first DID above.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone Number</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Area Code</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usage Count</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredDids.map(did => (
                        <tr key={did._id}>
                          <td className="px-6 py-4 whitespace-nowrap">{did.phoneNumber}</td>
                          <td className="px-6 py-4 whitespace-nowrap">{did.description || '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap">{did.areaCode || '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap">{did.usageCount || 0}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${did.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                              {did.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <button
                              onClick={() => handleToggleDID(did._id, did.isActive)}
                              className={`px-3 py-1 rounded text-white ${did.isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                            >
                              {did.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };
  
  // Reports view
  const ReportsView = () => {
    const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
    const [reportData, setReportData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    
    const fetchReport = async () => {
      try {
        setIsLoading(true);
        
        const response = await axios.get(`${API_BASE_URL}/reports/daily`, {
          params: { date: reportDate },
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        setReportData(response.data);
      } catch (error) {
        console.error('Error fetching report:', error);
        alert('Error fetching report: ' + (error.response?.data?.error || 'Unknown error'));
      } finally {
        setIsLoading(false);
      }
    };
    
    return (
      <div className="p-4">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <PieChart className="mr-2" /> Reports
        </h2>
        <div className="bg-white p-4 rounded-lg shadow mb-4">
          <h3 className="font-medium mb-3">Daily Report</h3>
          <div className="flex items-end gap-4 mb-4">
            <div className="flex-grow">
              <label className="block text-sm text-gray-500 mb-1">Date</label>
              <input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded"
              />
            </div>
            <button
              onClick={fetchReport}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300"
            >
              {isLoading ? 'Loading...' : 'Generate Report'}
            </button>
          </div>
          
          {reportData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div className="bg-gray-100 p-4 rounded">
                <p className="text-sm text-gray-500">Total Calls</p>
                <p className="text-2xl font-bold">{reportData.totalCalls}</p>
              </div>
              <div className="bg-gray-100 p-4 rounded">
                <p className="text-sm text-gray-500">Answered Calls</p>
                <p className="text-2xl font-bold">{reportData.answeredCalls}</p>
              </div>
              <div className="bg-gray-100 p-4 rounded">
                <p className="text-sm text-gray-500">Transfers</p>
                <p className="text-2xl font-bold">{reportData.transfers}</p>
              </div>
              <div className="bg-gray-100 p-4 rounded">
                <p className="text-sm text-gray-500">Calls &gt; 1min</p>
                <p className="text-2xl font-bold">{reportData.callsOver1Min}</p>
              </div>
              <div className="bg-gray-100 p-4 rounded">
                <p className="text-sm text-gray-500">Calls &gt; 5min</p>
                <p className="text-2xl font-bold">{reportData.callsOver5Min}</p>
              </div>
              <div className="bg-gray-100 p-4 rounded">
                <p className="text-sm text-gray-500">Calls &gt; 15min</p>
                <p className="text-2xl font-bold">{reportData.callsOver15Min}</p>
              </div>
              <div className="bg-gray-100 p-4 rounded">
                <p className="text-sm text-gray-500">Connection Rate</p>
                <p className="text-2xl font-bold">{reportData.connectionRate}%</p>
              </div>
              <div className="bg-gray-100 p-4 rounded">
                <p className="text-sm text-gray-500">Transfer Rate</p>
                <p className="text-2xl font-bold">{reportData.transferRate}%</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };
  
  // Main layout
  return (
    <div className="min-h-screen bg-gray-100">
      {!isLoggedIn ? (
        <LoginView />
      ) : (
        <div className="flex flex-col h-screen">
          {/* Header */}
          <header className="bg-white shadow">
            <div className="mx-auto px-4 py-4 flex justify-between items-center">
              <h1 className="text-xl font-bold">Dialer System</h1>
              <div className="flex items-center">
                <span className="mr-4">{user?.username}</span>
                <button 
                  onClick={handleLogout}
                  className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
                >
                  Logout
                </button>
              </div>
            </div>
          </header>
          
          {/* Main Content */}
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar */}
            <aside className="w-56 bg-gray-800 text-white p-4">
              <nav>
                <ul className="space-y-2">
                  <li>
                    <button
                      onClick={() => navigateTo('dashboard')}
                      className={`flex items-center w-full px-4 py-2 rounded ${
                        currentView === 'dashboard' ? 'bg-blue-600' : 'hover:bg-gray-700'
                      }`}
                    >
                      <PieChart className="mr-2 h-5 w-5" />
                      Dashboard
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => navigateTo('schedule')}
                      className={`flex items-center w-full px-4 py-2 rounded ${
                        currentView === 'schedule' ? 'bg-blue-600' : 'hover:bg-gray-700'
                      }`}
                    >
                      <Calendar className="mr-2 h-5 w-5" />
                      Schedule
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => navigateTo('leads')}
                      className={`flex items-center w-full px-4 py-2 rounded ${
                        currentView === 'leads' ? 'bg-blue-600' : 'hover:bg-gray-700'
                      }`}
                    >
                      <Upload className="mr-2 h-5 w-5" />
                      Lead Upload
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => navigateTo('dids')}
                      className={`flex items-center w-full px-4 py-2 rounded ${
                        currentView === 'dids' ? 'bg-blue-600' : 'hover:bg-gray-700'
                      }`}
                    >
                      <Phone className="mr-2 h-5 w-5" />
                      DID Management
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => navigateTo('settings')}
                      className={`flex items-center w-full px-4 py-2 rounded ${
                        currentView === 'settings' ? 'bg-blue-600' : 'hover:bg-gray-700'
                      }`}
                    >
                      <Settings className="mr-2 h-5 w-5" />
                      Settings
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => navigateTo('reports')}
                      className={`flex items-center w-full px-4 py-2 rounded ${
                        currentView === 'reports' ? 'bg-blue-600' : 'hover:bg-gray-700'
                      }`}
                    >
                      <PieChart className="mr-2 h-5 w-5" />
                      Reports
                    </button>
                  </li>
                </ul>
              </nav>
            </aside>
            
            {/* Content */}
            <main className="flex-1 overflow-auto">
              {currentView === 'dashboard' && <DashboardView />}
              {currentView === 'schedule' && <ScheduleView />}
              {currentView === 'leads' && <LeadUploadView />}
              {currentView === 'settings' && <SettingsView />}
              {currentView === 'reports' && <ReportsView />}
              {currentView === 'dids' && <DIDManagementView />}
            </main>
          </div>
        </div>
      )}
    </div>
  );
};

export default DialerSystem;
