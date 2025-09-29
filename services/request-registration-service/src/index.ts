import app from './app.minimal.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Minimal user management service running on port ${PORT}`);
});
