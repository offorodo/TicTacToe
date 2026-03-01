// Use current origin when served from Render; fallback for app/file
const SERVER_URL = (typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.startsWith('file'))
    ? window.location.origin
    : 'https://tictactoe-39js.onrender.com';
const socket = io(SERVER_URL, { reconnection: true, reconnectionAttempts: 10 });

// --- SAVE MANAGER (IndexedDB) ---
class SaveManager {
    constructor() {
        this.dbName = 'TicTacToe_v5';
        this.storeName = 'gameFiles';
        this.dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, 1);
            req.onupgradeneeded = (e) => {
                if (!e.target.result.objectStoreNames.contains(this.storeName))
                    e.target.result.createObjectStore(this.storeName, { keyPath: 'id' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    async save(filename, data) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], 'readwrite');
            tx.objectStore(this.storeName).put({ id: 'S_' + Date.now(), filename: filename, content: data, ts: Date.now(), date: new Date().toLocaleString() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
    async getAll() {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const req = db.transaction([this.storeName], 'readonly').objectStore(this.storeName).getAll();
            req.onsuccess = () => resolve(req.result.sort((a, b) => b.ts - a.ts));
            req.onerror = () => reject(req.error);
        });
    }
    async delete(id) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], 'readwrite');
            tx.objectStore(this.storeName).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

// --- GAME CONTROLLER ---
class GameController {
    constructor() {
        this.boards = []; this.p = 'X'; this.over = false; this.history = []; this.names = {X:'', O:''};
        this.myRole = this.roomCode = this.online = null;
        this.onlineStarted = false;
        this.moveLocked = false;
        this.waitingModal = null;
        this.saveManager = new SaveManager();
        this.setup();
        this.setupSocket();
    }

    setupSocket() {
        socket.on('playerRole', r => {
            this.myRole = r;
            this.status(`Online: Player ${r}`, "#667eea");
            const t = document.getElementById('wait-status-text');
            if (t) t.textContent = r === 'X' ? "Waiting for opponent..." : "Opponent found! Starting...";
        });
        socket.on('startGame', (state) => {
            this.online = true;
            this.onlineStarted = true;
            if (state) this.applyServerState(state);
            else { this.p = 'X'; this.allowed = [0,1,2,3,4,5,6,7,8]; this.over = false; }
            if(this.waitingModal) this.waitingModal.remove();
            this.notify("Game Started!");
            this.update();
        });
        socket.on('gameState', (state) => {
            if (state && this.roomCode) { this.applyServerState(state); this.moveLocked = false; }
        });
        socket.on('opponentMove', d => { this.moveLocked = false; if (d && d.player !== this.myRole) this.applyServerStateFromMove(d); });
        socket.on('moveAck', () => { this.moveLocked = false; });
        socket.on('gameOver', (data) => {
            this.moveLocked = false;
            if (data && data.winner) { this.over = true; document.getElementById('winner-message').textContent = (this.names[data.winner] || data.winner) + ' Wins!'; document.getElementById('winner-message').classList.add('show'); this.update(); }
        });
        socket.on('opponentLeft', () => {
            this.notify("Opponent left", true);
            this.roomCode = null; this.online = false; this.onlineStarted = false;
            this.status("Mode: Offline", "#888");
            this.update();
        });
        socket.on('errorMsg', m => { this.notify(m, true); this.moveLocked = false; if(this.waitingModal) this.waitingModal.remove(); });
    }

    applyServerState(state) {
        if (!state || !state.boards || this.boards.length === 0) return;
        this.boards.forEach((b, i) => {
            const s = state.boards[i];
            if (!s) return;
            b.data = Array.isArray(s.data) ? [...s.data] : Array(9).fill('');
            b.won = !!s.won;
            b.el.classList.toggle('winning-board', b.won);
            b.cells.forEach((c, ci) => { c.textContent = b.data[ci] || ''; c.className = 'small-cell' + (b.data[ci] ? ' ' + b.data[ci].toLowerCase() : ''); });
        });
        this.p = state.turn || 'X';
        this.allowed = Array.isArray(state.allowed) ? state.allowed : null;
        this.over = !!state.over;
        if (this.over && state.boards) {
            const winners = state.boards.map(x => x.winner || null);
            const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
            for (const [a,b,c] of lines) {
                if (winners[a] && winners[a] === winners[b] && winners[a] === winners[c]) {
                    document.getElementById('winner-message').textContent = (this.names[winners[a]] || winners[a]) + ' Wins!';
                    document.getElementById('winner-message').classList.add('show');
                    [a,b,c].forEach(i => this.boards[i].el.classList.add('winning-board'));
                    break;
                }
            }
        } else document.getElementById('winner-message').classList.remove('show');
        this.update();
    }

