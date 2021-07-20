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
  delete game_data.socket_to_idx
  await emitter.to(room_id).emit("start_info", game_data);
};

const BOARD_WIDTH = 9;
const KEY_TO_DIRECTION = {
  'w': [0, 1],
  'a': [-1, 0],
  's': [0, -1],
  'd': [1, 0]
};

const posInBounds = (pos) => {
  return pos[0] >= 0 && pos[0] < BOARD_WIDTH && pos[1] >= 0 && pos[1] < BOARD_WIDTH;
}

const addVectors = (a, b) => {
  return [a[0] + b[0], a[1] + b[1]];
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

const rooms = {}
const START_POINT_P1 = [3, 4];
const START_POINT_P2 = [5, 4];

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
    let player_one = players[Object.keys(players)[0]];
    let username_unique = req.body.username !== player_one.username;
    let appearance_unique = req.body.color !== player_one.color || req.body.character !== player_one.character;
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
  // console.log('connect!');
  // console.log(io.sockets.sockets.keys());
  socket.on("join_room", (data) => {
    let player = {
      color: data.color,
      character: data.character,
      socket_id: socket.id,
    };
    if (rooms.hasOwnProperty(data.room_id)) {
      let room = rooms[data.room_id];
      if (room.players.length >= 2) {
        io.to(socket.id).emit("room_full");
      } else {
        // slice() returns a copy
        player.position = START_POINT_P2.slice();
        room.players[data.username] = player;
        room.id_to_username[  socket.id] = data.username;
        room.order.push(data.username);
        socket.join(data.room_id);
      }
    } else {
      rooms[data.room_id] = {
        players: {},
        enemies: [],
        bombs: [],
        nukes: [],
        blocked: [],
        turns: 0,
        bombs: 3,
        id_to_username: {},
        order: [data.username],
        whose_turn: -1,
        score: 0,
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
    // console.log(rooms);
  });

  socket.on("keypress", (data) => {
    let room_id = data.room_id, key = data.key;
    try {
      let room = rooms[room_id]
      let username = room.id_to_username[socket.id];
      // Not your turn, buddy
      if (room.order[room.whose_turn] !== username) {
        return
      }
      let position = room.players[username].position;
      let direction = KEY_TO_DIRECTION[key];
      let proposed_pos = addVectors(position, direction);
      if (posInBounds(proposed_pos)) {
        room.players[username].position = proposed_pos;
      }
      if (room.whose_turn === room.order.length - 1) {
        room.score += 1
        // Move enemies
      }
      room.whose_turn = (room.whose_turn + 1) % room.order.length;
      let returnData = {
        ...protectRoomData(room),
        keyPressed: key,
        direction: direction,
        playerMoved: username
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
    // console.log(rooms);
    // console.log('disconnect!');
    // console.log(io.sockets.sockets.keys());
  });
})