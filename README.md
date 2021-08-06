# Ampersand: Singleplayer & Multiplayer (Backend)
Ampersand is a turn-based minimalist logic-based survival game that critics have unanimously hailed as "the single best strategy game since chess."<sup>[verification needed]</sup> Since the release of the lightweight <a href="https://ampersand.netlify.app/">singleplayer edition</a>, players clamored for a cooperative version of ampersand, as well as an official leaderboard to establish worldwide ranking. The wait is over: <a href="https://ampersand-mp.netlify.app/">ampersand v2.0</a> is public!

## Stack
Ampersand's backend is written with Express, to which <a href="https://socket.io">socket.io</a> connects. Game state is held entirely on the server, and updated on client keypresses. High scores are stored using MongoDB.

## Full docs
An in-depth guide to Ampersand's game mechanics can be found <a href="https://ampersand-mp.netlify.app/docs">on the site</a>.