    applyServerStateFromMove(d) {
        if (!d || d.player === this.myRole) return;
        const bIdx = Number(d.bIdx), cIdx = Number(d.cIdx);
        if (!Number.isInteger(bIdx) || bIdx < 0 || bIdx > 8 || !Number.isInteger(cIdx) || cIdx < 0 || cIdx > 8) return;
        const b = this.boards[bIdx];
        if (!b || b.won || b.data[cIdx]) return;
        b.data[cIdx] = d.player;
        b.cells[cIdx].textContent = d.player;
        b.cells[cIdx].classList.add(d.player.toLowerCase());
        const win = this.checkWin(b.data);
        if (win) { b.won = this.over = true; document.getElementById('winner-message').textContent = (this.names[d.player] || d.player) + ' Wins!'; document.getElementById('winner-message').classList.add('show'); b.el.classList.add('winning-board'); }
        if (!this.over) { this.allowed = this.getPlayable(cIdx); this.p = d.player === 'X' ? 'O' : 'X'; }
        this.update();
    }

    setup() {
        const grid = document.getElementById('large-grid');
        for(let i=0; i<9; i++) { const b = this.createBoard(i); this.boards.push(b); grid.appendChild(b.el); }
        document.getElementById('multiplayer-btn').onclick = () => this.showMultiMenu();
        document.getElementById('reset-btn').onclick = () => this.reset();
        document.getElementById('undo-btn').onclick = () => this.undo();
        document.getElementById('export-btn').onclick = () => this.showMenu();

        document.getElementById('player-x-input').oninput = (e) => { this.names.X = e.target.value; this.persist(); };
        document.getElementById('player-o-input').oninput = (e) => { this.names.O = e.target.value; this.persist(); };

        const fi = document.getElementById('import-file-input');
        if(fi) fi.onchange = () => {
            const reader = new FileReader();
            reader.onload = (ev) => { try { this.applyState(JSON.parse(ev.target.result)); this.notify('Imported!'); } catch(e) { this.notify('Invalid File', true); } };
            reader.readAsText(fi.files[0]); fi.value = '';
        };
        this.load();
    }

    createBoard(idx) {
        const el = document.createElement('div'); el.className = 'small-board-container';
        const inner = document.createElement('div'); inner.className = 'small-board';
        const cells = [];
        for(let i=0; i<9; i++) {
            const c = document.createElement('div'); c.className = 'small-cell';
            c.onclick = () => this.handleInput(idx, i);
            inner.appendChild(c); cells.push(c);
        }
        el.appendChild(inner);
        return { el, cells, data: Array(9).fill(''), won: false };
    }

    handleInput(bIdx, cIdx) {
        if (this.roomCode) {
            if (!this.online) return this.notify("Wait...", true);
            if (this.moveLocked) return this.notify("Waiting for server...", true);
            if (this.p !== this.myRole) return this.notify("Not your turn", true);
        }
        this.executeMove(bIdx, cIdx, this.p, false);
    }

    executeMove(bIdx, cIdx, player, isRemote) {
        if(this.over) return;
        const b = this.boards[bIdx];
        if(b.won || b.data[cIdx] || (this.allowed && !this.allowed.includes(bIdx))) return;

        const prevAllowed = this.allowed ? [...this.allowed] : null;
        b.data[cIdx] = player; b.cells[cIdx].textContent = player; b.cells[cIdx].classList.add(player.toLowerCase());

        if (!isRemote && this.roomCode) {
            socket.emit('makeMove', { room: this.roomCode, bIdx, cIdx, player });
            this.moveLocked = true;
            setTimeout(() => { this.moveLocked = false; }, 5000);
        }

        const win = this.checkWin(b.data);
        if(win || b.data.every(c => c)) {
            if(win) b.won = this.over = true;
            if(win) { document.getElementById('winner-message').textContent = (this.names[player] || player) + ' Wins!'; document.getElementById('winner-message').classList.add('show'); b.el.classList.add('winning-board'); }
        }
        if(!this.over) { this.allowed = this.getPlayable(cIdx); this.p = player === 'X' ? 'O' : 'X'; }
        this.history.push({bIdx, cIdx, prevAllowed});
        this.update(); this.persist();
    }

