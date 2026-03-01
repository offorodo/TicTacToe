# Tic Tac Toe (Ultimate)

Web + Android app with online multiplayer. Deploy to [Render](https://render.com) for the live server.

## Deploy to Render

1. Connect this repo to Render: [GitHub - offorodo/TicTacToe](https://github.com/offorodo/TicTacToe)
2. **Build**: `npm install` (or leave default)
3. **Start**: `npm start` (runs `node index.js`)
4. **Root Directory**: leave blank (use repo root)

The server serves the web client from `/` and the Socket.IO API for online play.  
Live URL: **https://tictactoe-39js.onrender.com**

## Local

- **Server**: `npm install` then `npm start` (port 3000)
- **Android**: Open in Android Studio, run `app`; the in-app WebView uses the Render URL for online mode
