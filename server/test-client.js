const { io } = require('socket.io-client');

// Simple automated test: two clients join same room and exchange a pair of moves
const URL = 'http://localhost:3000';
const ROOM = 'test-room-123';

function makeClient(name) {
  const sock = io(URL, { reconnection: false });
  sock.on('connect', () => console.log(`${name} connected (${sock.id})`));
  sock.on('playerRole', role => console.log(`${name} role ->`, role));
  sock.on('startGame', state => console.log(`${name} startGame`, state && { turn: state.turn, allowed: state.allowed }));
  sock.on('opponentMove', m => console.log(`${name} opponentMove ->`, m));
  sock.on('moveAck', a => console.log(`${name} moveAck ->`, a));
  sock.on('gameOver', g => console.log(`${name} gameOver ->`, g));
  sock.on('opponentLeft', () => console.log(`${name} opponentLeft`));
  sock.on('errorMsg', e => console.log(`${name} errorMsg ->`, e));
  return sock;
}

async function run() {
  const a = makeClient('ClientA');
  const b = makeClient('ClientB');

  // Wait for both to connect
  await new Promise(r => setTimeout(r, 1000));

  a.emit('joinRoom', ROOM);
  b.emit('joinRoom', ROOM);

  // Wait for start
  await new Promise(r => setTimeout(r, 1000));

  // ClientA plays in board 0, cell 0
  a.emit('makeMove', { room: ROOM, bIdx: 0, cIdx: 0, player: 'X' });
  await new Promise(r => setTimeout(r, 500));

  // ClientB plays in board 0, cell 1 (if allowed)
  b.emit('makeMove', { room: ROOM, bIdx: 0, cIdx: 1, player: 'O' });
  await new Promise(r => setTimeout(r, 500));

  // Log final state request by attempting an invalid move to see validation
  a.emit('makeMove', { room: ROOM, bIdx: 0, cIdx: 1, player: 'X' });
  await new Promise(r => setTimeout(r, 500));

  // Disconnect
  a.disconnect();
  b.disconnect();
}

run().catch(e => console.error(e));
