  description: { type: String },
  areaCode: { type: String },
  state: { type: String },
  isActive: { type: Boolean, default: true },
  usageCount: { type: Number, default: 0 },
  lastUsed: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', userSchema);
const Tenant = mongoose.model('Tenant', tenantSchema);
const Lead = mongoose.model('Lead', leadSchema);
const CallLog = mongoose.model('CallLog', callLogSchema);
const DID = mongoose.model('DID', didSchema);

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access denied' });
  
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

// Auth routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email, tenantId, role } = req.body;
    
    const userExists = await User.findOne({ username });
    if (userExists) return res.status(400).json({ error: 'User already exists' });
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const user = new User({
      username,
      password: hashedPassword,
      email,
      tenantId,
      role,
      permissions: {}
    });
    
    await user.save();
    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid username or password' });
    
    const token = jwt.sign(
      { id: user._id, username: user.username, tenantId: user.tenantId, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );
    
    res.json({ token, userId: user._id, username: user.username, tenantId: user.tenantId, role: user.role });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Tenant routes
app.post('/api/tenants', async (req, res) => {
  try {
    const tenant = new Tenant(req.body);
    await tenant.save();
    res.status(201).json(tenant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/tenants/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.tenantId !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    
    res.json(tenant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/tenants/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.tenantId !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const tenant = await Tenant.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    
    res.json(tenant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Lead routes
app.post('/api/leads/upload', authenticateToken, async (req, res) => {
  try {
    const { fileContent, options } = req.body;
    const tenantId = req.user.tenantId;
    
    const results = [];
    const stream = Readable.from(fileContent);
    
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });
    
    const leads = results.map(row => {
      const lead = {
        tenantId,
        phone: row.phone || row.Phone || row.PhoneNumber || row.phone_number || '',
        name: row.name || row.Name || row.FullName || row.full_name || '',
        email: row.email || row.Email || '',
        additionalData: {}
      };
      
      Object.keys(row).forEach(key => {
        if (!['phone', 'Phone', 'PhoneNumber', 'phone_number', 'name', 'Name', 'FullName', 'full_name', 'email', 'Email'].includes(key)) {
          lead.additionalData[key] = row[key];
        }
      });
      
      return lead;

    });
    
    const validLeads = leads.filter(lead => lead.phone);
    
    if (validLeads.length === 0) {
      return res.status(400).json({ error: 'No valid leads found' });
    }
    
    await Lead.insertMany(validLeads);
    
    res.status(201).json({ message: `${validLeads.length} leads imported successfully` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/leads', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const tenantId = req.user.tenantId;
    
    const query = { tenantId };
    if (status) query.status = status;
    
    const leads = await Lead.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const count = await Lead.countDocuments(query);
    
    res.json({
      leads,
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Agent status endpoint
app.get('/api/agent-status', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    
    let apiUrl;
    if (tenant.apiConfig.source === 'BTR') {
      apiUrl = 'https://btr.ytel.com/x5/api/non_agent_api.php';
    } else {
      apiUrl = 'https://bds.ytel.com/x5/api/non_agent_api.php';
    }
    
    const apiParams = {
      source: tenant.apiConfig.endpoint,
      user: tenant.apiConfig.user,
      pass: tenant.apiConfig.password,
      stage: 'csv',
      function: 'in_group_status',
      header: 'YES'
    };
    
    const response = await axios.get(apiUrl, { params: apiParams });
    
    const results = [];
    const stream = Readable.from(response.data);
    
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });
    
    const agentStatuses = results.map(row => ({
      ingroup: row.ingroup || '',
      agents_logged_in: parseInt(row.agents_logged_in, 10) || 0,
      agents_waiting: parseInt(row.agents_waiting, 10) || 0,
      total_calls: parseInt(row.total_calls, 10) || 0,
      calls_waiting: parseInt(row.calls_waiting, 10) || 0,
      brand: 'Tax',
      source: tenant.apiConfig.source
    }));
    
    res.json(agentStatuses);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Make call endpoint
app.post('/api/make-call', authenticateToken, async (req, res) => {
  try {
    const { to, transfer_number, from, trunk, context, exten, priority, timeout, async, variables } = req.body;
    const tenantId = req.user.tenantId;
    
    if (!to || !transfer_number || !from) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    
    // Create call log
    const callLog = new CallLog({
      tenantId,
      to,
      from,
      transferNumber: transfer_number,
      status: 'initiated'
    });
    
    await callLog.save();
    
    // AMI client
    const ami = new AmiClient();
    
    try {
      await ami.connect(
        tenant.amiConfig.host,
        tenant.amiConfig.port,
        tenant.amiConfig.username,
        tenant.amiConfig.password
      );
      
      let variableString = `transfer_number=${transfer_number},to=${to}`;
      
      if (variables) {
        Object.entries(variables).forEach(([key, value]) => {
          variableString += `,${key}=${value}`;
        });
      }
      
      const action = {
        Action: 'Originate',
        Channel: `PJSIP/${to}@${trunk || tenant.amiConfig.trunk}`,
        Context: context || tenant.amiConfig.context,
        Exten: exten || 's',
        Priority: priority || 1,
        CallerID: from,
        Timeout: timeout || 40000,
        Async: async || 'true',
        Variable: variableString
      };
      
      const response = await ami.action(action);
      await ami.disconnect();
      
      await CallLog.findByIdAndUpdate(callLog._id, { status: 'initiated' });
      
      res.json({ 
        message: 'Call initiated successfully',
        callId: callLog._id,
        amiResponse: response
      });
    } catch (error) {
      await CallLog.findByIdAndUpdate(callLog._id, { status: 'failed' });
      throw error;
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DID routes
app.get('/api/dids', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, isActive } = req.query;
    const tenantId = req.user.tenantId;
    
    const query = { tenantId };
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    const dids = await DID.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ phoneNumber: 1 });
    
    const count = await DID.countDocuments(query);
    
    res.json({
      dids,
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/dids', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber, description, areaCode, state } = req.body;
    const tenantId = req.user.tenantId;
    
    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber.replace(/\D/g, ''))) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    
    const did = new DID({
      tenantId,
      phoneNumber,
      description,
      areaCode: areaCode || phoneNumber.replace(/\D/g, '').substring(0, 3),
      state,
      isActive: true
    });
    
    await did.save();
    res.status(201).json(did);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/dids/:id', authenticateToken, async (req, res) => {
  try {
    const { description, isActive } = req.body;
    const tenantId = req.user.tenantId;
    
    const did = await DID.findById(req.params.id);
    if (!did) return res.status(404).json({ error: 'DID not found' });
    
    if (did.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const updatedDid = await DID.findByIdAndUpdate(
      req.params.id,
      { $set: { description, isActive } },
      { new: true }
    );
    
    res.json(updatedDid);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reports routes
app.get('/api/reports/daily', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { date } = req.query;
    
    const startDate = date ? new Date(date) : new Date();
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
    
    const calls = await CallLog.find({
      tenantId,
      startTime: { $gte: startDate, $lte: endDate }
    });
    
    const totalCalls = calls.length;
    const answeredCalls = calls.filter(call => call.status !== 'failed' && call.status !== 'initiated').length;
    const transfers = calls.filter(call => call.status === 'transferred').length;
    
    const callsOver1Min = calls.filter(call => call.duration && call.duration >= 60).length;
    const callsOver5Min = calls.filter(call => call.duration && call.duration >= 300).length;
    const callsOver15Min = calls.filter(call => call.duration && call.duration >= 900).length;
    
    const connectionRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;
    const transferRate = answeredCalls > 0 ? (transfers / answeredCalls) * 100 : 0;
    
    res.json({
      date: startDate,
      totalCalls,
      answeredCalls,
      transfers,
      callsOver1Min,
      callsOver5Min,
      callsOver15Min,
      connectionRate: connectionRate.toFixed(2),
      transferRate: transferRate.toFixed(2)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
