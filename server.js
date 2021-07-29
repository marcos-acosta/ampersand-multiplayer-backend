const express = require("express");
const socketIO = require("socket.io");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const port = process.env.PORT || 4000;

const server = app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

const io = socketIO(server, {
  cors: {
    credentials: true,
    // origin: "http://localhost:3000"
    origin: "https://ampersand-mp.netlify.app"
  }
});

const sendStartInfo = async (emitter, room_id) => {
  let game_data = {
    ...rooms[room_id]
  }
  delete game_data.id_to_username
  await emitter.to(room_id).emit("start_info", game_data);
};

const BOARD_WIDTH = 9;
const KEY_TO_DIRECTION = {
  'w': [0, 1],
  'a': [-1, 0],
  's': [0, -1],
  'd': [1, 0]
};
const UP = [0, 1];
const RIGHT = [1, 0];
const DOWN = [0, -1];
const LEFT = [-1, 0];
const UP_RIGHT = [1, 1];
const UP_LEFT = [-1, 1];
const DOWN_LEFT = [-1, -1];
const DOWN_RIGHT = [1, -1];
const ALL_DIRECTIONS = [UP, RIGHT, DOWN, LEFT, UP_RIGHT, UP_LEFT, DOWN_LEFT, DOWN_RIGHT];
const START_POINT_P1 = [4, 4];
const START_POINT_P2 = [5, 4];
const MAX_BOMB_THRESHOLD = 0.98;
const INITIAL_BOMB_THRESHOLD = 0.7;
const BOMB_THRESHOLD_TIME_CONSTANT = 0.7;
const REVIVER_THRESHOLD = 0.8;
const ENEMY_INCREASE_RATE = 0.0275;
const NUKE_SPAWN_THRESHOLD = 0.8;
const rooms = {};
const validKeys = new Set(['w', 'a', 's', 'd', 'r']);

const getBombThreshold = (room) => {
  return MAX_BOMB_THRESHOLD - (MAX_BOMB_THRESHOLD - INITIAL_BOMB_THRESHOLD) * Math.exp(-BOMB_THRESHOLD_TIME_CONSTANT * room.bombs.length);
}

const distance = (coord_1, coord_2) => {
  return Math.sqrt(Math.pow(coord_1[0] - coord_2[0], 2) + Math.pow(coord_1[1] - coord_2[1], 2));
}

const closestIndex = (distances) => {
  if (distances.length === 1) {
    return 0;
  } else {
    return distances[0] < distances[1] ? 0 : 1;
  }
}

const candidateDirections = (startPosition, targetPosition) => {
  let direction = subtractVectors(targetPosition, startPosition);
  // Orthogonal
  if (direction[0] === 0 || direction[1] === 0) {
    let orthogonal = makeOrthogonalUnitVector(direction);
    let potentials;
    // Going up or down, so left/right is ok too
    if (direction[0] === 0) {
      potentials = shuffleArray([LEFT, RIGHT]);
    // Going left or right, so up/down is ok too
    } else {
      potentials = shuffleArray([UP, DOWN]);
    }
    return [orthogonal, ...potentials];
  }
  // Not orthogonal
  else {
    if (Math.abs(direction[0]) === Math.abs(direction[1])) {
      if (direction[0] > 0 && direction[1] > 0) {
        return shuffleArray([UP, RIGHT]);
      } else if (direction[0] < 0 && direction[1] > 0) {
        return shuffleArray([UP, LEFT]);
      } else if (direction[0] < 0 && direction[0] < 0) {
        return shuffleArray([DOWN, LEFT]);
      } else {
        return shuffleArray([DOWN, RIGHT]);
      }
    } else {
      if (direction[0] > Math.abs(direction[1])) {
        if (direction[1] > 0) {
          return [RIGHT, UP];
        } else {
          return [DOWN, UP];
        }
      } else if (direction[1] > Math.abs(direction[0])) {
        if (direction[0] > 0) {
          return [UP, RIGHT];
        } else {
          return [UP, LEFT];
        }
      } else if (-direction[0] > Math.abs(direction[1])) {
        if (direction[1] > 0) {
          return [LEFT, UP];
        } else {
          return [LEFT, DOWN];
        }
      } else {
        if (direction[0] > 0) {
          return [DOWN, RIGHT];
        } else {
          return [DOWN, LEFT];
        }
      }
    }
  }
}

