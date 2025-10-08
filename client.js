// Проверяем, что React загружен
if (typeof React === 'undefined') {
  console.error('React не загружен!');
}

// Используем глобальные переменные React
const { useState, useEffect, useRef } = React;

// Простые иконки без внешних зависимостей
const Users = () => React.createElement('div', { className: 'w-6 h-6' }, '👥');
const User = () => React.createElement('div', { className: 'w-6 h-6' }, '👤');
const Timer = () => React.createElement('div', { className: 'w-6 h-6' }, '⏱️');
const Copy = () => React.createElement('div', { className: 'w-6 h-6' }, '📋');
const Check = () => React.createElement('div', { className: 'w-6 h-6' }, '✅');

// Компонент модального окна для результатов раунда
const RoundEndModal = ({ isOpen, gameEndReason, score, roundNumber, readyPlayers, totalPlayers, isReady, onMarkAsReady }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 transform transition-all duration-300 scale-100">
        <div className="text-center space-y-6">
          <div className="text-6xl mb-4">
            {gameEndReason === 'timeout' ? '⏰' : 
             gameEndReason === 'lastGayEliminated' ? '🏆' : '🎯'}
          </div>
          
          <h2 className="text-3xl font-bold mb-4">
            {gameEndReason === 'timeout' ? 'Время вышло!' : 
             gameEndReason === 'lastGayEliminated' ? 'Победа натурала!' : 'Пойман!'}
          </h2>
          
          <p className="text-xl mb-6">
            {gameEndReason === 'timeout' 
              ? 'Натурал продержался 2 минуты!' 
              : gameEndReason === 'lastGayEliminated'
              ? 'Натурал победил! Последний гей был исключен!'
              : 'Геи поймали натурала!'}
          </p>
          
          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <h3 className="text-xl font-bold mb-3">Счет:</h3>
            <div className="flex justify-center items-center gap-8">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">{score.straight}</div>
                <div className="text-sm text-gray-600">Натуралы</div>
              </div>
              <div className="text-3xl font-bold text-gray-400">:</div>
              <div className="text-center">
                <div className="text-3xl font-bold text-pink-600">{score.gays}</div>
                <div className="text-sm text-gray-600">Геи</div>
              </div>
            </div>
            <div className="text-center mt-2 text-sm text-gray-500">
              Раунд {roundNumber + 1}
            </div>
          </div>

          <div className="mb-6">
            <p className="text-lg">
              Готовы к следующему раунду? Роли будут распределены случайно!
            </p>
            <p className="text-sm text-gray-600 mt-2">
              Готово: {readyPlayers.length} из {totalPlayers}
            </p>
          </div>

          <button 
            onClick={onMarkAsReady}
            disabled={isReady}
            className={`w-full px-8 py-4 rounded-lg text-xl font-bold transition-transform ${
              isReady 
                ? 'bg-green-100 text-green-700 cursor-not-allowed' 
                : 'bg-gradient-to-r from-green-500 to-blue-500 text-white hover:scale-105'
            }`}
          >
            {isReady ? '✅ Готов!' : '🎮 Готов к новому раунду!'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ChaseGame = () => {
  const canvasRef = useRef(null);
  const [gameState, setGameState] = useState('menu'); // menu, lobby, playing, roundEnded, won, lost
  const [timeLeft, setTimeLeft] = useState(120);
  const [roomCode, setRoomCode] = useState('');
  const [inputRoomCode, setInputRoomCode] = useState('');
  const [playerName, setPlayerName] = useState(localStorage.getItem('playerName') || '');
  const [lastRoomCode, setLastRoomCode] = useState(localStorage.getItem('lastRoomCode') || '');
  const [playerId, setPlayerId] = useState(localStorage.getItem('lastPlayerId') || null);
  const [playerRole, setPlayerRole] = useState(localStorage.getItem('lastPlayerRole') || null); // 'straight' or 'gay'
  const [players, setPlayers] = useState({});
  const [lobbyPlayers, setLobbyPlayers] = useState([]);
  const [collision, setCollision] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [serverUrl, setServerUrl] = useState('ws://localhost:3001');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [roomExists, setRoomExists] = useState(true); // По умолчанию true, чтобы не показывать кнопку до проверки
  const [gameEndReason, setGameEndReason] = useState(null);
  const [score, setScore] = useState({ straight: 0, gays: 0 });
  const [roundNumber, setRoundNumber] = useState(0);
  const [readyPlayers, setReadyPlayers] = useState([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [lobbyReadyPlayers, setLobbyReadyPlayers] = useState([]);
  const [isLobbyReady, setIsLobbyReady] = useState(false);
  const [showRoundEndModal, setShowRoundEndModal] = useState(false);
  const [warningMessage, setWarningMessage] = useState(null);
  
  const wsRef = useRef(null);
  const keysPressed = useRef({});

  const obstacles = [
    { x: 200, y: 150, width: 80, height: 80 },
    { x: 520, y: 150, width: 80, height: 80 },
    { x: 350, y: 300, width: 100, height: 100 },
    { x: 150, y: 400, width: 80, height: 80 },
    { x: 570, y: 400, width: 80, height: 80 }
  ];

  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 600;
  const PLAYER_SIZE = 20;
  const GAME_DURATION = 120;

  useEffect(() => {
    const savedPlayerId = localStorage.getItem('lastPlayerId');
    const savedPlayerRole = localStorage.getItem('lastPlayerRole');
    const savedPlayerName = localStorage.getItem('playerName');
    const savedRoomCode = localStorage.getItem('lastRoomCode');
    
    console.log('Инициализация клиента:', {
      playerId: savedPlayerId,
      playerRole: savedPlayerRole,
      playerName: savedPlayerName,
      roomCode: savedRoomCode
    });
    
    // Восстанавливаем состояние из localStorage
    if (savedPlayerId) setPlayerId(savedPlayerId);
    if (savedPlayerRole) setPlayerRole(savedPlayerRole);
    if (savedPlayerName) setPlayerName(savedPlayerName);
    if (savedRoomCode) setLastRoomCode(savedRoomCode);
    
    connectToServer();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const connectToServer = () => {
    try {
      const ws = new WebSocket(serverUrl);
      
      ws.onopen = () => {
        console.log('Подключено к серверу');
        setConnectionStatus('connected');
        // Проверяем существование последней комнаты
        checkRoomExists();
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      };

      ws.onerror = (error) => {
        console.error('WebSocket ошибка:', error);
        setConnectionStatus('error');
      };

      ws.onclose = () => {
        console.log('Отключено от сервера');
        setConnectionStatus('disconnected');
        setTimeout(connectToServer, 3000);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Не удалось подключиться:', error);
      setConnectionStatus('error');
    }
  };

  const handleServerMessage = (data) => {
    switch (data.type) {
      case 'roomCreated':
        setRoomCode(data.roomCode);
        setPlayerId(data.playerId);
        setIsHost(true);
        setGameState('lobby');
        // Сохраняем информацию о комнате
        localStorage.setItem('lastRoomCode', data.roomCode);
        localStorage.setItem('lastPlayerId', data.playerId);
        break;
      
      case 'roomJoined':
        console.log('Подключение к комнате:', { 
          roomCode: data.roomCode, 
          playerId: data.playerId, 
          gameState: data.gameState,
          currentPlayerRole: playerRole 
        });
        setRoomCode(data.roomCode);
        setPlayerId(data.playerId);
        setIsHost(false);
        // Сохраняем информацию о комнате
        localStorage.setItem('lastRoomCode', data.roomCode);
        localStorage.setItem('lastPlayerId', data.playerId);
        // Если игра уже идет, не переключаемся в lobby
        if (data.gameState !== 'playing') {
          setGameState('lobby');
        }
        break;
      
      case 'lobbyUpdate':
        console.log('Получен lobbyUpdate, устанавливаем gameState в lobby');
        setLobbyPlayers(data.players);
        setLobbyReadyPlayers([]);
        setIsLobbyReady(false);
        setTotalPlayers(data.players.length);
        setGameState('lobby'); // Убеждаемся, что состояние игры установлено в 'lobby'
        break;
      
      case 'gameStart':
        console.log('Получен gameStart:', { roles: data.roles, playerId, currentPlayerRole: playerRole });
        const newRole = data.roles[playerId];
        console.log('Устанавливаем роль:', { playerId, newRole, allRoles: data.roles });
        setPlayerRole(newRole);
        localStorage.setItem('lastPlayerRole', newRole);
        setPlayers(data.players);
        setGameState('playing');
        setTimeLeft(GAME_DURATION);
        break;
      
      case 'gameState':
        setPlayers(data.players);
        setTimeLeft(data.timeLeft);
        // Обновляем роль игрока из сервера
        if (data.myRole) {
          setPlayerRole(data.myRole);
          localStorage.setItem('lastPlayerRole', data.myRole);
        }
        break;
      
      case 'collision':
        setCollision({ x: data.x, y: data.y, frame: 0 });
        break;
      
      case 'roundEnded':
        console.log('Раунд окончен:', data);
        console.log('Счет получен:', data.score);
        console.log('Номер раунда:', data.roundNumber);
      
        // Надёжно получаем свой id и роль
        const currentId = playerId || localStorage.getItem('lastPlayerId') || data.myId;
        const currentRole = data.myRole || (data.roles && currentId ? data.roles[currentId] : null) || playerRole || localStorage.getItem('lastPlayerRole') || 'unknown';
      
        // Нормализуем winner (в сервере используется 'straight' или 'gays')
        const winner = data.winner;
      
        // Определяем результат для текущего игрока
        let result = 'lost';
        if (winner === 'straight') {
          result = (currentRole === 'straight') ? 'won' : 'lost';
        } else if (winner === 'gays') {
          result = (currentRole === 'straight') ? 'lost' : 'won';
        }
      
        console.log(`playerId=${currentId}, role=${currentRole}, winner=${winner}, result=${result}`);
      
        setGameEndReason(data.reason || null);
        setPlayerRole(currentRole);
        localStorage.setItem('lastPlayerRole', currentRole);
        setScore(data.score || { straight: 0, gays: 0 });
        setRoundNumber(data.roundNumber || 0);
        setIsReady(false);
        setReadyPlayers(data.readyPlayers || []);
        setTotalPlayers(data.totalPlayers || 0);
        setGameState('roundEnded');
        setShowRoundEndModal(true);
        break;
      
      case 'newRound':
        console.log('Новый раунд:', data);
        setPlayerRole(data.roles[playerId]);
        localStorage.setItem('lastPlayerRole', data.roles[playerId]);
        setPlayers(data.players);
        setScore(data.score);
        setRoundNumber(data.roundNumber);
        setTimeLeft(GAME_DURATION);
        setIsReady(false);
        setReadyPlayers([]);
        setTotalPlayers(0);
        setGameState('playing');
        setShowRoundEndModal(false);
        break;
      
      case 'readyUpdate':
        console.log('Получен readyUpdate:', { 
          gameState, 
          readyPlayers: data.readyPlayers, 
          totalPlayers: data.totalPlayers 
        });
        // Всегда обновляем оба состояния готовности для надежности
        setLobbyReadyPlayers(data.readyPlayers);
        setReadyPlayers(data.readyPlayers);
        setTotalPlayers(data.totalPlayers);
        console.log('Обновлены оба состояния готовности:', data.readyPlayers);
        break;
      
      case 'playerDisconnected':
        alert(data.message);
        break;
      
      case 'error':
        alert(data.message);
        break;
      
      case 'roomExists':
        setRoomExists(data.exists);
        break;
      
      case 'friendlyFire':
        setWarningMessage({
          type: 'friendlyFire',
          message: data.message + (data.victimName ? ` (${data.victimName})` : ''),
          icon: '⚔️'
        });
        // Автоматически скрываем через 3 секунды
        setTimeout(() => setWarningMessage(null), 3000);
        break;
      
      case 'eliminated':
        setWarningMessage({
          type: 'eliminated',
          message: data.message + (data.attackerName ? ` (${data.attackerName})` : ''),
          icon: '❌'
        });
        // Автоматически скрываем через 3 секунды
        setTimeout(() => setWarningMessage(null), 3000);
        break;
    }
  };

  const sendToServer = (data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  };

  const createRoom = () => {
    if (!playerName.trim()) {
      alert('Введите имя!');
      return;
    }
    localStorage.setItem('playerName', playerName);
    sendToServer({ type: 'createRoom', playerName });
  };

  const joinRoom = () => {
    if (!playerName.trim()) {
      alert('Введите имя!');
      return;
    }
    if (!inputRoomCode.trim()) {
      alert('Введите код комнаты!');
      return;
    }
    localStorage.setItem('playerName', playerName);
    sendToServer({ type: 'joinRoom', roomCode: inputRoomCode.toUpperCase(), playerName });
  };

  const checkRoomExists = () => {
    if (lastRoomCode.trim()) {
      sendToServer({ type: 'checkRoomExists', roomCode: lastRoomCode });
    }
  };

  const reconnectToLastRoom = () => {
    if (!playerName.trim()) {
      alert('Введите имя!');
      return;
    }
    if (!lastRoomCode.trim()) {
      alert('Нет сохраненной комнаты!');
      return;
    }
    console.log(`Переподключение к комнате ${lastRoomCode} с именем ${playerName}`);
    sendToServer({ type: 'joinRoom', roomCode: lastRoomCode, playerName });
  };

  const startGame = () => {
    if (lobbyPlayers.length < 2) {
      alert('Нужно минимум 2 игрока!');
      return;
    }
    sendToServer({ type: 'startGame', roomCode });
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const markAsReady = () => {
    if (!isReady) {
      console.log('Отправляем playerReadyRound для раунда');
      sendToServer({ type: 'playerReadyRound', roomCode });
      setIsReady(true);
    }
  };

  const markAsLobbyReady = () => {
    if (!isLobbyReady) {
      sendToServer({ type: 'playerReady', roomCode });
      setIsLobbyReady(true);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      keysPressed.current[e.key.toLowerCase()] = true;
      if (e.key === ' ' && gameState === 'playing') {
        sendToServer({ type: 'dash', roomCode });
      }
    };
    const handleKeyUp = (e) => {
      keysPressed.current[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState, roomCode]);

  useEffect(() => {
    if (gameState === 'playing') {
      const inputLoop = setInterval(() => {
        const keys = keysPressed.current;
        let dx = 0;
        let dy = 0;

        if (keys['w'] || keys['arrowup']) dy -= 1;
        if (keys['s'] || keys['arrowdown']) dy += 1;
        if (keys['a'] || keys['arrowleft']) dx -= 1;
        if (keys['d'] || keys['arrowright']) dx += 1;

        if (dx !== 0 || dy !== 0) {
          sendToServer({ type: 'move', roomCode, dx, dy });
        }
      }, 1000 / 30);
      return () => clearInterval(inputLoop);
    }
  }, [gameState, roomCode]);

  useEffect(() => {
    drawGame();
  }, [players, gameState, collision]);

  useEffect(() => {
    if (collision) {
      const timer = setInterval(() => {
        setCollision(prev => {
          if (prev.frame >= 90) return null;
          return { ...prev, frame: prev.frame + 1 };
        });
      }, 16);
      return () => clearInterval(timer);
    }
  }, [collision]);

  const drawGame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#86efac';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#22c55e';
    for (let i = 0; i < CANVAS_WIDTH; i += 40) {
      for (let j = 0; j < CANVAS_HEIGHT; j += 40) {
        if ((i + j) % 80 === 0) {
          ctx.fillRect(i, j, 40, 40);
        }
      }
    }

    ctx.fillStyle = '#78716c';
    obstacles.forEach(obs => {
      ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
      ctx.strokeStyle = '#57534e';
      ctx.lineWidth = 3;
      ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
    });

    if (gameState === 'playing' && players) {
      Object.entries(players).forEach(([id, player]) => {
        // Проверяем, исключен ли игрок
        if (player.eliminated) {
          // Рисуем крестик для исключенного игрока
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(player.x - 15, player.y - 15);
          ctx.lineTo(player.x + 15, player.y + 15);
          ctx.moveTo(player.x + 15, player.y - 15);
          ctx.lineTo(player.x - 15, player.y + 15);
          ctx.stroke();
          
          // Имя исключенного игрока
          ctx.fillStyle = '#dc2626';
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(player.name + ' (X)', player.x, player.y - 25);
          return;
        }
        
        // Определяем цвет в зависимости от роли
        let fillColor, strokeColor;
        if (player.role === 'straight') {
          fillColor = '#3b82f6'; // Синий для натурала
          strokeColor = '#1e40af';
        } else if (player.role === 'unknown') {
          fillColor = '#6b7280'; // Серый для неизвестных ролей
          strokeColor = '#374151';
        } else {
          fillColor = '#ec4899'; // Розовый для геев (только натурал видит)
          strokeColor = '#be185d';
        }
        
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.arc(player.x, player.y, PLAYER_SIZE, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#000';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, player.x, player.y - 25);
      });
    }

    if (collision) {
      const size = 60 + Math.sin(collision.frame * 0.5) * 20;
      ctx.fillStyle = `rgba(200, 200, 200, ${0.8 - collision.frame / 90})`;
      ctx.beginPath();
      ctx.arc(collision.x, collision.y, size, 0, Math.PI * 2);
      ctx.fill();

      const symbols = ['💫', '💥', '✨'];
      ctx.font = '30px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(symbols[Math.floor(collision.frame / 10) % 3], collision.x, collision.y + 10);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-purple-400 via-pink-300 to-yellow-300 p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-4xl w-full">
        <h1 className="text-4xl font-bold text-center mb-4 bg-gradient-to-r from-blue-600 to-pink-600 bg-clip-text text-transparent flex items-center justify-center gap-3">
          🏳️‍🌈 Бэкдрайвер
          <span className={`w-3 h-3 rounded-full ${
            connectionStatus === 'connected' ? 'bg-green-500' :
            connectionStatus === 'error' ? 'bg-red-500' :
            'bg-yellow-500'
          }`}></span>
        </h1>

        {gameState === 'menu' && (
          <div className="space-y-6">
            <div className="bg-blue-50 p-6 rounded-lg">
              <h2 className="text-2xl font-bold mb-4 text-blue-900">Как играть:</h2>
              <div className="text-left space-y-2">
                <p className="flex items-center gap-2">
                  <User /> <strong>Синий игрок</strong> - натурал
                </p>
                <p className="flex items-center gap-2">
                  <Users /> <strong>Розовые игроки</strong> - геи
                </p>
                <p className="mt-4">🎲 <strong>Роли назначаются случайно</strong> при начале игры</p>
                <p className="mt-4">👁️ <strong>Натурал видит</strong> всех розовыми, <strong>геи видят</strong> остальных серыми!</p>
                <p className="mt-4">⌨️ Управление: WASD или стрелки</p>
                <p>⚡ Пробел - рывок (только для натурала, cooldown 3 сек)</p>
                <p className="mt-4">🎯 <strong>Цель натурала:</strong> Продержаться 2 минуты</p>
                <p>🎯 <strong>Цель геев:</strong> Поймать натурала!</p>
                <p>❌ <strong>Исключение:</strong> Атакованный гей выбывает (крестик на поле)</p>
                <p>🏆 <strong>Победа:</strong> Если остался 1 гей и 1 натурал - победа натурала!</p>
                <p className="mt-4">👥 <strong>Минимум игроков:</strong> 3 игрока</p>
              </div>
            </div>

            <div className="space-y-4">
              <input
                type="text"
                placeholder="Введите ваше имя"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg text-lg"
                maxLength={15}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button 
                  onClick={createRoom}
                  disabled={connectionStatus !== 'connected'}
                  className="bg-gradient-to-r from-blue-500 to-purple-500 text-white px-6 py-4 rounded-lg text-xl font-bold hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Создать комнату
                </button>
                
                {lastRoomCode && roomExists && (
                  <button 
                    onClick={reconnectToLastRoom}
                    disabled={connectionStatus !== 'connected'}
                    className="bg-gradient-to-r from-green-500 to-teal-500 text-white px-6 py-4 rounded-lg text-xl font-bold hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Вернуться в комнату {lastRoomCode}
                  </button>
                )}

                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Код комнаты"
                    value={inputRoomCode}
                    onChange={(e) => setInputRoomCode(e.target.value.toUpperCase())}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg text-lg text-center uppercase"
                    maxLength={6}
                  />
                  <button 
                    onClick={joinRoom}
                    disabled={connectionStatus !== 'connected' || !inputRoomCode.trim()}
                    className="w-full bg-gradient-to-r from-pink-500 to-red-500 text-white px-6 py-4 rounded-lg text-xl font-bold hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Присоединиться
                  </button>
                  {playerName && (
                    <div className="text-sm text-gray-600 text-center">
                      Имя: <strong>{playerName}</strong>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {gameState === 'lobby' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-blue-100 to-pink-100 p-6 rounded-lg">
              <h2 className="text-2xl font-bold mb-4">Комната: {roomCode}</h2>
              <button
                onClick={copyRoomCode}
                className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                {copied ? <Check /> : <Copy />}
                {copied ? 'Скопировано!' : 'Скопировать код'}
              </button>
            </div>

            {roundNumber > 0 && (
              <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
                <h3 className="text-xl font-bold mb-3">Счет:</h3>
                <div className="flex justify-between items-center">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{score.straight}</div>
                    <div className="text-sm text-gray-600">Натуралы</div>
                  </div>
                  <div className="text-2xl font-bold text-gray-400">:</div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-pink-600">{score.gays}</div>
                    <div className="text-sm text-gray-600">Геи</div>
                  </div>
                </div>
                <div className="text-center mt-2 text-sm text-gray-500">
                  Раунд {roundNumber + 1}
                </div>
              </div>
            )}

            <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
              <h3 className="text-xl font-bold mb-3">Игроки ({lobbyPlayers.length}):</h3>
              <div className="space-y-2">
                {lobbyPlayers.map((player, index) => (
                  <div key={player.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg">
                    <div className={`w-4 h-4 rounded-full ${
                      lobbyReadyPlayers.includes(player.id) ? 'bg-green-500' : 'bg-gray-400'
                    }`}></div>
                    <span className="font-bold">{player.name}</span>
                    {player.id === playerId && <span className="text-sm text-gray-500">(вы)</span>}
                    <span className="text-sm text-gray-500">(роль будет определена случайно)</span>
                    {lobbyReadyPlayers.includes(player.id) && (
                      <span className="text-sm text-green-600 font-bold">✓ Готов</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-center text-sm text-gray-600">
                Готово: {lobbyReadyPlayers.length} из {totalPlayers}
              </div>
            </div>

            {lobbyPlayers.length < 3 ? (
              <div className="text-center text-lg text-gray-600">
                Ожидание игроков... (минимум 3 игрока)
              </div>
            ) : (
              <button 
                onClick={markAsLobbyReady}
                disabled={isLobbyReady}
                className={`w-full px-6 py-4 rounded-lg text-xl font-bold transition-transform ${
                  isLobbyReady 
                    ? 'bg-green-100 text-green-700 cursor-not-allowed' 
                    : 'bg-gradient-to-r from-green-500 to-blue-500 text-white hover:scale-105'
                }`}
              >
                {isLobbyReady ? '✅ Готов к игре!' : '🎮 Готов к игре!'}
              </button>
            )}
          </div>
        )}

        {(gameState === 'playing' || gameState === 'roundEnded') && (
          <>
            {/* Предупреждение о friendly fire или исключении */}
            {warningMessage && (
              <div className={`mb-4 p-4 rounded-lg text-center font-bold text-lg animate-pulse ${
                warningMessage.type === 'friendlyFire' 
                  ? 'bg-orange-100 text-orange-800 border-2 border-orange-300' 
                  : 'bg-red-100 text-red-800 border-2 border-red-300'
              }`}>
                <span className="text-2xl mr-2">{warningMessage.icon}</span>
                {warningMessage.message}
              </div>
            )}
            
            <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2 bg-blue-100 px-4 py-2 rounded-lg">
                <Timer />
                <span className="font-bold text-xl">{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</span>
              </div>
              <div className={`px-4 py-2 rounded-lg font-bold ${
                playerRole === 'straight' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
              }`}>
                Вы: {playerRole === 'straight' ? '🏃 Натурал' : '🏳️‍🌈 Гей'}
              </div>
              {players[playerId]?.dashCooldown > 0 && playerRole === 'straight' && (
                <div className="bg-yellow-100 px-4 py-2 rounded-lg">
                  <span className="font-bold">Рывок: {players[playerId].dashCooldown.toFixed(1)}с</span>
                </div>
              )}
            </div>
            
            {roundNumber > 0 && (
              <div className="bg-white border-2 border-gray-200 rounded-lg p-3 mb-4">
                <div className="flex justify-center items-center gap-6">
                  <div className="text-center">
                    <div className="text-xl font-bold text-blue-600">{score.straight}</div>
                    <div className="text-xs text-gray-600">Натуралы</div>
                  </div>
                  <div className="text-xl font-bold text-gray-400">:</div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-pink-600">{score.gays}</div>
                    <div className="text-xs text-gray-600">Геи</div>
                  </div>
                  <div className="text-sm text-gray-500 ml-4">
                    Раунд {roundNumber + 1}
                  </div>
                </div>
              </div>
            )}
            
            <canvas 
              ref={canvasRef} 
              width={CANVAS_WIDTH} 
              height={CANVAS_HEIGHT}
              className="border-4 border-gray-800 rounded-lg w-full"
            />
          </>
        )}

        {/* Модальное окно для результатов раунда */}
        <RoundEndModal 
          isOpen={showRoundEndModal}
          gameEndReason={gameEndReason}
          score={score}
          roundNumber={roundNumber}
          readyPlayers={readyPlayers}
          totalPlayers={totalPlayers}
          isReady={isReady}
          onMarkAsReady={markAsReady}
        />


        {(gameState === 'won' || gameState === 'lost') && (
          <div className="text-center space-y-4">
            {gameState === 'won' ? (
              <>
                <h2 className="text-3xl font-bold text-green-600">
                  Победа! 🎉
                </h2>
                <p className="text-xl">
                  {playerRole === 'straight' 
                    ? 'Вы смогли продержаться 2 минуты!' 
                    : 'Геи победили! Натурал пойман!'}
                </p>
              </>
            ) : (
              <>
                <div className="text-6xl">😅</div>
                <h2 className="text-3xl font-bold text-pink-600">
                  Проигрыш
                </h2>
                <p className="text-xl">
                  {playerRole === 'straight' 
                    ? 'Вас поймали!' 
                    : 'Натурал выдержал 2 минуты!'}
                </p>
              </>
            )}
            <button 
              onClick={() => {
                setGameState('menu');
                setGameEndReason(null);
              }}
              className="bg-gradient-to-r from-blue-500 to-pink-500 text-white px-6 py-3 rounded-lg text-lg font-bold hover:scale-105 transition-transform"
            >
              Вернуться в меню
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Делаем компонент доступным глобально
window.ChaseGame = ChaseGame;