import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);

// Serve static files from client/dist in production
const clientDistPath = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  // SPA fallback: any non-API route serves index.html
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });
} else {
  console.log('No client/dist directory found — running in API-only mode');
  app.get('*', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TexFlow server running on http://0.0.0.0:${PORT}`);
});