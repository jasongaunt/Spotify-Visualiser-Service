// Activate console timestamp logging
require('console-stamp')(console, '[HH:MM:ss.l]');

// Include our config
var config = require('./config.json');

// Some commonly used variables
var SpotifyPlaybackInformation = [];


// Functions

// Make a web API request using the Tiny JSON library
function makeJSONWebRequest(url, method, headers, payload) {
  var request;
  try {
    switch (method.toLowerCase()) {
      case "get":    request = require('tiny-json-http').get({url, headers});             break;
      case "post":   request = require('tiny-json-http').post({url, payload, headers});   break;
      case "put":    request = require('tiny-json-http').put({url, payload, headers});    break;
      case "delete": request = require('tiny-json-http').delete({url, payload, headers}); break;
      default: return false; break;
    }
    return request.then((result) => {
      // console.log(result);
      return result;
    })
    .catch((e) => {
      // console.log("Error making JSON request:");
      // console.log(e);
      return e;
    });
  } catch (e) {
    console.log(e);
    return e;
  }
}

// Update / refresh our Spotify API access token
function updateSpotifyAPIToken(user, callback, endpoint, method, headers, payload) {
  emitMessageToUserSockets(user, 'log', "Session token expired, attemping to renew...");
  var spotify_client_secret_hash = new Buffer.from(config.spotify_client_id + ":" + config.spotify_secret_id);
  var request = require('request');
  var form = {
    grant_type: 'refresh_token',
    refresh_token: SpotifyPlaybackInformation[user].refresh_token
  };
  request(
    {
      url: "https://accounts.spotify.com/api/token",
      method: "POST",
      form: form,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': 'Basic ' + spotify_client_secret_hash.toString('base64')
      }
    }, function (error, response, body) {
      if (response.statusCode === 200) {
        var response = JSON.parse(body);
        SpotifyPlaybackInformation[user].access_token = response.access_token;
        con.query("REPLACE INTO " + config.mysql_sessions + " (sid, access_token, expires, refresh_token) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)", [user, SpotifyPlaybackInformation[user].access_token, response.expires_in, SpotifyPlaybackInformation[user].refresh_token], function(err, results, fields){
          console.log(user + " session token renewed.");
          emitMessageToUserSockets(user, 'log', "Session token renewed successfully.");
          sendRequestToSpotifyAPI(user, callback, endpoint, method, headers, payload);
        });
      } else {
        console.log(error);
        console.log(response);
        console.log(body);
        // console.log("Critical error as above. Closing process.");
        // return process.exit(1);
      }
    }
  );
}

// Check we have a valid session token, renew it if required, make API request then return result
function sendRequestToSpotifyAPI(user, callback, endpoint, method, headers, payload) {
  // Check our database to see if we've got a valid session
  var final_result = false;
  con.query("SELECT sid, access_token, TIME_TO_SEC(TIMEDIFF(expires, NOW())) AS expires_in, refresh_token FROM " + config.mysql_sessions + " WHERE sid = ? LIMIT 1", [user], function(err, results, fields){
    // No valid session token found
    if ((err) || (results.length != 1)) {
      emitMessageToUserSockets(user, 'log', "Error: Unable to find your access token or there was an error. Please log in if you haven't already.");
      delete err, results, fields;
      return false;
    }
    // Session token found, see if it's close to or has expired and renew it
    SpotifyPlaybackInformation[user].refresh_token = results[0].refresh_token;
    SpotifyPlaybackInformation[user].access_token = results[0].access_token;
    if (results[0].expires_in < 300) { // Give a 5 minute / 300 second grace when close to expiry
      SpotifyPlaybackInformation[user].ready = false;
      delete err, results, fields;
      updateSpotifyAPIToken(user, callback, endpoint, method, headers, payload);
    } else {
      // Execute API call
      SpotifyPlaybackInformation[user].ready = true;
      console.log("Spotify API call for " + user + ": " + endpoint);
      makeJSONWebRequest("https://api.spotify.com" + endpoint, method, {...{ "authorization": 'Bearer ' + SpotifyPlaybackInformation[user].access_token }, ...headers}, payload)
      .then((result) => {
        callback(user, result);
        delete result;
      })
      .catch((error) => {
        console.log(error);
        emitMessageToUserSockets(user, 'log', "Error: Unable to poll the Spotify API: " + error.message);
        delete error;
      });
      delete err, results, fields;
    }
  });
}



// Callbacks
function callback_login_successful(user, result) {
  console.log("Spotify authenticated " + user);
  SpotifyPlaybackInformation[user].friendly_name = result.body.display_name;
  server.emit('log', "Welcome " + SpotifyPlaybackInformation[user].friendly_name);
  emitMessageToUserSockets(user, 'logged_in_with_spotify', true);
  delete result;
}

