const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/civilizations', require('./routes/civilizations'));
app.use('/api/rulers', require('./routes/rulers'));
app.use('/api/entries', require('./routes/entries'));
app.use('/api/coins', require('./routes/coins'));
app.use('/api/cycles', require('./routes/cycles'));
app.use('/api/sources', require('./routes/sources'));
app.use('/api/search', require('./routes/search'));

app.listen(PORT, () => {
  console.log(`History app running at http://localhost:${PORT}`);
});