const moveEnemies = (room) => {
  let userPositions = getAlivePlayers(room).map(username => room.players[username].position);
  let enemies = room.enemies;
  for (let i = 0; i < enemies.length; i++) {
    enemies[i].new = false;
    let enemyPosition = enemies[i].position;
    let distances = userPositions.map(userPosition => distance(enemyPosition, userPosition));
    let closerPosition = userPositions[closestIndex(distances)];
    let candidateMoves = candidateDirections(enemyPosition, closerPosition);
    for (let j = 0; j < candidateMoves.length; j++) {
      let candidateCoord = addVectors(enemies[i].position, candidateMoves[j]);
      if (!enemyOnSquare(room, candidateCoord) && posInBounds(candidateCoord)) {
        let playerAttacked = livingPlayerOnSquare(room, candidateCoord);
        if (playerAttacked) {
          killPlayer(room, playerAttacked);
          unwillinglyDonateBombs(room, playerAttacked, false);
        }
        room.enemies[i].position = candidateCoord;
        break;
      }
    }
  }
}

const livingPlayerOnSquare = (room, coord) => {
  let living_usernames = getAlivePlayers(room);
  for (let i = 0; i < living_usernames.length; i++) {
    let username = living_usernames[i]
    if (coordsEqual(coord, room.players[username].position)) {
      return username;
    }
  }
  return false;
}

const enemyOnSquare = (room, coord) => {
  for (let i = 0; i < room.enemies.length; i++) {
    if (coordsEqual(room.enemies[i].position, coord)) {
      return true;
    }
  }
  return false;
}

const bombOnSquare = (room, coord) => {
  for (let i = 0; i < room.bombs.length; i++) {
    if (coordsEqual(room.bombs[i].position, coord)) {
      return true;
    }
  }
  return false;
}

const livingPlayerOrEnemyOnSquare = (room, coord) => {
  return livingPlayerOnSquare(room, coord) || enemyOnSquare(room, coord);
}

const getOtherPlayerUsername = (room, username) => {
  let usernames = Object.keys(room.players);
  let other = usernames.filter(username_ => username_ !== username);
  if (other.length > 0) {
    return other[0];
  } else {
    return null;
  }
}

const otherPlayerOnSquare = (room, coord, username) => {
  let otherUsername = getOtherPlayerUsername(room, username);
  return otherUsername && room.players[otherUsername].alive && coordsEqual(room.players[otherUsername].position, coord);
}

const killEnemyAt = (room, coord) => {
  for (let i = 0; i < room.enemies.length; i++) {
    if (coordsEqual(room.enemies[i].position, coord)) {
      room.enemies.splice(i, 1);
      return true;
    }
  }
  return false;
}

const collectBombAt = (room, coord) => {
  for (let i = 0; i < room.bombs.length; i++) {
    if (coordsEqual(room.bombs[i].position, coord)) {
      room.bombs.splice(i, 1);
      return true;
    }
  }
  return false;
}

const collectReviverAt = (room, coord) => {
  if (room.reviver_position && coordsEqual(room.reviver_position, coord)) {
    room.reviver_position = null;
    return true;
  }
  return false;
}

const collectNukeAt = (room, coord) => {
  if (room.nuke_position && coordsEqual(room.nuke_position, coord)) {
    room.nuke_position = null;
    return true;
  }
  return false;
}

const getValidSpawnCoord = (room) => {
  let direction;
  let spawnCoord;
  let location;
  let giveUpCount = (BOARD_WIDTH - 1) * 4;
  do {
    location = Math.floor(Math.random() * (BOARD_WIDTH - 1) * 4);
    if (location < (BOARD_WIDTH - 1)) {
      spawnCoord = [location, 0];
      direction = UP;
    } else if (location < 2 * (BOARD_WIDTH - 1)) {
      spawnCoord = [0, location % (BOARD_WIDTH - 1) + 1];
      direction = RIGHT;
    } else if (location < 3 * (BOARD_WIDTH - 1)) {
      spawnCoord = [location % (BOARD_WIDTH - 1) + 1, 8];
      direction = DOWN;
    } else {
      spawnCoord = [8, location % (BOARD_WIDTH - 1)];
      direction = LEFT;
    }
    giveUpCount--;
  } while ((squareOccupied(room, spawnCoord) || playersNearby(room, spawnCoord)) && giveUpCount > 0);
  if (giveUpCount > 0) {
    return {
      position: spawnCoord,
      spawnDirection: direction
    }
  } else {
    return false;
  }
}

const spawnEnemy = (room) => {
  let spawnData = getValidSpawnCoord(room);
  if (spawnData) {
    room.enemies.push({
      ...spawnData,
      new: true,
      id: room.enemy_index
    });
    room.enemy_index++;
  }
}

