import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  }
});

export const getArchivedRoom = async (roomId) => {
  const response = await apiClient.get(`/rooms/${roomId}`);
  return response.data;
};

export const getUserArchivedRooms = async (userId) => {
  const response = await apiClient.get(`/rooms?userId=${userId}`);
  return response.data;
};

export default {
  getArchivedRoom,
  getUserArchivedRooms
};
