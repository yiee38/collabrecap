import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:8080',
  headers: {
    'Content-Type': 'application/json',
  }
});

export default apiClient;