const playersNearby = (room, coord) => {
  let usernames = Object.keys(room.players);
  for (let i = 0; i < usernames.length; i++) {
    let username = usernames[i]
    if (distance(room.players[username].position, coord) < 2) {
      return true;
    }
  }
  return false;
}

const spawnEnemies = (room) => {
  let spawn_threshold = room.enemy_spawn_threshold;
  let rand = Math.random();
  if (rand > spawn_threshold) {
    spawnEnemy(room);
    if (rand > (spawn_threshold + 1) / 2) {
      spawnEnemy(room);
    }
  }
  if (room.turns % 10 == 0) {
    room.enemy_spawn_threshold = Math.max(0, spawn_threshold - ENEMY_INCREASE_RATE);
  }
}

const spawnBomb = (room) => {
  if (Math.random() <= getBombThreshold(room)) {
    return;
  }
  let giveUpCount = BOARD_WIDTH ** 2;
  let location;
  do {
    let rand = Math.floor(Math.random() * (BOARD_WIDTH ** 2));
    location = [Math.floor(rand / BOARD_WIDTH), rand % BOARD_WIDTH];
    giveUpCount--;
  } while (squareOccupied(room, location) && giveUpCount > 0);
  if (giveUpCount > 0) {
    room.bombs.push({
      id: room.bomb_index,
      position: location,
    });
    room.bomb_index++;
  }
}

const spawnNuke = (room) => {
  if (room.nuke_position || room.enemies.length <= 10 || Math.random() <= NUKE_SPAWN_THRESHOLD) {
    return;
  }
  let giveUpCount = BOARD_WIDTH ** 2;
  let location;
  do {
    let rand = Math.floor(Math.random() * (BOARD_WIDTH ** 2));
    location = [Math.floor(rand / BOARD_WIDTH), rand % BOARD_WIDTH];
    giveUpCount--;
  } while (squareOccupied(room, location) && giveUpCount > 0);
  if (giveUpCount > 0) {
    room.nuke_position = location;
  }
}

const spawnReviver = (room) => {
  if (Math.random() <= REVIVER_THRESHOLD) {
    return
  }
  let giveUpCount = BOARD_WIDTH ** 2;
  let location;
  do {
    let rand = Math.floor(Math.random() * (BOARD_WIDTH ** 2));
    location = [Math.floor(rand / BOARD_WIDTH), rand % BOARD_WIDTH];
    giveUpCount--;
  } while (squareOccupied(room, location) && giveUpCount > 0);
  if (giveUpCount > 0) {
    room.reviver_position = location;
  }
}

const squareOccupied = (room, coord) => {
  return livingPlayerOrEnemyOnSquare(room, coord) || 
    bombOnSquare(room, coord) || 
    (room.reviver_position && coordsEqual(coord, room.reviver_position)) ||
    (room.nuke_position && coordsEqual(coord, room.nuke_position));
}

const posInBounds = (pos) => {
  return pos[0] >= 0 && pos[0] < BOARD_WIDTH && pos[1] >= 0 && pos[1] < BOARD_WIDTH;
}

const coordsEqual = (a, b) => {
  return a[0] == b[0] && a[1] == b[1];
}

const useBomb = (room, position) => {
  for (let i = 0; i < ALL_DIRECTIONS.length; i++) {
    let direction = ALL_DIRECTIONS[i];
    let coord = addVectors(position, direction);
    killEnemyAt(room, coord);
    room.score += 5;
  }
}

const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
  }
  return array
}

const addVectors = (a, b) => {
  return [a[0] + b[0], a[1] + b[1]];
}

const subtractVectors = (a, b) => {
  return [a[0] - b[0], a[1] - b[1]];
}

const makeOrthogonalUnitVector = (a) => {
  if (a[0] === 0) {
    return [0, Math.floor(a[1] / Math.abs(a[1]))];
  } else {
    return [Math.floor(a[0] / Math.abs(a[0])), 0];
  }
}

const unwillinglyDonateBombs = (room, username, isKiller) => {
  let deceasedUsername;
  let otherUsername;
  if (isKiller) {
    deceasedUsername = getOtherPlayerUsername(room, username);
    otherUsername = username;
  } else {
    deceasedUsername = username;
    otherUsername = getOtherPlayerUsername(room, username);
  }
  room.players[otherUsername].num_bombs += room.players[deceasedUsername].num_bombs;
  room.players[deceasedUsername].num_bombs = 0;
}