    getPlayable(cIdx) {
        if (typeof cIdx === 'number' && !this.boards[cIdx].won && this.boards[cIdx].data.some(c => !c)) return [cIdx];
        const available = this.boards.map((b, i) => ({ b, i })).filter(({ b }) => !b.won && b.data.some(x => !x)).map(({ i }) => i);
        return available.length ? available : null;
    }

    checkWin(d) { const w = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]; return w.some(c => d[c[0]] && d[c[0]]===d[c[1]] && d[c[0]]===d[c[2]]); }

    update() {
        const isTurn = this.roomCode ? (this.p === this.myRole) : true;
        this.status(this.roomCode ? `Player ${this.myRole} (${isTurn ? "Your turn" : "Waiting..."})` : "Mode: Offline", isTurn ? "#27ae60" : "#888");

        this.boards.forEach((b, i) => {
            const ok = !this.over && !b.won && (!this.allowed || this.allowed.includes(i));
            const active = this.roomCode ? (this.onlineStarted && ok && isTurn) : ok;
            b.cells.forEach(c => {
                c.style.pointerEvents = active ? 'auto' : 'none';
                c.style.opacity = (this.roomCode && !isTurn && !this.over) ? '0.6' : (ok ? '1' : '0.4');
            });
        });
        document.getElementById('player-x-input').parentElement.classList.toggle('active', !this.over && this.p==='X');
        document.getElementById('player-o-input').parentElement.classList.toggle('active', !this.over && this.p==='O');
    }

    status(t, c) { const el = document.getElementById('multiplayer-status'); if(el) { el.textContent = t; el.style.color = c; } }

    reset() {
        if(this.roomCode) return this.notify("Reset disabled in Online Mode", true);
        this.boards.forEach(b => { b.data.fill(''); b.won=false; b.el.classList.remove('winning-board'); b.cells.forEach(c => { c.textContent=''; c.className='small-cell'; }); });
        this.p='X'; this.over=false; this.history=[]; this.allowed=null;
        document.getElementById('winner-message').classList.remove('show');
        this.update(); this.persist();
    }

    undo() {
        if(!this.history.length || this.roomCode) return;
        const last = this.history.pop();
        const b = this.boards[last.bIdx];
        b.data[last.cIdx] = ''; b.cells[last.cIdx].textContent = ''; b.cells[last.cIdx].className = 'small-cell';
        if(this.over) { this.over=false; b.won=false; b.el.classList.remove('winning-board'); document.getElementById('winner-message')?.classList.remove('show'); }
        this.p = this.history.length % 2 === 0 ? 'X' : 'O';
        this.allowed = last.prevAllowed;
        this.update(); this.persist();
    }

    notify(m, e) { const n = document.createElement('div'); n.className = 'notification'; if(e) n.style.background = "#e74c3c"; n.textContent = m; document.body.appendChild(n); setTimeout(() => n.remove(), 2500); }

    async showMultiMenu() {
        const m = this.modal('Online Multiplayer');
        this.btn(m, 'Create Room', 'btn-load', () => {
            this.roomCode = Math.floor(1000+Math.random()*9000).toString();
            this.showWait(this.roomCode); m.parentElement.remove();
            const doJoin = () => socket.emit('joinRoom', this.roomCode);
            if (socket.connected) doJoin(); else { socket.once('connect', doJoin); socket.connect(); }
        });
        this.btn(m, 'Join Room', 'btn-share', () => {
            const c = prompt("Enter 4-digit Code:");
            if (c) { this.roomCode = c; this.showWait(c); m.parentElement.remove();
                const doJoin = () => socket.emit('joinRoom', c);
                if (socket.connected) doJoin(); else { socket.once('connect', doJoin); socket.connect(); }
            }
        });
        this.btn(m, 'Cancel', 'btn-cancel', () => m.parentElement.remove());
    }

    showWait(c) {
        const m = this.modal('Waiting Room');
        m.innerHTML += `<p>Room Code: <b style='color:#667eea;font-size:1.5rem'>${c}</b></p><p id='wait-status-text' style='margin:15px 0; color:#888'>Connecting...</p>`;
        this.btn(m, 'Leave Room', 'btn-cancel', () => location.reload());
        this.waitingModal = m.parentElement;
    }

    modal(t) { const m = document.createElement('div'); m.className = 'modal-overlay'; m.innerHTML = `<div class='modal-content'><h3 class='modal-title'>${t}</h3></div>`; document.body.appendChild(m); return m.firstChild; }
    btn(m, t, c, cb) { const b = document.createElement('button'); b.textContent = t; b.className = 'modal-btn ' + c; b.onclick = cb; m.appendChild(b); }

    async showMenu() {
        const m = this.modal('Options');
        this.btn(m, '💾 Save to Folder', 'btn-load', async () => { await this.saveManager.save(`${this.names.X||'X'} vs ${this.names.O||'O'}`, this.getState()); this.notify('Saved!'); });
        this.btn(m, '📂 View Saves', 'btn-share', () => { m.parentElement.remove(); this.showFiles(); });
        this.btn(m, '📂 Import File', 'btn-load', () => { document.getElementById('import-file-input').click(); m.parentElement.remove(); });
        this.btn(m, 'Cancel', 'btn-cancel', () => m.parentElement.remove());
    }

    async showFiles() {
        const files = await this.saveManager.getAll();
        const m = this.modal('Saved Games');
        if(!files.length) m.innerHTML += `<p style='text-align:center'>No saves found.</p>`;
        else files.forEach(f => {
            const item = document.createElement('div'); item.className = 'file-item';
            item.innerHTML = `<div class='file-name'>${f.filename}</div><div class='modal-btn-group'><button class='modal-btn btn-load' id='l-${f.id}'>Load</button><button class='modal-btn btn-share' id='s-${f.id}'>Share</button><button class='modal-btn btn-delete' id='d-${f.id}'>Delete</button></div>`;
            m.appendChild(item);
            setTimeout(() => {
                document.getElementById(`l-${f.id}`).onclick = () => { this.applyState(f.content); m.parentElement.remove(); this.notify('Loaded'); };
                document.getElementById(`s-${f.id}`).onclick = () => { if(window.Android) window.Android.shareGame(f.filename, JSON.stringify(f.content)); };
                document.getElementById(`d-${f.id}`).onclick = async () => { if(confirm('Delete?')) { await this.saveManager.delete(f.id); m.parentElement.remove(); this.showFiles(); this.notify('Deleted!'); } };
            }, 0);
        });
        this.btn(m, 'Close', 'btn-cancel', () => m.parentElement.remove());
    }

    getState() { return { b: this.boards.map(b=>({d:b.data, w:b.won})), p: this.p, o: this.over, h: this.history, names: this.names }; }
    applyState(s) { if(!s || !s.b) return; this.boards.forEach((b, i) => { b.data = [...s.b[i].d]; b.won = s.b[i].w; b.el.classList.toggle('winning-board', b.won); b.cells.forEach((c, ci) => { c.textContent = b.data[ci]; c.className = 'small-cell '+(b.data[ci]?b.data[ci].toLowerCase():''); }); }); this.p = s.p; this.over = s.o; this.history = s.h || []; this.names = s.names || { X: '', O: '' }; this.update(); }
    persist() { if(!this.roomCode) localStorage.setItem('tt_save', JSON.stringify(this.getState())); }
    load() { const s = localStorage.getItem('tt_save'); if(s) this.applyState(JSON.parse(s)); }
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('theme-toggle');
    if(btn) {
        let theme = localStorage.getItem('theme') || 'light';
        const apply = (t) => {
            document.documentElement.setAttribute('data-theme', t);
            const icon = btn.querySelector('.theme-icon');
            if(icon) icon.textContent = t === 'dark' ? '☀️' : '🌙';
        };
        apply(theme);
        btn.onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; apply(theme); localStorage.setItem('theme', theme); };
    }
    const igLink = document.querySelector('.footer a');
    if(igLink) igLink.onclick = (e) => { e.preventDefault(); if(window.Android) window.Android.openInstagram('niikhil_jays'); };
    new GameController();
});
