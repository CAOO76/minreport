import { userRepository, pluginConnector, User } from '@minreport/user-management';
import express from 'express';

const app = express();
app.use(express.json());

// Minimal endpoint: create user
app.post('/users', async (req, res) => {
  const { id, email, name } = req.body;
  if (!id || !email) return res.status(400).json({ error: 'Missing id or email' });
  const user: User = { id, email, name };
  await userRepository.createUser(user);
  res.status(201).json(user);
});

// Minimal endpoint: connect plugin
app.post('/users/:userId/plugins', async (req, res) => {
  const { userId } = req.params;
  const { pluginId, config } = req.body;
  if (!pluginId) return res.status(400).json({ error: 'Missing pluginId' });
  const ok = await pluginConnector.connectPlugin(userId, pluginId, config);
  res.status(ok ? 200 : 500).json({ success: ok });
});

// Minimal endpoint: list user plugins
app.get('/users/:userId/plugins', async (req, res) => {
  const { userId } = req.params;
  const plugins = await pluginConnector.listUserPlugins(userId);
  res.json({ plugins });
});

export default app;