function callback_process_spotify_playback_status(user, result) {
  try {
    SpotifyPlaybackInformation[user].current_playback_status = result.body.is_playing;
    SpotifyPlaybackInformation[user].current_track_id = result.body.item.id;
    SpotifyPlaybackInformation[user].current_total_playback_ms = result.body.item.duration_ms;
    SpotifyPlaybackInformation[user].current_last_updated = new Date().getTime();
    SpotifyPlaybackInformation[user].current_playback_position_ms = result.body.progress_ms;
    SpotifyPlaybackInformation[user].last_api_call_attempt = 0;
  } catch (e) {
    SpotifyPlaybackInformation[user].current_playback_status = false;
  }
  if (
    (SpotifyPlaybackInformation[user].last_playback_status !== SpotifyPlaybackInformation[user].current_playback_status) ||
    (SpotifyPlaybackInformation[user].last_track_id !== SpotifyPlaybackInformation[user].current_track_id)
  ) {
    SpotifyPlaybackInformation[user].last_playback_status = SpotifyPlaybackInformation[user].current_playback_status;
    SpotifyPlaybackInformation[user].last_track_id = SpotifyPlaybackInformation[user].current_track_id;
    if (SpotifyPlaybackInformation[user].current_playback_status) {
      emitMessageToUserSockets(user, 'log', "Currently playing: " + result.body.item.artists[0].name + " - " + result.body.item.name);
      if (SpotifyPlaybackInformation[user].current_track_id !== SpotifyPlaybackInformation[user].current_beat_track_id) {
        sendRequestToSpotifyAPI(user, callback_process_spotify_track_analysis, "/v1/audio-analysis/" + SpotifyPlaybackInformation[user].current_track_id, "GET", null, null);
      }
    } else {
      emitMessageToUserSockets(user, 'log', "Playback is stopped.");
    }
  }
  delete result;
}

function callback_process_spotify_track_analysis(user, result) {
  SpotifyPlaybackInformation[user].audio_analysis = result.body;
  SpotifyPlaybackInformation[user].current_beat_track_id = SpotifyPlaybackInformation[user].current_track_id;
  delete result;
}


// Multi-user management
function addNewUserToArray(user) {
  SpotifyPlaybackInformation[user] = {
    'ready': false,
    'friendly_name': user + " (not authenticated)",
    'last_api_call_attempt': 0,
    'audio_analysis': {
      'track': {
        'tempo': 123
      },
      'bars': {},
      'beats': {},
      'sections': {
        1: {
          tempo: 123,
          start: 10000000
        }
      },
    }
  };
}

function emitMessageToUserSockets(user, namespace, message) {
  for (let [key, socket] of Object.entries(server.sockets.sockets))
    if (socket.token === user)
      socket.emit(namespace, message);
}



