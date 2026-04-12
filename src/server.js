const express = require('express');
const { startAutoFetch } = require('./fetch/fetchAndStore');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('API Fetch & Store Service is running!');
});

// Start the auto-fetch process
startAutoFetch();

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});