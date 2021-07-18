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
    origin: "http://localhost:3000"
  }
});

const sendGameUpdate = async (emitter, room_id) => {
  let game_data = {
    ...rooms[room_id]
  }
  delete game_data.socket_to_idx
  await emitter.to(room_id).emit("game_data", game_data);
};

const rooms = {}
const START_POINT_P1 = [5, 3];
const START_POINT_P2 = [5, 8];

app.get('/', (req, res) => {
  res.send("GENERAL KENOBI: Hello there.")
})

app.post('/room_available', (req, res) => {
  res.send({
    num_players: rooms.hasOwnProperty(req.body.room_id) ? rooms[req.body.room_id].players.length : 0
  });
});

app.post('/uniquely_identifying', (req, res) => {
  if (!rooms.hasOwnProperty(req.body.room_id)) {
    // No one in the room, you're unique
    res.send({unique: true, reasons: []});
  } else {
    let players = rooms[req.body.room_id].players;
    let player_one = players[0];
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
  socket.on("join_room", async (data) => {
    let player = {
      username: data.username,
      contribution: 0,
      color: data.color,
      character: data.character
    }
    if (rooms.hasOwnProperty(data.room_id)) {
      let room = rooms[data.room_id];
      if (room.players.length >= 2) {
        io.to(socket.id).emit("room_full");
      } else {
        // slice() returns a copy
        player.position = START_POINT_P2.slice();
        room.players.push(player);
        // Map this socket id to index 1
        room.socket_to_idx[socket.id] = 1;
        socket.join(data.room_id);
      }
    } else {
      rooms[data.room_id] = {
        players: [],
        enemies: [],
        bombs: [],
        nukes: [],
        blocked: [],
        waiting_on: 0,
        turns: 0,
        score: 0,
        bombs: 3,
        socket_to_idx: {}
      }
      player.position = START_POINT_P1.slice();
      rooms[data.room_id].players.push(player);
      // Map this socket id to index 0
      rooms[data.room_id].socket_to_idx[socket.id] = 0;
      socket.join(data.room_id);
    }
    // console.log(rooms);
    await sendGameUpdate(io, data.room_id);
  });

  socket.on("disconnect", () => {
    let roomLeftKey = Object.keys(rooms).filter(room => {
      let socket_to_idx = rooms[room].socket_to_idx;
      return socket_to_idx.hasOwnProperty(socket.id);
    });
    if (roomLeftKey.length > 0) {
      // Get room
      let roomLeft = rooms[roomLeftKey[0]];
      // Get index of player in players list
      let playerIndex = roomLeft.socket_to_idx[socket.id];
      // Delete socket to index mapping
      delete roomLeft.socket_to_idx[socket.id];
      // Dete player using index
      roomLeft.players.splice(playerIndex, 1);
      // Delete room if no one left
      if (roomLeft.players.length === 0) {
        delete rooms[roomLeftKey];
      }
    }
    // console.log(rooms);
  });
})