// Loop over each client, update its status and then update data from Spotify API
function pollSpotifyPlaybackStatus() {
  for (let user in SpotifyPlaybackInformation) {
    // Check to see if this session token key has any clients and if not, delete itself
    var hasClients = false;
    for (let [key, socket] of Object.entries(server.sockets.sockets))
      if (socket.token === user)
        hasClients = true;
    if (hasClients === false) {
      SpotifyPlaybackInformation.removeItem(user);
      continue;
    }
    // Check to see if we're ready for processing
    if (SpotifyPlaybackInformation[user].ready === false)
      continue;
    // Calculate next beat signal
    try {
      var
        new_playback_last_updated = SpotifyPlaybackInformation[user].current_last_updated || 0, 
        new_playback_position_ms = SpotifyPlaybackInformation[user].current_playback_position_ms  + (new Date().getTime() - new_playback_last_updated)|| 0, 
        new_total_playback_ms = SpotifyPlaybackInformation[user].current_total_playback_ms || 0,
        new_bar = getTrackCurrentSample(SpotifyPlaybackInformation[user].audio_analysis.bars, new_playback_position_ms),
        new_beat = getTrackCurrentSample(SpotifyPlaybackInformation[user].audio_analysis.beats, new_playback_position_ms),
        new_section = getTrackCurrentSample(SpotifyPlaybackInformation[user].audio_analysis.sections, new_playback_position_ms) || 0,
        new_tempo = Math.round(SpotifyPlaybackInformation[user].audio_analysis.sections[new_section].tempo) || 120,
        new_loudness = Math.round(SpotifyPlaybackInformation[user].audio_analysis.sections[new_section].loudness) || -100,
        new_playback_status = SpotifyPlaybackInformation[user].current_playback_status || false,
        new_playback_progress = require('sprintf-js').sprintf("%d", ((100 / parseInt(new_total_playback_ms)) * parseInt(new_playback_position_ms))) || 0,
        new_playback_position = convertMillisecondsToHumanReadable(new_playback_position_ms) || "00:00";
      if (new_playback_position_ms > new_total_playback_ms) { new_playback_position_ms = new_total_playback_ms; }
      if (new_tempo < 60) { new_tempo = Math.round(SpotifyPlaybackInformation[user].audio_analysis.track.tempo); }
      // Send info to each client if necessary
      if (new_playback_status === false) {
        if (SpotifyPlaybackInformation[user].last_playback_status !== new_playback_status) {
          for (let [key, socket] of Object.entries(server.sockets.sockets))
            if (socket.token === user)
              socket.emit('playback_information', {
                playback_status: new_playback_status,
                playback_progress: new_playback_progress,
                playback_position: new_playback_position,
                playback_bar: new_bar,
                playback_beat: new_beat,
                playback_section: new_section,
                playback_tempo: new_tempo,
                playback_loudness: new_loudness
              });
          SpotifyPlaybackInformation[user].last_playback_status = new_playback_status;
        }
      } else if (
        (SpotifyPlaybackInformation[user].last_playback_status !== new_playback_status) ||
        (SpotifyPlaybackInformation[user].last_playback_progress !== new_playback_progress) ||
        (SpotifyPlaybackInformation[user].last_playback_position !== new_playback_position) ||
        (SpotifyPlaybackInformation[user].last_playback_tempo !== new_tempo) ||
        (SpotifyPlaybackInformation[user].last_playback_bar !== new_bar) ||
        (SpotifyPlaybackInformation[user].last_playback_beat !== new_beat) ||
        (SpotifyPlaybackInformation[user].last_loudness !== new_loudness) ||
        (SpotifyPlaybackInformation[user].last_playback_section !== new_section)) {
        for (let [key, socket] of Object.entries(server.sockets.sockets))
          if (socket.token === user)
            socket.emit('playback_information', {
              playback_status: new_playback_status,
              playback_progress: new_playback_progress,
              playback_position: new_playback_position,
              playback_bar: new_bar + 1,
              playback_beat: new_beat,
              playback_section: new_section + 1,
              playback_tempo: new_tempo,
              playback_loudness: new_loudness
            });
        SpotifyPlaybackInformation[user].last_playback_status = new_playback_status;
        SpotifyPlaybackInformation[user].last_playback_progress = new_playback_progress;
        SpotifyPlaybackInformation[user].last_playback_position = new_playback_position;
        SpotifyPlaybackInformation[user].last_playback_tempo = new_tempo;
        SpotifyPlaybackInformation[user].last_playback_bar = new_bar;
        SpotifyPlaybackInformation[user].last_playback_beat = new_beat;
        SpotifyPlaybackInformation[user].last_loudness = new_loudness;
        SpotifyPlaybackInformation[user].last_playback_section = new_section;
      }
    } catch (e) {
      // Ignore
    }
    // Poll Spotify for the next item
    if (
      (new Date().getTime() - new_playback_last_updated  > config.api_poll_rate) && 
      (new Date().getTime() - SpotifyPlaybackInformation[user].last_api_call_attempt > config.api_timeout))
    {
      SpotifyPlaybackInformation[user].last_api_call_attempt = new Date().getTime();
      sendRequestToSpotifyAPI(user, callback_process_spotify_playback_status, "/v1/me/player/currently-playing", "GET", null, null);
    }
  }
}



// Helper functions (blocking)
function processGrantCode(socket, msg) {
  var session_key = require('md5')(msg);
  var spotify_client_secret_hash = new Buffer.from(config.spotify_client_id + ":" + config.spotify_secret_id);
  var request = require('request');
  var form = {
    'grant_type': "authorization_code",
    'code': msg.code,
    'redirect_uri': msg.url
  };
  request(
    {
      url: "https://accounts.spotify.com/api/token",
      method: "POST",
      form: form,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': 'Basic ' + spotify_client_secret_hash.toString('base64')
      }
    }, function (error, response, body) {
      if (response.statusCode === 200) {
        var response = JSON.parse(body);
        con.query("REPLACE INTO " + config.mysql_sessions + " (sid, access_token, expires, refresh_token) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)", [session_key, response.access_token, response.expires_in, response.refresh_token], function(err, results, fields){
          console.log(session_key + " session token generated.");
          socket.emit('session_cookie', session_key);
        });
      } else {
        console.log(error);
        console.log(response);
        console.log(body);
      }
    }
  );
}
function convertMillisecondsToHumanReadable(millis) {
  var formatter = require('sprintf-js');
  var buffer = "";
  var days = Math.floor(millis / 86400000); millis -= 86400000 * days; if (days > 0) { buffer += days + ":"; }
  var hours = Math.floor(millis / 3600000); millis -= 3600000 * hours; if ((days > 0) || (hours > 0)) { buffer += hours + ":"; }
  var minutes = Math.floor(millis / 60000); millis -= 60000 * minutes; buffer += formatter.sprintf("%02d", minutes) + ":";
  var seconds = Math.floor(millis / 1000); millis -= 1000 * seconds; buffer += formatter.sprintf("%02d", seconds);
  millis = formatter.sprintf("%1d", Math.round(millis / 100));;if (millis == 10) { millis = 0; }
  return buffer;// + millis;
}
function getTrackCurrentSample(sample, timestamp) {
  var metadata_index = -1;
  if (timestamp > 0) {  timestamp /= 1000; }
  try {
    while (true) {
      if (metadata_index + 1 >= sample.length) { return metadata_index; }
      else if (timestamp < sample[metadata_index + 1].start) { return metadata_index; }
      // else if ((timestamp >= sample[metadata_index].start) && (timestamp < sample[metadata_index + 1].start)) {
      //   return metadata_index;
      // }
      metadata_index++;
    }
  } catch (e) {
    return 0;
  }
}
Object.prototype.removeItem = function (key) {
  if (!this.hasOwnProperty(key))
    return
  if (isNaN(parseInt(key)) || !(this instanceof Array))
    delete this[key]
  else
    this.splice(key, 1)
};



