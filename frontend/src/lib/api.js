import axios from 'axios';
import { apiOrigin } from './assets';

const origin = apiOrigin();

const api = axios.create({
  // Local Vite proxies /api → backend. Production uses full Render URL.
  baseURL: origin ? `${origin}/api` : '/api',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
