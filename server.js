require('dotenv').config();
const express = require('express');
const cors = require('cors');

const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());       // tighten this to your frontend's origin before going live
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', menuRoutes);
app.use('/api', orderRoutes);

app.listen(PORT, () => {
  console.log(`Red House Catering server running on port ${PORT}`);
});
