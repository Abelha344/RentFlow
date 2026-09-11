import { io } from 'socket.io-client';
import { apiOrigin } from './assets';

let socket;

export function getSocket() {
  if (!socket) {
    socket = io(apiOrigin() || 'http://localhost:5000', {
      withCredentials: true,
      autoConnect: false,
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket?.connected) socket.disconnect();
}
