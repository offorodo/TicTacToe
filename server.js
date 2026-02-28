const express = require('express');
const path = require('path');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
    cors: { origin: "*" }
});

// 1. Set the port (Render provides this automatically)
const PORT = process.env.PORT || 3000;

// 2. Serve your game files (index.html, style.css, script.js) from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

// 3. Socket.IO logic for Real-time Multiplayer
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', (roomCode) => {
        if (!rooms[roomCode]) rooms[roomCode] = [];
        
        if (rooms[roomCode].length < 2) {
            socket.join(roomCode);
            const role = rooms[roomCode].length === 0 ? 'X' : 'O';
            rooms[roomCode].push({ id: socket.id, role });
            
            socket.emit('playerRole', role);
            
            if (rooms[roomCode].length === 2) {
                io.to(roomCode).emit('startGame');
            }
        } else {
            socket.emit('errorMsg', 'This room is full!');
        }
    });

    socket.on('makeMove', (data) => {
        // Sends the move to the other player in the same room
        socket.to(data.room).emit('opponentMove', data);
    });

    socket.on('disconnect', () => {
        for (let code in rooms) {
            rooms[code] = rooms[code].filter(p => p.id !== socket.id);
            if (rooms[code].length === 0) {
                delete rooms[code];
            } else {
                io.to(code).emit('opponentLeft');
            }
        }
        console.log('User disconnected');
    });
});

// 4. CRITICAL: Listen on '0.0.0.0' so Render can detect the server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