//
// Main / startup execution code here
//



// Connect to MySQL and stay connected if we get disconnected
var mysql = require('mysql');
var con;
function connectToMySQL() {
  con = mysql.createConnection({
    host: config.mysql_hostname,
    user: config.mysql_username,
    password: config.mysql_password,
    database: config.mysql_database
  });
  con.connect(function(err) {
    if (err) {
      console.log("Error connecting to database:", err);
      return false;
    }
  });
  con.on('error', function(err) {
    console.log("Database error:", err);
    if(err.code === 'PROTOCOL_CONNECTION_LOST') {
      setTimeout(connectToMySQL, 1000);
    } else {
      throw err;
    }
  });
  return true;
}
console.log("Attempting to connect to MySQL...")
while (connectToMySQL() !== true) {}
console.log("Successfully connected to MySQL.");



// Set up web and socket.io servers / clients
var app = require('express')();
var http = require('http').createServer(app);
var server = require('socket.io')(http);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/web/index.html');
});

app.get('/get_spotify_client_id', (req, res) => {
  res.send(config.spotify_client_id);
});

app.get('/webclient.html', (req, res) => {
  res.sendFile(__dirname + '/web/webclient.html');
});

app.use('/static', require('express').static('web'));

http.listen(config.server_port, () => {
  console.log('listening on *:' + config.server_port);
});

// Start our client poller
setInterval(function(){
  pollSpotifyPlaybackStatus();
}, config.beat_update_check_rate);



// SocketIO server code
server.on('error', function(code, reason){
  console.log(reason);
});

server.on("end", function(code, reason){
  console.log('Connection Lost')
});

http.on('error', function(code, reason){
  console.log(reason);
});

app.on('error', function(code, reason){
  console.log(reason);
});

server.on('connection', (socket) => {
  console.log('Client ' + socket.id + ' connected from ' + (socket.handshake.headers["x-real-ip"] || socket.handshake.address) + '.');

  socket.on('error', () => {
    console.log("Error in socket.");
  });

  socket.on('log', (msg) => {
    let display_name = SpotifyPlaybackInformation[socket.token].friendly_name || socket.id + " (not authenticated)";
    server.emit('log', display_name + ': ' + msg);
    console.log(display_name + ': ' + msg);
  });

  socket.emit('login_request', "Please log in " + socket.id);

  socket.on('spotify_grant_code', (msg) => {
    processGrantCode(socket, msg);
  });

  socket.on('login', (msg) => {
    console.log("Client " + socket.id + ' attempting to log in with session ID ' + msg);
    socket.token = encodeURIComponent(msg);
    if (!(socket.token in SpotifyPlaybackInformation)) {
      console.log("Client " + socket.token + " not found in our poller yet, adding now... ");
      addNewUserToArray(socket.token);
      sendRequestToSpotifyAPI(socket.token, callback_login_successful, "/v1/me", "GET", false, false);
    }
  });

  socket.on('connect_to_spotify', (msg) => {
    if (msg !== true)
      return;
    server.emit('log', 'User ' + SpotifyPlaybackInformation[socket.token].friendly_name + ' (' + socket.id + ') connected.');
  });

  socket.on('disconnect', () => {
    var display_name = "Unauthenticated";
    try { display_name = SpotifyPlaybackInformation[socket.token].friendly_name; } catch (e) {}
    console.log('* ' + display_name + '(' + socket.id + ') disconnected.');
    server.emit('log', 'User ' + display_name + '(' + socket.id + ') disconnected.');
  });
});


