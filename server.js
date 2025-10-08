const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const clients = new Map();

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 20;
const GAME_DURATION = 120;

const obstacles = [
  { x: 200, y: 150, width: 80, height: 80 },
  { x: 520, y: 150, width: 80, height: 80 },
  { x: 350, y: 300, width: 100, height: 100 },
  { x: 150, y: 400, width: 80, height: 80 },
  { x: 570, y: 400, width: 80, height: 80 }
];

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function checkCollision(x1, y1, x2, y2, size) {
  const distance = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
  return distance < size * 2;
}

function checkObstacleCollision(x, y) {
  for (let obs of obstacles) {
    if (x > obs.x && x < obs.x + obs.width &&
        y > obs.y && y < obs.y + obs.height) {
      return true;
    }
  }
  return false;
}

function broadcastToRoom(roomCode, data) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.players.forEach(player => {
    const client = clients.get(player.id);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

function broadcastPersonalizedGameState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.players.forEach(player => {
    const client = clients.get(player.id);
    if (client && client.readyState === WebSocket.OPEN) {
      const playerRole = room.roles[player.id];
      
      // Создаем персонализированную информацию о игроках
      const personalizedPlayers = {};
      Object.entries(room.gamePlayers).forEach(([id, gamePlayer]) => {
        if (id === player.id) {
          // Каждый игрок видит себя в своем цвете
          personalizedPlayers[id] = gamePlayer;
        } else if (playerRole === 'straight') {
          // Натурал видит остальных розовыми (геями)
          personalizedPlayers[id] = gamePlayer;
        } else {
          // Геи видят остальных серыми
          personalizedPlayers[id] = {
            ...gamePlayer,
            role: 'unknown' // Скрываем реальную роль
          };
        }
      });

      client.send(JSON.stringify({
        type: 'gameState',
        players: personalizedPlayers,
        timeLeft: Math.ceil(room.timeLeft),
        myRole: playerRole // Отправляем роль только текущему игроку
      }));
    }
  });
}

function startGameLoop(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.gameInterval = setInterval(() => {
    if (room.gameState !== 'playing') {
      clearInterval(room.gameInterval);
      return;
    }

    room.timeLeft -= 1/60;

    if (room.timeLeft <= 0) {
      endRound(roomCode, 'straight', 'timeout');
      return;
    }

    // Проверяем столкновения между игроками
    Object.entries(room.gamePlayers).forEach(([id, player]) => {
      if (player.role === 'gay') {
        const straight = Object.values(room.gamePlayers).find(p => p.role === 'straight');
        if (straight && checkCollision(player.x, player.y, straight.x, straight.y, PLAYER_SIZE)) {
          broadcastToRoom(roomCode, {
            type: 'collision',
            x: player.x,
            y: player.y
          });
          // Защита от повторного вызова
          if (!room.collisionHandled) {
            room.collisionHandled = true;
            setTimeout(() => endRound(roomCode, 'gays', 'caught'), 1500);
          }
        }
      }

      if (player.dashCooldown > 0) {
        player.dashCooldown -= 1/60;
      }
    });

    broadcastPersonalizedGameState(roomCode);
  }, 1000 / 60);
}

function endRound(roomCode, winner, reason) {
  const room = rooms.get(roomCode);
  if (!room) return;

  // Защита от повторного вызова
  if (room.gameState === 'roundEnded') {
    console.log(`Раунд уже окончен для комнаты ${roomCode}`);
    return;
  }

  room.gameState = 'roundEnded';
  room.lastWinner = winner;
  room.lastReason = reason;
  if (room.gameInterval) {
    clearInterval(room.gameInterval);
  }

  if (room.reconnectTimeout) {
    clearTimeout(room.reconnectTimeout);
    room.reconnectTimeout = null;
  }

  // Обновляем счет
  console.log(`Обновляем счет. Победитель: ${winner}, текущий счет:`, room.score);
  if (winner === 'straight') {
    room.score.straight++;
    console.log(`Счет натуралов увеличен до: ${room.score.straight}`);
  } else if (winner === 'gays') {
    room.score.gays++;
    console.log(`Счет геев увеличен до: ${room.score.gays}`);
  }

  room.readyPlayers.clear();
  
  console.log(`Раунд ${room.roundNumber} окончен. Победитель: ${winner}. Счет:`, room.score);

  // Персональная рассылка: каждому игроку отправляем его роль в поле myRole и его playerId
  room.players.forEach(player => {
    const client = clients.get(player.id);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'roundEnded',
        winner: winner,
        reason: reason,
        roles: room.roles,
        myRole: room.roles[player.id], // роль для этого клиента
        myId: player.id,
        score: room.score,
        roundNumber: room.roundNumber,
        readyPlayers: [],
        totalPlayers: room.players.length
      }));
    }
  });
}

function startNewRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.gameState = 'playing';
  room.timeLeft = GAME_DURATION;
  room.readyPlayers.clear();
  room.collisionHandled = false;
  room.roundNumber++;

  const roles = {};
  const gamePlayers = {};
  
  // Случайно выбираем натурала из всех игроков
  const playerIds = room.players.map(p => p.id);
  const randomStraightIndex = Math.floor(Math.random() * playerIds.length);
  const straightPlayerId = playerIds[randomStraightIndex];
  
  console.log(`Новый раунд ${room.roundNumber}: случайно выбран натурал: ${room.players.find(p => p.id === straightPlayerId)?.name} (${straightPlayerId})`);
  
  room.players.forEach((player, index) => {
    const role = player.id === straightPlayerId ? 'straight' : 'gay';
    roles[player.id] = role;
    
    const startPositions = [
      { x: 400, y: 300 },
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 100, y: 500 },
      { x: 700, y: 500 }
    ];
    
    gamePlayers[player.id] = {
      x: startPositions[index].x,
      y: startPositions[index].y,
      role: role,
      speed: role === 'straight' ? 4.2 : 3,
      name: player.name,
      dashCooldown: 0
    };
  });
  
  room.roles = roles;
  room.gamePlayers = gamePlayers;
  
  broadcastToRoom(roomCode, {
    type: 'newRound',
    roles: roles,
    players: gamePlayers,
    score: room.score,
    roundNumber: room.roundNumber
  });
  
  startGameLoop(roomCode);
  console.log(`Новый раунд ${room.roundNumber} начался в комнате ${roomCode}`);
}

