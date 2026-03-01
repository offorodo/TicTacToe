const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// In-memory rooms: { [roomCode]: { players: { X: socketId, O: socketId }, sockets: { socketId: role }, state: {...} } }
const rooms = {};

function createEmptyGame() {
  return {
    boards: Array.from({ length: 9 }, () => ({ data: Array(9).fill(''), won: false, winner: null })),
    turn: 'X',
    allowed: Array.from({ length: 9 }, (_, i) => i),
    over: false
  };
}

function checkWin(arr) {
  const w = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  return w.some(c => arr[c[0]] && arr[c[0]] === arr[c[1]] && arr[c[0]] === arr[c[2]]);
}

function getPlayable(roomsState, cIdx) {
  const boards = roomsState.boards;
  // If the target board (based on cell index) is playable, return it
  if (typeof cIdx === 'number' && !boards[cIdx].won && boards[cIdx].data.some(x => !x)) return [cIdx];
  // Otherwise return all boards that are not won and have at least one empty cell
  const available = boards.map((b, i) => ({ b, i })).filter(({ b }) => !b.won && b.data.some(x => !x)).map(({ i }) => i);
  return available;
}

io.on('connection', (socket) => {
  socket.on('joinRoom', (roomCode) => {
    try {
      if (!roomCode) return socket.emit('errorMsg', 'Invalid room code');
      if (!rooms[roomCode]) {
        rooms[roomCode] = { players: {}, sockets: {}, state: createEmptyGame() };
      }
      const room = rooms[roomCode];
      const currentPlayers = Object.keys(room.players).length;
      if (currentPlayers >= 2) return socket.emit('errorMsg', 'Room full');

      // Assign role
      let role = room.players['X'] ? 'O' : 'X';
      room.players[role] = socket.id;
      room.sockets[socket.id] = role;
      socket.join(roomCode);
      socket.emit('playerRole', role);

      // If two players, notify both and start with initial state (clone so both get same snapshot)
      if (Object.keys(room.players).length === 2) {
        io.in(roomCode).emit('startGame', JSON.parse(JSON.stringify(room.state)));
      }
    } catch (e) {
      console.error('joinRoom error', e);
      socket.emit('errorMsg', 'Server error');
    }
  });

  socket.on('makeMove', (data) => {
    try {
      const { room: roomCode, bIdx, cIdx, player } = data || {};
      if (!roomCode || bIdx == null || cIdx == null || !player) return socket.emit('errorMsg', 'Invalid move data');
      const room = rooms[roomCode];
      if (!room) return socket.emit('errorMsg', 'Room not found');
      const role = room.sockets[socket.id];
      if (!role) return socket.emit('errorMsg', 'You are not in this room');
      if (role !== player) return socket.emit('errorMsg', 'Player role mismatch');
      if (room.state.over) return socket.emit('errorMsg', 'Game over');
      if (room.state.turn !== player) return socket.emit('errorMsg', 'Not your turn');

      const board = room.state.boards[bIdx];
      if (!board) return socket.emit('errorMsg', 'Invalid board');
      if (board.won) return socket.emit('errorMsg', 'Board already won');
      if (board.data[cIdx]) return socket.emit('errorMsg', 'Cell already occupied');

      // Validate allowed
      if (room.state.allowed && !room.state.allowed.includes(bIdx)) return socket.emit('errorMsg', 'Board not allowed');

      // Apply move
      board.data[cIdx] = player;
      const smallWin = checkWin(board.data);
      if (smallWin) {
        board.won = true;
        board.winner = player;
      }

      // Update allowed and turn for the next player
      room.state.allowed = getPlayable(room.state, cIdx);
      room.state.turn = player === 'X' ? 'O' : 'X';

      // Check for overall win (three small boards in a line won by same player)
      const winners = room.state.boards.map(b => b.winner || null);
      const overall = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]].some(c => winners[c[0]] && winners[c[0]] === winners[c[1]] && winners[c[0]] === winners[c[2]]);
      if (overall) {
        room.state.over = true;
        io.in(roomCode).emit('gameOver', { winner: player });
      }

      // Broadcast authoritative state to BOTH players (deep clone so clients get a snapshot)
      const stateSnapshot = JSON.parse(JSON.stringify(room.state));
      io.in(roomCode).emit('gameState', stateSnapshot);

      // Legacy: notify other player (client can use gameState as source of truth)
      socket.to(roomCode).emit('opponentMove', { bIdx, cIdx, player });

      // Ack to sender that move accepted
      socket.emit('moveAck', { ok: true });
    } catch (e) {
      console.error('makeMove error', e);
      socket.emit('errorMsg', 'Server error');
    }
  });

  socket.on('disconnect', () => {
    try {
      // Find room & notify opponent
      for (const [roomCode, room] of Object.entries(rooms)) {
        if (room.sockets[socket.id]) {
          const role = room.sockets[socket.id];
          delete room.sockets[socket.id];
          delete room.players[role];
          // Notify remaining player
          const remaining = Object.keys(room.sockets)[0];
          if (remaining) io.to(remaining).emit('opponentLeft');
          // Clean up empty room
          if (Object.keys(room.sockets).length === 0) delete rooms[roomCode];
          break;
        }
      }
    } catch (e) {
      console.error('disconnect error', e);
    }
  });
});

server.listen(PORT, () => {
  console.log(`TicTacToe server running on port ${PORT}`);
});