const enemyNearby = (room, coord) => {
  for (let i = 0; i < ALL_DIRECTIONS.length; i++) {
    if (enemyOnSquare(room, addVectors(coord, ALL_DIRECTIONS[i]))) {
      return true;
    }
  }
  return false;
}

const areOdd = (coord_1, coord_2) => {
  return (coord_1[0] + coord_1[1] + coord_2[0] + coord_2[1]) % 2 === 0;
}

const reviveFriend = (room, livingPlayerUsername) => {
  let deadFriendUsername = Object.keys(room.players).find(username =>
    !room.players[username].alive
  );
  let location;
  // TODO: if there's no square to spawn on, wait?
  let circuit_breaker = BOARD_WIDTH ** 2;
  do {
    let rand = Math.floor(Math.random() * (BOARD_WIDTH ** 2));
    location = [Math.floor(rand / BOARD_WIDTH), rand % BOARD_WIDTH];
    circuit_breaker--;
  } while (squareOccupied(room, location) || (enemyNearby(room, location) && circuit_breaker > 0));
  // Revive
  room.players[deadFriendUsername].alive = true;
  room.players[deadFriendUsername].position = location;
  // Add back to playing order
  room.order.push(deadFriendUsername);
  // Set turn to friend so next comes revived player
  room.whose_turn = 0;
  // No more easy mode
  room.enemy_spawn_threshold -= 0.25;
  // Living player gives revived player a bomb, if they'll have one to spare
  if (room.players[livingPlayerUsername].num_bombs > 1) {
    room.players[livingPlayerUsername].num_bombs--;
    room.players[deadFriendUsername].num_bombs++;
  }
}

const protectRoomData = (room) => {
  let cleanRoomData = {
    ...room
  }
  delete cleanRoomData.id_to_username;
  let usernames = Object.keys(cleanRoomData.players);
  usernames.forEach((username) => {
    delete cleanRoomData.players[username].socket_id;
  });
  return cleanRoomData;
}

const getAlivePlayers = (room) => {
  return Object.keys(room.players).filter(username => room.players[username].alive);
}

const killPlayer = (room, username) => {
  room.players[username].alive = false;
  room.players[username].deaths++;
  room.order = getAlivePlayers(room);
  room.enemy_spawn_threshold += 0.25;
}

const resetRoom = (room) => {
  room.enemies = [];
  room.bombs = [];
  room.blocked = [];
  room.enemy_spawn_threshold = 0.5;
  room.enemy_index = 0;
  room.bomb_index = 0;
  room.turns = 0;
  room.order = shuffleArray(Object.keys(room.players));
  room.whose_turn = 0;
  room.score = 0;
  room.streak = 0;
  room.reviver_position = null;
  room.game_state = "normal";
  room.nuke_position = null;
  let usernames = Object.keys(room.players);
  for (let i = 0; i < usernames.length; i++) {
    let player = room.players[usernames[i]];
    player.alive = true;
    player.num_bombs = 2;
    player.deaths = 0;
    player.hits = 0;
    player.bombs_collected = 0;
    if (i == 0) {
      player.position = START_POINT_P1.slice();
    } else {
      player.position = START_POINT_P2.slice();
    }
  }
}

app.get('/', (req, res) => {
  res.send("GENERAL KENOBI: Hello there.")
})

app.post('/room_available', (req, res) => {
  res.send({
    num_players: rooms.hasOwnProperty(req.body.room_id) ? Object.keys(rooms[req.body.room_id].players).length : 0
  });
});

app.post('/uniquely_identifying', (req, res) => {
  if (!rooms.hasOwnProperty(req.body.room_id)) {
    // No one in the room, you're unique
    res.send({unique: true, reasons: []});
  } else {
    let players = rooms[req.body.room_id].players;
    let player_one = Object.keys(players)[0];
    let username_unique = req.body.username !== player_one;
    let appearance_unique = req.body.color !== players[player_one].color || req.body.character !== players[player_one].character;
    let reasons = [];
    if (!username_unique) {
      reasons.push("username");
    }
    if (!appearance_unique) {
      reasons.push("appearance");
    }
    res.send({
      unique: username_unique && appearance_unique,
      reasons: reasons
    });
  }
});

