import express, { Request, Response, NextFunction } from 'express';
import { verify } from 'jsonwebtoken';
import path from 'path';

const app = express();
const PORT = 3001;

// En un entorno real, este secreto se compartiría de forma segura con MINREPORT.
const JWT_SECRET = 'a-very-secret-and-long-key-for-signing-jwts';

/**
 * Middleware to validate the load ticket from MINREPORT.
 * This protects the plugin's static files from unauthorized access.
 */
const ticketValidationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const ticket = req.query.ticket as string;

  if (!ticket) {
    console.warn('[Server] Access denied: No ticket provided.');
    return res.status(403).send('Forbidden: Access ticket is missing.');
  }

  try {
    // Here you would also typically check against a list of used tickets (JTI) in a database
    // to prevent replay attacks, but for this example, we rely on JWT expiration.
    verify(ticket, JWT_SECRET);
    console.log('[Server] Ticket validated successfully.');
    next(); // Ticket is valid, proceed to serve static files.
  } catch (error) {
    console.warn('[Server] Access denied: Invalid or expired ticket.', error);
    return res.status(403).send('Forbidden: Invalid or expired access ticket.');
  }
};

// Apply the middleware to all routes.
app.use(ticketValidationMiddleware);

// Serve the static files of the built plugin.
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for single-page applications.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`External Plugin Server listening on http://localhost:${PORT}`);
  console.log('This server requires a valid `?ticket=` query parameter to serve files.');
});
