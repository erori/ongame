const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '../public')));

let waitingPlayer = null;
let rooms = {};

io.on('connection', (socket) => {
    console.log('Игрок подключился:', socket.id);

    socket.on('find-game', (nickname) => {
        socket.data.nickname = nickname || "Аноним";
        
        if (waitingPlayer && waitingPlayer !== socket.id) {
            // Создаём комнату
            const roomId = `game_${socket.id}_${waitingPlayer}`;
            socket.join(roomId);
            io.sockets.sockets.get(waitingPlayer)?.join(roomId);
            
            rooms[roomId] = {
                players: [waitingPlayer, socket.id],
                nicks: [io.sockets.sockets.get(waitingPlayer)?.data.nickname, socket.data.nickname],
                hp: [100, 100],
                turn: 0, // 0 - первый игрок ходит
                gameOver: false
            };
            
            io.to(roomId).emit('game-start', {
                players: rooms[roomId].nicks,
                roomId: roomId,
                yourIndex: 0 // для каждого свой
            });
            
            // Отправляем каждому его индекс
            io.to(waitingPlayer).emit('your-index', 0);
            io.to(socket.id).emit('your-index', 1);
            
            waitingPlayer = null;
        } else {
            waitingPlayer = socket.id;
            socket.emit('waiting', 'Ожидание соперника...');
        }
    });
    
    socket.on('attack', ({ roomId, attackerIndex }) => {
        const game = rooms[roomId];
        if (!game || game.gameOver) return;
        
        // Проверка очереди
        if (game.turn !== attackerIndex) {
            socket.emit('not-your-turn');
            return;
        }
        
        const damage = Math.floor(Math.random() * 25) + 10;
        const defenderIndex = attackerIndex === 0 ? 1 : 0;
        game.hp[defenderIndex] = Math.max(0, game.hp[defenderIndex] - damage);
        
        // Лог
        const log = `${game.nicks[attackerIndex]} нанёс ${damage} урона!`;
        
        // Проверка победы
        if (game.hp[defenderIndex] <= 0) {
            game.gameOver = true;
            io.to(roomId).emit('game-over', {
                winner: game.nicks[attackerIndex],
                hp: game.hp
            });
            delete rooms[roomId];
            return;
        }
        
        // Смена хода
        game.turn = defenderIndex;
        
        io.to(roomId).emit('update-battle', {
            hp: game.hp,
            turn: game.turn,
            lastAttack: log,
            currentPlayer: game.nicks[game.turn]
        });
    });
    
    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
        if (waitingPlayer === socket.id) waitingPlayer = null;
        
        // Удаляем комнаты с этим игроком
        for (let roomId in rooms) {
            if (rooms[roomId].players.includes(socket.id)) {
                io.to(roomId).emit('opponent-left');
                delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));