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
})

const rooms = {}
const START_POINT_P1 = [5, 3];
const START_POINT_P2 = [5, 8];

app.get('/', (req, res) => {
  res.send("Hello there.")
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
  socket.on("join_room", (data) => {
    let player = {
      username: data.username,
      contribution: 0,
      color: data.color,
      character: data.character,
    }
    if (rooms.hasOwnProperty(data.room_id)) {
      let room = rooms[data.room_id];
      if (room.players.length >= 2) {
        io.to(socket.id).emit("room_full");
      } else {
        // slice() returns a copy
        player.position = START_POINT_P2.slice();
        room.players[socket.id] = player;
      }
    } else {
      rooms[data.room_id] = {
        players: {},
        enemies: [],
        bombs: [],
        nukes: [],
        blocked: [],
        waiting_on: 0,
        turns: 0,
        score: 0,
        bombs: 3
      }
      player.position = START_POINT_P1.slice();
      rooms[data.room_id].players = {}
      rooms[data.room_id].players[socket.id] = player;
    }
    console.log(rooms);
  });

  socket.on("disconnect", () => {
    let roomLeft = Object.keys(rooms).filter(room => 
      rooms[room].players.hasOwnProperty(socket.id)
    );
    if (roomLeft.length > 0) {
      roomLeft = roomLeft[0];
      delete rooms[roomLeft].players[socket.id];
      if (Object.keys(rooms[roomLeft].players).length === 0) {
        delete rooms[roomLeft];
      }
    }
    // console.log(rooms);
  });
})