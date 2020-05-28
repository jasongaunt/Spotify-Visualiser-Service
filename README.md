# Spotify-Visualiser-Service

Spotify-Visualiser-Service is a [NodeJS](https://nodejs.org/) application that will allow [socket.io](https://socket.io/) clients to connect, provide authentication and will then serve real-time [Spotify](https://www.spotify.com/) playback information by polling the [Spotify Developer API](https://developer.spotify.com/) for playback and track information.

It will then send updates with the following information;

* Playback status - true or false
* Artist and Title of the currently playing track
* Percentage of how much of the current track has been played
* Human-readable timestamp of how much of the current track has been played
* The current music bar of the song
* The current beat of the song
* The current section of the song
* The current tempo of the current section of the song
* The current average loudness of the current section of the song

Depending on a number of factors (in particular, how fast a particular tracks tempo is) this service may send upwards of 4-5 updates _per second_.

You can find a *changelog* at the bottom of this page.

## Requirements

Absolute minimum requirements are NodeJS to run the application and a [MySQL]([https://www.mysql.com/](https://www.mysql.com/)) server to store session tokens (and in a future update, cache Spotify track analysis JSON documents to limit API calls).

This tool was built using NodeJS v12.x and MySQL 5.7.x. - I haven't tested it on other versions, it may or may not work, if it does please let me know!

It is ***highly*** recommended you proxy access to this service through [NGINX]([https://www.nginx.com/](https://www.nginx.com/)) (or another suitable product) that can do [SSL or rather TLS termination](https://en.wikipedia.org/wiki/TLS_termination_proxy) to help prevent [MITM attacks](https://en.wikipedia.org/wiki/Man-in-the-middle_attack). You can find a guide on how to set that up with NGINX [here]([https://www.nginx.com/blog/nginx-nodejs-websockets-socketio/](https://www.nginx.com/blog/nginx-nodejs-websockets-socketio/)).

You probably want something to keep the process running too, perhaps something like [forever](https://www.npmjs.com/package/forever) or even better, [PM2](https://pm2.keymetrics.io/).

You will also need a [Spotify Developer App Client ID](https://developer.spotify.com/dashboard/) (which you get by creating an application). This also means you will be bound by the [Spotify Developer terms of service](https://developer.spotify.com/terms/).

## Installation

Use the NodeJS `npm` command line tool to install the dependencies. Here's a quick installation guide;

```bash
git clone https://github.com/jasongaunt/Spotify-Visualiser-Service.git
cd Spotify-Visualiser-Service/
npm install
```

After installation, you _must_ copy `config.json-sample` to `config.json`, open it in your favourite editor and fill in all the fields.

Next you must set up the MySQL, first we need to create a database and a user;

```bash
mysql -u your_db_admin_username -p
```
```sql
CREATE DATABASE spotify_visualiser;
CREATE USER 'spotify_visualiser_user'@'localhost' IDENTIFIED BY 'SECURE_PASSWORD_HERE';
GRANT ALL ON myspotify_visualiser_db.* TO 'spotify_visualiser_user'@'localhost';
FLUSH PRIVILEGES;
```
Feel free to change the `spotify_visualiser`, `spotify_visualiser_user` values, but you ***must*** change the `SECURE_PASSWORD_HERE` value for something more secure!

Finally, import the included SQL schema;

```bash
mysql -u your_db_admin_username -p spotify_visualiser < misc/schema.sql
```
And that's it. You should be ready to rock.

## Usage

Launching the application is as simple as running;

```bash
nodejs Spotify-Visualiser-Service.js
```

The application will then launch, and if successful, you should see the following...
```
[[22:40:02.198]] [LOG]    Attempting to connect to MySQL...
[[22:40:02.442]] [LOG]    Successfully connected to MySQL.
[[22:40:03.063]] [LOG]    listening on *:8081
```

And once a client has connected...
```
[[22:40:07.181]] [LOG]    Client Y9cjJ0OmLieuBrTiAAAB connected from 192.168.1.100.
[[22:40:07.211]] [LOG]    Client Y9cjJ0OmLieuBrTiAAAB attempting to log in with session ID cd86d5ccfc26c60a42a204bb61f56824
[[22:40:07.212]] [LOG]    Client cd86d5ccfc26c60a42a204bb61f56824 not found in our poller yet, adding now...
[[22:40:07.215]] [LOG]    Spotify API call for cd86d5ccfc26c60a42a204bb61f56824: /v1/me
[[22:40:07.264]] [LOG]    Spotify API call for cd86d5ccfc26c60a42a204bb61f56824: /v1/me/player/currently-playing
[[22:40:07.374]] [LOG]    Spotify authenticated cd86d5ccfc26c60a42a204bb61f56824
[[22:40:07.378]] [LOG]    Spotify API call for cd86d5ccfc26c60a42a204bb61f56824: /v1/audio-analysis/39ILxwgD5t1TUEyuz9VxGN
[[22:40:07.908]] [LOG]    Spotify API call for cd86d5ccfc26c60a42a204bb61f56824: /v1/me/player/currently-playing
[[22:40:08.533]] [LOG]    Spotify API call for cd86d5ccfc26c60a42a204bb61f56824: /v1/me/player/currently-playing
[[22:40:09.126]] [LOG]    Spotify API call for cd86d5ccfc26c60a42a204bb61f56824: /v1/me/player/currently-playing
...
```

Stopping the application is as simple as pressing `ctrl+c` to quit it.

## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests as appropriate.

## License
This software is released under the [GNU General Public License v3.0](https://choosealicense.com/licenses/gpl-3.0/) license, to summarise though;

* You may use this however you see fit, providing you make your source code publicly accessible under this same license so others can learn and give back to the community
* I take no responsibility for any losses that you may incur directly or indirectly using this software, it is provided without warranty and "as-is"

One more note; despite my best intention to make this safe and reliable, do *not* trust my code (or anyone else's for that matter) without reviewing it first!

## Changelog

* May 25th, 2020 - v0.01 - Initial release