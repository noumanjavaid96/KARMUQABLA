import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import dotenv from 'dotenv';
import { runLiveSession } from './liveSession';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    try {
      const prompt = message.toString();
      console.log(`Received prompt: ${prompt}`);
      // Start the live session with the received prompt
      await runLiveSession(prompt, ws);
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({ type: 'error', data: 'Failed to process prompt.' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
