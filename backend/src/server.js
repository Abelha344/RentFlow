require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { initSockets } = require('./sockets');
const { connectDatabase } = require('./config/db');
const { startOverdueScheduler } = require('./jobs/overdueScheduler');
const { startAuditRetentionScheduler } = require('./jobs/auditRetention');
const { startTelegramCustomerBot } = require('./bots/telegramCustomerBot');

const app = express();
const server = http.createServer(app);

// Render / reverse proxies terminate TLS — needed for secure cookies & correct IPs
app.set('trust proxy', 1);

const clientOrigin = process.env.CLIENT_URL || 'http://localhost:5173';

const io = new Server(server, {
  cors: {
    origin: clientOrigin,
    credentials: true,
  },
});
app.set('io', io);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(
  cors({
    origin: clientOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

initSockets(io);

const PORT = Number(process.env.PORT) || 5000;

async function boot() {
  await connectDatabase();
  startOverdueScheduler(io);
  startAuditRetentionScheduler();
  startTelegramCustomerBot(io);

  server.listen(PORT, () => {
    console.log(`RentFlow API listening on http://localhost:${PORT}`);
    console.log(`Runtime: Node ${process.version} | Express ${require('express/package.json').version}`);
  });
}

boot().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = { app, server, io };