wss.on('connection', (ws) => {
  console.log('Новое подключение');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'createRoom': {
          const roomCode = generateRoomCode();
          const playerId = Math.random().toString(36).substr(2, 9);
          
          rooms.set(roomCode, {
            code: roomCode,
            host: playerId,
            players: [{
              id: playerId,
              name: data.playerName,
              ws: ws
            }],
            gameState: 'lobby',
            score: {
              straight: 0,
              gays: 0
            },
            readyPlayers: new Set(),
            roundNumber: 0
          });
          
          clients.set(playerId, ws);
          ws.playerId = playerId;
          ws.roomCode = roomCode;
          
          ws.send(JSON.stringify({
            type: 'roomCreated',
            roomCode: roomCode,
            playerId: playerId
          }));
          
          broadcastToRoom(roomCode, {
            type: 'lobbyUpdate',
            players: rooms.get(roomCode).players.map(p => ({
              id: p.id,
              name: p.name
            }))
          });
          
          // Отправляем начальное состояние готовности
          broadcastToRoom(roomCode, {
            type: 'readyUpdate',
            readyPlayers: [],
            totalPlayers: rooms.get(roomCode).players.length
          });
          
          console.log(`Комната создана: ${roomCode}`);
          break;
        }
        
        case 'joinRoom': {
          const roomCode = data.roomCode;
          const room = rooms.get(roomCode);
          
          if (!room) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Комната не найдена!'
            }));
            break;
          }
          
          // Проверяем, есть ли уже игрок с таким именем в комнате
          console.log(`Поиск игрока ${data.playerName} в комнате ${roomCode}`);
          console.log(`Игроки в комнате:`, room.players.map(p => ({ name: p.name, id: p.id })));
          const existingPlayer = room.players.find(p => p.name === data.playerName);
          
          if (existingPlayer) {
            // Переподключение существующего игрока
            console.log(`Переподключение игрока ${data.playerName} к комнате ${roomCode}`);
            existingPlayer.ws = ws;
            clients.set(existingPlayer.id, ws);
            ws.playerId = existingPlayer.id;
            ws.roomCode = roomCode;
            
            ws.send(JSON.stringify({
              type: 'roomJoined',
              roomCode: roomCode,
              playerId: existingPlayer.id,
              gameState: room.gameState
            }));
            
            // Если игра идет, отправляем текущее состояние
            if (room.gameState === 'playing') {
              ws.send(JSON.stringify({
                type: 'gameStart',
                roles: room.roles,
                players: room.gamePlayers
              }));
              
              // Проверяем, нужно ли отменить таймер переподключения
              console.log(`Проверка таймера для игрока ${existingPlayer.name}:`, {
                hasTimeout: !!room.reconnectTimeout,
                playerRole: room.roles ? room.roles[existingPlayer.id] : 'неизвестно'
              });
              
              if (room.reconnectTimeout && room.roles && room.roles[existingPlayer.id] === 'straight') {
                clearTimeout(room.reconnectTimeout);
                room.reconnectTimeout = null;
                console.log(`Натурал вернулся, игра продолжается`);
              }
            } else if (room.gameState === 'roundEnded') {
              // Если раунд окончен, отправляем состояние окончания раунда
              ws.send(JSON.stringify({
                type: 'roundEnded',
                winner: room.lastWinner || 'gays',
                reason: room.lastReason || 'caught',
                roles: room.roles,
                myRole: room.roles[existingPlayer.id],
                myId: existingPlayer.id,
                score: room.score,
                roundNumber: room.roundNumber,
                readyPlayers: Array.from(room.readyPlayers),
                totalPlayers: room.players.length
              }));
            } else {
              broadcastToRoom(roomCode, {
                type: 'lobbyUpdate',
                players: room.players.map(p => ({
                  id: p.id,
                  name: p.name
                }))
              });
            }
            
            console.log(`Игрок ${data.playerName} переподключился к комнате ${roomCode}`);
          } else {
            // Новый игрок
            if (room.gameState !== 'lobby') {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Игра уже началась! Присоединиться могут только игроки, которые были в комнате.'
              }));
              break;
            }
            
            const playerId = Math.random().toString(36).substr(2, 9);
            
            room.players.push({
              id: playerId,
              name: data.playerName,
              ws: ws
            });
            
            clients.set(playerId, ws);
            ws.playerId = playerId;
            ws.roomCode = roomCode;
            
            ws.send(JSON.stringify({
              type: 'roomJoined',
              roomCode: roomCode,
              playerId: playerId,
              gameState: room.gameState
            }));
            
            broadcastToRoom(roomCode, {
              type: 'lobbyUpdate',
              players: room.players.map(p => ({
                id: p.id,
                name: p.name
              }))
            });
            
            // Отправляем обновление о готовности
            broadcastToRoom(roomCode, {
              type: 'readyUpdate',
              readyPlayers: Array.from(room.readyPlayers),
              totalPlayers: room.players.length
            });
            
            console.log(`Новый игрок присоединился к комнате ${roomCode}`);
          }
          break;
        }
        
        case 'playerReady': {
          const roomCode = data.roomCode;
          const room = rooms.get(roomCode);
          
          if (!room || room.gameState !== 'lobby') break;
          
          room.readyPlayers.add(ws.playerId);
          
          // Проверяем, готовы ли все игроки
          const allPlayersReady = room.players.every(player => 
            room.readyPlayers.has(player.id)
          );
          
          if (allPlayersReady) {
            // Все игроки готовы, начинаем игру
            room.gameState = 'playing';
            room.timeLeft = GAME_DURATION;
            
            const roles = {};
            const gamePlayers = {};
            
            // Случайно выбираем натурала из всех игроков
            const playerIds = room.players.map(p => p.id);
            const randomStraightIndex = Math.floor(Math.random() * playerIds.length);
            const straightPlayerId = playerIds[randomStraightIndex];
            
            console.log(`Случайно выбран натурал: ${room.players.find(p => p.id === straightPlayerId)?.name} (${straightPlayerId})`);
            
            room.players.forEach((player, index) => {
              const role = player.id === straightPlayerId ? 'straight' : 'gay';
              roles[player.id] = role;
              
              const startPositions = [
                { x: 400, y: 300 },
                { x: 100, y: 100 },
                { x: 700, y: 100 },
                { x: 100, y: 500 },
                { x: 700, y: 500 }
              ];
              
              gamePlayers[player.id] = {
                x: startPositions[index].x,
                y: startPositions[index].y,
                role: role,
                speed: role === 'straight' ? 4.2 : 3,
                name: player.name,
                dashCooldown: 0
              };
            });
            
            room.roles = roles;
            room.gamePlayers = gamePlayers;
            
            broadcastToRoom(roomCode, {
              type: 'gameStart',
              roles: roles,
              players: gamePlayers
            });
            
            startGameLoop(roomCode);
            console.log(`Игра началась в комнате ${roomCode}`);
          } else {
            // Отправляем обновление о готовности
            broadcastToRoom(roomCode, {
              type: 'readyUpdate',
              readyPlayers: Array.from(room.readyPlayers),
              totalPlayers: room.players.length
            });
          }
          break;
        }
        
        case 'move': {
          const roomCode = data.roomCode;
          const room = rooms.get(roomCode);
          
          if (!room || room.gameState !== 'playing') break;
          
          const player = room.gamePlayers[ws.playerId];
          if (!player) break;
          
          let { dx, dy } = data;
          if (dx !== 0 || dy !== 0) {
            const length = Math.sqrt(dx * dx + dy * dy);
            dx = (dx / length) * player.speed;
            dy = (dy / length) * player.speed;

            const newX = Math.max(PLAYER_SIZE, Math.min(CANVAS_WIDTH - PLAYER_SIZE, player.x + dx));
            const newY = Math.max(PLAYER_SIZE, Math.min(CANVAS_HEIGHT - PLAYER_SIZE, player.y + dy));

            if (!checkObstacleCollision(newX, newY)) {
              player.x = newX;
              player.y = newY;
            }
          }
          break;
        }
        
        case 'dash': {
          const roomCode = data.roomCode;
          const room = rooms.get(roomCode);
          
          if (!room || room.gameState !== 'playing') break;
          
          const player = room.gamePlayers[ws.playerId];
          if (!player || player.role !== 'straight') break;
          if (player.dashCooldown > 0) break;
          
          let dashX = 0;
          let dashY = 0;
          
          if (player.lastDx || player.lastDy) {
            dashX = (player.lastDx || 0) * 60;
            dashY = (player.lastDy || 0) * 60;
          } else {
            dashX = 60;
          }
          
          const newX = Math.max(PLAYER_SIZE, Math.min(CANVAS_WIDTH - PLAYER_SIZE, player.x + dashX));
          const newY = Math.max(PLAYER_SIZE, Math.min(CANVAS_HEIGHT - PLAYER_SIZE, player.y + dashY));
          
          if (!checkObstacleCollision(newX, newY)) {
            player.x = newX;
            player.y = newY;
            player.dashCooldown = 3;
          }
          break;
        }
        
        case 'checkRoomExists': {
          const roomCode = data.roomCode;
          const room = rooms.get(roomCode);
          
          ws.send(JSON.stringify({
            type: 'roomExists',
            roomCode: roomCode,
            exists: !!room
          }));
          break;
        }
        
        case 'playerReadyRound': {
          const roomCode = data.roomCode;
          const room = rooms.get(roomCode);
          
          if (!room || room.gameState !== 'roundEnded') break;
          
          room.readyPlayers.add(ws.playerId);
          
          // Проверяем, готовы ли все игроки
          const allPlayersReady = room.players.every(player => 
            room.readyPlayers.has(player.id)
          );
          
          if (allPlayersReady) {
            startNewRound(roomCode);
          } else {
            // Отправляем обновление о готовности всем игрокам
            room.players.forEach(player => {
              const client = clients.get(player.id);
              if (client && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'readyUpdate',
                  readyPlayers: Array.from(room.readyPlayers),
                  totalPlayers: room.players.length
                }));
              }
            });
          }
          break;
        }
      }
    } catch (error) {
      console.error('Ошибка обработки сообщения:', error);
    }
  });

  ws.on('close', () => {
    console.log('Клиент отключился');
    
    if (ws.playerId) {
      clients.delete(ws.playerId);
      
      if (ws.roomCode) {
        const room = rooms.get(ws.roomCode);
        if (room) {
          // Помечаем игрока как неактивного, но не удаляем из комнаты
          const player = room.players.find(p => p.id === ws.playerId);
          if (player) {
            player.ws = null; // Помечаем WebSocket как неактивный
            console.log(`Игрок ${player.name} отключился, но остается в комнате`);
          }
          
          // Проверяем, есть ли активные игроки
          const activePlayers = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
          
          if (activePlayers.length === 0) {
            if (room.gameInterval) {
              clearInterval(room.gameInterval);
            }
            rooms.delete(ws.roomCode);
            console.log(`Комната ${ws.roomCode} удалена - нет активных игроков`);
          } else {
            // Если хост отключился, назначаем нового хоста
            if (room.host === ws.playerId) {
              const newHost = activePlayers[0];
              room.host = newHost.id;
              console.log(`Новый хост: ${newHost.name}`);
            }
            
            if (room.gameState === 'lobby') {
              broadcastToRoom(ws.roomCode, {
                type: 'lobbyUpdate',
                players: room.players.map(p => ({
                  id: p.id,
                  name: p.name,
                  active: p.ws && p.ws.readyState === WebSocket.OPEN
                }))
              });
            } else if (room.gameState === 'playing') {
              // Проверяем, отключился ли именно натурал
              const disconnectedPlayer = room.players.find(p => p.id === ws.playerId);
              const isDisconnectedPlayerStraight = disconnectedPlayer && room.roles && room.roles[ws.playerId] === 'straight';
              
              console.log(`Отключился игрок: ${disconnectedPlayer ? disconnectedPlayer.name : 'неизвестно'}, роль: ${room.roles ? room.roles[ws.playerId] : 'неизвестно'}`);
              
              if (isDisconnectedPlayerStraight) {
                // Только если отключился натурал, запускаем таймер
                const straightPlayers = Object.values(room.gamePlayers).filter(p => p.role === 'straight');
                const activeStraightPlayers = straightPlayers.filter(p => {
                  const player = room.players.find(pl => pl.id === p.id);
                  return player && player.ws && player.ws.readyState === WebSocket.OPEN;
                });
                
                // Даем время на переподключение (10 секунд)
                if (activeStraightPlayers.length === 0) {
                  if (!room.reconnectTimeout) {
                    room.reconnectTimeout = setTimeout(() => {
                      // Проверяем еще раз через 10 секунд
                      const stillActiveStraightPlayers = straightPlayers.filter(p => {
                        const player = room.players.find(pl => pl.id === p.id);
                        return player && player.ws && player.ws.readyState === WebSocket.OPEN;
                      });
                      
                      if (stillActiveStraightPlayers.length === 0) {
                        endRound(ws.roomCode, 'gays', 'disconnected');
                      }
                      room.reconnectTimeout = null;
                    }, 10000);
                    
                    console.log(`Натурал отключился, даем 10 секунд на переподключение`);
                    
                    // Уведомляем игроков о том, что натурал отключился
                    broadcastToRoom(ws.roomCode, {
                      type: 'playerDisconnected',
                      message: 'Натурал отключился! У него есть 10 секунд на переподключение.'
                    });
                  }
                }
              } else {
                // Если отключился гей, просто логируем
                console.log(`Гей отключился, игра продолжается`);
              }
            }
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`WebSocket сервер готов принимать подключения`);
});