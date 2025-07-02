const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

module.exports = function(app, sequelize) {
  const router = express.Router();
  const User = sequelize.models.User;
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

  router.post('/register', async (req, res) => {
    try {
      const { username, password, email, tenantId, role = 'agent', firstName, lastName } = req.body;

      if (!username || !password || !email || !tenantId) {
        return res.status(400).json({ error: 'Username, password, email and tenantId are required' });
      }

      const existingUser = await User.findOne({ where: { username } });
      if (existingUser) {
        return res.status(400).json({ error: 'User already exists' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      await User.create({
        username,
        password: hashedPassword,
        email,
        tenantId,
        role,
        firstName,
        lastName,
        isActive: true
      });

      res.status(201).json({ message: 'User created successfully' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      const user = await User.findOne({ where: { username, isActive: true } });
      if (!user) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }

      await user.update({ lastLogin: new Date() });

      const token = jwt.sign(
        {
          id: user.id,
          username: user.username,
          tenantId: user.tenantId,
          role: user.role
        },
        JWT_SECRET,
        { expiresIn: '1d' }
      );

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          tenantId: user.tenantId,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName
        }
      });
    } catch (err) {
      res.status(400).json({ error: 'Login failed due to server error' });
    }
  });

  app.use('/api', router);
};
