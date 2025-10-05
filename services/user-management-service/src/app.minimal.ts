// ...existing code...
import express from 'express';

const app = express();
app.use(express.json());

// Minimal endpoint: create user
app.post('/users', async (req, res) => {
  const { id, email, name } = req.body;
  if (!id || !email) return res.status(400).json({ error: 'Missing id or email' });
  // ...existing code...
  // Lógica eliminada: user-management y plugins
  res.status(501).json({ error: 'Not implemented' });
});

// ...existing code...

// ...existing code...

export default app;