io.on("connection", (socket) => {
  socket.on("join_room", (data) => {
    let player = {
      color: data.color,
      character: data.character,
      socket_id: socket.id,
      alive: true,
      num_bombs: 2,
      deaths: 0,
      hits: 0,
      bombs_collected: 0
    };
    if (rooms.hasOwnProperty(data.room_id)) {
      let room = rooms[data.room_id];
      if (room.players.length >= 2) {
        io.to(socket.id).emit("room_full");
      } else {
        // slice() returns a copy
        player.position = START_POINT_P2.slice();
        room.players[data.username] = player;
        room.id_to_username[socket.id] = data.username;
        room.order.push(data.username);
        socket.join(data.room_id);
      }
    } else {
      rooms[data.room_id] = {
        players: {},
        enemies: [],
        bombs: [],
        blocked: [],
        enemy_spawn_threshold: 0.5,
        enemy_index: 0,
        bomb_index: 0,
        turns: 0,
        id_to_username: {},
        order: [data.username],
        whose_turn: -1,
        score: 0,
        streak: 0,
        reviver_position: null,
        game_state: "normal",
        nuke_position: null
      }
      player.position = START_POINT_P1.slice();
      rooms[data.room_id].players[data.username] = player;
      rooms[data.room_id].id_to_username[socket.id] = data.username;
      socket.join(data.room_id);
    }
    if (Object.keys(rooms[data.room_id].players).length === 2) {
      rooms[data.room_id].whose_turn = 0;
      sendStartInfo(io, data.room_id);
    }
  });

  socket.on("keypress", (data) => {
    let room_id = data.room_id, key = data.key;
    let revived_friend = false;
    // Generic catch-all so the server doesn't crash
    try {
      let room = rooms[room_id];
      if (room.game_state === 'game_over') {
        if (key === 'Enter') {
          resetRoom(room);
          io.emit("room_reset", protectRoomData(room));
        }
        return;
      }
      if (!validKeys.has(key)) {
        return;
      }
      let username = room.id_to_username[socket.id];
      // Not your turn, buddy
      if (room.order[room.whose_turn] !== username) {
        return;
      }
      let position = room.players[username].position;
      let direction;
      // Use bomb
      if (key === 'r') {
        if (room.players[username].num_bombs <= 0) {
          return;
        } else {
          useBomb(room, position);
          room.players[username].num_bombs -= 1;
          direction = [0, 0];
        }
      }
      // Move / attack
      else {
        direction = KEY_TO_DIRECTION[key];
        let proposed_pos = addVectors(position, direction);
        if (posInBounds(proposed_pos)) {
          // Attack enemy
          if (enemyOnSquare(room, proposed_pos)) {
            killEnemyAt(room, proposed_pos);
            room.streak += 1;
            room.score += 10 + 5 * (room.streak - 1);
            room.players[username].hits++;
          } else {
            room.streak = 0;
            if (!otherPlayerOnSquare(room, proposed_pos, username)) {
              if (collectBombAt(room, proposed_pos)) {
                room.players[username].num_bombs++;
                room.players[username].bombs_collected++;
              }
              if (collectReviverAt(room, proposed_pos)) {
                reviveFriend(room, username);
                revived_friend = true;
                room.score += 50;
              }
              if (collectNukeAt(room, proposed_pos)) {
                room.enemies = [];
                room.score += 50;
              }
              room.players[username].position = proposed_pos;
            }
            // Kill your friend :(
            else {
              killPlayer(room, getOtherPlayerUsername(room, username));
              room.score -= 50;
              unwillinglyDonateBombs(room, username, true);
            }
          }
        } else {
          room.streak = 0;
        }
      }
      // One complete "round" => move enemies
      if (room.whose_turn >= room.order.length - 1) {
        moveEnemies(room);
        room.score++;
        room.turns++;
        spawnEnemies(room);
        if (room.order.length < 2 && !room.reviver_position) {
          spawnReviver(room);
        }
        spawnNuke(room);
        spawnBomb(room);
      }
      if (room.order.length === 0) {
        room.game_state = "game_over";
      } else {
        room.whose_turn = (room.whose_turn + 1) % room.order.length;
      }
      let returnData = {
        ...protectRoomData(room),
        keyPressed: key,
        direction: direction,
        playerMoved: username,
        revivedFriend: revived_friend
      };
      io.to(room_id).emit("game_update", returnData);
    } catch (e) {
      // Do nothing
    }
  });

  socket.on("disconnect", () => {
    let room_keys = Object.keys(rooms);
    for (let i = 0; i < room_keys.length; i++) {
      let room = rooms[room_keys[i]];
      if (room.id_to_username.hasOwnProperty(socket.id)) {
        let username = room.id_to_username[socket.id];
        delete room.id_to_username[socket.id];
        delete room.players[username];
        if (Object.keys(room.players).length === 0) {
          delete rooms[room_keys[i]];
        }
        let indexInOrder = room.order.findIndex((uname) => uname === username);
        room.order.splice(indexInOrder, 1);
      }
    }
  });
})