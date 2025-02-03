const { PeerServer } = require('peer');

const isProd = process.env.NODE_ENV === 'production';

const origins = [
  `${process.env.NEXT_PUBLIC_CLIENT_URL}`,
  `${process.env.NEXT_PUBLIC_SERVER_URL}`
];

const peerServer = PeerServer({
  port: 9000,
  path: isProd ? '/peerService/peer': '/peer',
  allow_discovery: true,
  cors: {
    origin: origins,
  },
  proxied: true,
  concurrent_limit: 50,
  cleanup_out_msgs: 1000
});

peerServer.on('connection', (client) => {
  console.log('Client connected:', client.id);
});

peerServer.on('disconnect', (client) => {
  console.log('Client disconnected:', client.id);
});

peerServer.on('error', (err) => {
  console.error('Peer server error:', err);
})

