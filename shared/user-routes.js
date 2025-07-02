// user-routes.js
// Comprehensive user management routes - FIXED VERSION

const express = require('express');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const moment = require('moment');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();

  const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    next();
  };
  
  // Get User model from sequelize
  const User = sequelize.models.User;
  
  if (!User) {
    throw new Error('User model not found in sequelize models');
  }
  
  // ===== User Management Routes (Admin Only) =====
  
  // List all users (admin only, filtered by tenant)
  router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
      
      const { page = 1, limit = 50, role, status, search } = req.query;
      const tenantId = req.user.tenantId;
      
      // Build query conditions
      const whereConditions = { tenantId };
      
      if (role) {
        whereConditions.role = role;
      }
      
      if (status) {
        whereConditions.isActive = status === 'active';
      }
      
      if (search) {
        whereConditions[Op.or] = [
          { username: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } }
        ];
      }
      
      const users = await User.findAll({
        where: whereConditions,
        attributes: { exclude: ['password'] }, // Never send passwords
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        order: [['createdAt', 'DESC']]
      });
      
      const totalCount = await User.count({ where: whereConditions });
      
      res.json({
        users,
        totalCount,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit))
      });
    } catch (error) {
      console.error('Error listing users:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get user by ID (admin only, or user viewing their own profile)
  router.get('/users/:id', authenticateToken, async (req, res) => {
    try {
      // Handle 'me' parameter first - convert to actual user ID
      const userId = req.params.id === 'me' ? req.user.id : req.params.id;
      const requesterId = req.user.id;
      const requesterRole = req.user.role;
      const tenantId = req.user.tenantId;
      
      // Users can view their own profile, admins can view any user in their tenant
      if (requesterRole !== 'admin' && parseInt(userId) !== requesterId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const user = await User.findOne({ 
        where: { id: userId, tenantId: tenantId },
        attributes: { exclude: ['password'] } // Never send passwords
      });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Add user statistics for admin view
      if (requesterRole === 'admin') {
        // Get user activity stats (you can expand this based on your needs)
        const stats = {
          lastLogin: user.lastLogin || null,
          accountCreated: user.createdAt,
          isActive: user.isActive !== false
        };
        
        res.json({
          ...user.toJSON(),
          stats
        });
      } else {
        res.json(user);
      }
    } catch (error) {
      console.error('Error getting user:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create new user (admin only)
  router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
      
      const { username, password, email, role = 'agent' } = req.body;
      const tenantId = req.user.tenantId;
      
      // Validation
      if (!username || !password || !email) {
        return res.status(400).json({ error: 'Username, password, and email are required' });
      }
      
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
      }
      
      if (!['admin', 'agent'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role. Must be admin or agent' });
      }
      
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      
      // Check if username already exists
      const existingUser = await User.findOne({ where: { username } });
      if (existingUser) {
        return res.status(400).json({ error: 'Username already exists' });
      }
      
      // Check if email already exists in this tenant
      const existingEmail = await User.findOne({ 
        where: { 
          email,
          tenantId 
        } 
      });
      if (existingEmail) {
        return res.status(400).json({ error: 'Email already exists in this organization' });
      }
      
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      // Create user
      const user = await User.create({
        username,
        password: hashedPassword,
        email,
        tenantId,
        role,
        isActive: true,
        createdBy: req.user.id
      });
      
      // Return user without password
      const { password: _, ...userWithoutPassword } = user.toJSON();
      res.status(201).json({
        message: 'User created successfully',
        user: userWithoutPassword
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Update user (admin only, or user updating their own profile)
  router.put('/users/:id', authenticateToken, async (req, res) => {
    try {
      // Handle 'me' parameter first - convert to actual user ID
      const userId = req.params.id === 'me' ? req.user.id : req.params.id;
      const requesterId = req.user.id;
      const requesterRole = req.user.role;
      const tenantId = req.user.tenantId;
      
      // Users can update their own profile, admins can update any user in their tenant
      const canUpdate = requesterRole === 'admin' || parseInt(userId) === requesterId;
      if (!canUpdate) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const user = await User.findOne({
        where: { 
          id: userId,
          tenantId 
        }
      });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const { email, role, permissions, isActive, firstName, lastName, phone, timezone, preferences } = req.body;
      const updates = {};
      
      // Email update
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        
        // Check if email already exists (excluding current user)
        const existingEmail = await User.findOne({
          where: {
            email,
            tenantId,
            id: { [Op.ne]: userId }
          }
        });
        
        if (existingEmail) {
          return res.status(400).json({ error: 'Email already exists in this organization' });
        }
        
        updates.email = email;
      }
      
      // Role update (admin only)
      if (role !== undefined) {
        if (requesterRole !== 'admin') {
          return res.status(403).json({ error: 'Only admins can change user roles' });
        }
        
        if (!['admin', 'agent'].includes(role)) {
          return res.status(400).json({ error: 'Invalid role. Must be admin or agent' });
        }
        
        updates.role = role;
      }

      // Permissions update (admin only)
      if (permissions !== undefined) {
        if (requesterRole !== 'admin') {
          return res.status(403).json({ error: 'Only admins can change user permissions' });
        }
        if (typeof permissions !== 'object') {
          return res.status(400).json({ error: 'Permissions must be an object' });
        }
        updates.permissions = permissions;
      }
      
      // Status update (admin only)
      if (isActive !== undefined) {
        if (requesterRole !== 'admin') {
          return res.status(403).json({ error: 'Only admins can change user status' });
        }
        
        updates.isActive = isActive;
      }
      
      // Profile fields (users can update their own, admins can update anyone's)
      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;
      if (phone !== undefined) updates.phone = phone;
      if (timezone !== undefined) updates.timezone = timezone;
      if (preferences !== undefined) updates.preferences = preferences;
      
      // Prevent admins from deactivating themselves
      if (isActive === false && parseInt(userId) === requesterId) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
      }
      
      // Update user
      await user.update(updates);
      
      // Return updated user without password
      const { password: _, ...userWithoutPassword } = user.toJSON();
      res.json({
        message: 'User updated successfully',
        user: userWithoutPassword
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update role and permissions (admin only)
  router.put('/users/:id/role-permissions', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { role, permissions } = req.body;
      const user = await User.findOne({
        where: { id: req.params.id, tenantId: req.user.tenantId }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const updates = {};

      if (role !== undefined) {
        if (!['admin', 'agent'].includes(role)) {
          return res.status(400).json({ error: 'Invalid role. Must be admin or agent' });
        }
        updates.role = role;
      }

      if (permissions !== undefined) {
        if (typeof permissions !== 'object') {
          return res.status(400).json({ error: 'Permissions must be an object' });
        }
        updates.permissions = permissions;
      }

      await user.update(updates);

      const { password: _pw, ...userWithoutPassword } = user.toJSON();
      res.json({ message: 'Role/permissions updated', user: userWithoutPassword });
    } catch (error) {
      console.error('Error updating role/permissions:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Delete user (admin only)
  router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
      
      // Handle 'me' parameter first - convert to actual user ID
      const userId = req.params.id === 'me' ? req.user.id : req.params.id;
      const requesterId = req.user.id;
      const tenantId = req.user.tenantId;
      
      // Prevent admins from deleting themselves
      if (parseInt(userId) === requesterId) {
        return res.status(400).json({ error: 'You cannot delete your own account' });
      }
      
      const user = await User.findOne({
        where: { 
          id: userId,
          tenantId 
        }
      });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Soft delete - deactivate instead of actually deleting
      await user.update({ 
        isActive: false,
        deletedAt: new Date(),
        deletedBy: requesterId
      });
      
      res.json({
        message: 'User deleted successfully',
        userId
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // ===== User Profile Routes =====
  
  // Get current user profile
  router.get('/users/profile/me', authenticateToken, async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id, {
        attributes: { exclude: ['password'] }
      });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      res.json(user);
    } catch (error) {
      console.error('Error getting user profile:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Update current user profile
  router.put('/users/profile/me', authenticateToken, async (req, res) => {
    try {
      const { email, firstName, lastName, phone, timezone, preferences } = req.body;
      const user = await User.findByPk(req.user.id);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const updates = {};
      
      // Email update with validation
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        
        // Check if email already exists (excluding current user)
        const existingEmail = await User.findOne({
          where: {
            email,
            tenantId: user.tenantId,
            id: { [Op.ne]: user.id }
          }
        });
        
        if (existingEmail) {
          return res.status(400).json({ error: 'Email already exists in this organization' });
        }
        
        updates.email = email;
      }
      
      // Profile fields
      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;
      if (phone !== undefined) updates.phone = phone;
      if (timezone !== undefined) updates.timezone = timezone;
      if (preferences !== undefined) updates.preferences = preferences;
      
      await user.update(updates);
      
      // Return updated user without password
      const { password: _, ...userWithoutPassword } = user.toJSON();
      res.json({
        message: 'Profile updated successfully',
        user: userWithoutPassword
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Change password
  router.put('/users/change-password', authenticateToken, async (req, res) => {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;
      
      // Validation
      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'All password fields are required' });
      }
      
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'New passwords do not match' });
      }
      
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long' });
      }
      
      // Get user with password
      const user = await User.findByPk(req.user.id);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Verify current password
      const validPassword = await bcrypt.compare(currentPassword, user.password);
      if (!validPassword) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      
      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      
      // Update password
      await user.update({ 
        password: hashedPassword,
        passwordChangedAt: new Date()
      });
      
      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('Error changing password:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // ===== User Status Management =====
  
  // Update user status (admin only)
  router.put('/users/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
      
      // Handle 'me' parameter first - convert to actual user ID
      const userId = req.params.id === 'me' ? req.user.id : req.params.id;
      const requesterId = req.user.id;
      const { isActive } = req.body;
      
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive must be a boolean value' });
      }
      
      // Prevent admins from deactivating themselves
      if (isActive === false && parseInt(userId) === requesterId) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
      }
      
      const user = await User.findOne({
        where: { 
          id: userId,
          tenantId: req.user.tenantId 
        }
      });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      await user.update({ isActive });
      
      res.json({
        message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
        userId,
        isActive
      });
    } catch (error) {
      console.error('Error updating user status:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // ===== User Statistics =====
  
  // Get user statistics (admin only)
  router.get('/users/stats/overview', authenticateToken, requireAdmin, async (req, res) => {
    try {
      
      const tenantId = req.user.tenantId;
      
      // Get user counts
      const totalUsers = await User.count({ where: { tenantId } });
      const activeUsers = await User.count({ where: { tenantId, isActive: true } });
      const adminUsers = await User.count({ where: { tenantId, role: 'admin' } });
      const agentUsers = await User.count({ where: { tenantId, role: 'agent' } });
      
      // Get recent users (last 30 days)
      const thirtyDaysAgo = moment().subtract(30, 'days').toDate();
      const recentUsers = await User.count({
        where: {
          tenantId,
          createdAt: { [Op.gte]: thirtyDaysAgo }
        }
      });
      
      // Get users by creation month (last 12 months)
      const twelveMonthsAgo = moment().subtract(12, 'months').startOf('month').toDate();
      const usersByMonth = await User.findAll({
        where: {
          tenantId,
          createdAt: { [Op.gte]: twelveMonthsAgo }
        },
        attributes: [
          [sequelize.fn('DATE_TRUNC', 'month', sequelize.col('createdAt')), 'month'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: [sequelize.fn('DATE_TRUNC', 'month', sequelize.col('createdAt'))],
        order: [[sequelize.fn('DATE_TRUNC', 'month', sequelize.col('createdAt')), 'ASC']],
        raw: true
      });
      
      res.json({
        totalUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
        adminUsers,
        agentUsers,
        recentUsers,
        usersByMonth
      });
    } catch (error) {
      console.error('Error getting user statistics:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Debug route to check current user info (temporary)
  router.get('/users/debug/me', authenticateToken, async (req, res) => {
    try {
      res.json({
        user: {
          id: req.user.id,
          role: req.user.role,
          tenantId: req.user.tenantId,
          username: req.user.username,
          email: req.user.email
        },
        message: 'Debug info for current user'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Register all routes
  app.use('/api', router);
  
  return router;
};