#!/usr/bin/env node

'use strict';

var masterPassword = "admin";
var panelPort = 9009;
var JJ2_PATH = '/home/daniel/code/nodejs/jj2ded/users/djazz/Jazz2+.exe';

// JJ2 port range: 10050-10059
var basePort = 10050;
var maxInstances = 10; // Because JJ2+ limit


process.stdout.write("Loading modules: http");var http = require('http');
process.stdout.write(", net");var net  = require('net');
process.stdout.write(", url");var url  = require('url');
process.stdout.write(", path");var path = require('path');
process.stdout.write(", fs");var fs   = require('fs');
process.stdout.write(", mime");var mime = require('mime');
process.stdout.write(", os");var os   = require('os');
process.stdout.write(", zlib");var zlib = require('zlib');
process.stdout.write(", child_process");var child_process = require('child_process');
process.stdout.write(", crypto");var crypto = require('crypto');
process.stdout.write(", ws");var WebSocketServer = require('ws').Server;
process.stdout.write(", formidable");var formidable = require('formidable');
process.stdout.write(", shared");var shared = require(path.join(__dirname, 'shared.js'));
process.stdout.write(", DONE!\n");

var openDb = shared.openDb;

var spawn = child_process.spawn;
var execFile = child_process.execFile;

var basepath = path.join(__dirname, 'static/');
var sockets = [];
var users = [];
var instances = {};
var checkporttimers = {};
var isRegLocked = false;
var forkMessageCounter = 0;
var forkCallbacks = {};
var validFilename = /[^a-zA-Z0-9_-]/g;

var myEnv = {
	DISPLAY: ':1', // Run on first display (in my case, a virtual 1x1 sized VNC server)
	WINEDEBUG: '-all', // Ignore all wine debug messages
	HOME: process.env.HOME // Required
};

// http://stackoverflow.com/questions/1584370/how-to-merge-two-arrays-in-javascript
Array.prototype.merge = function(/* variable number of arrays */){
	for(var i = 0; i < arguments.length; i++){
		var array = arguments[i];
		for(var j = 0; j < array.length; j++){
			if(this.indexOf(array[j]) === -1) {
				this.push(array[j]);
			}
		}
	}
	return this;
};

var fmFork = child_process.fork(path.join(__dirname, 'filemanager.js'));
fmFork.on('message', function (message) {
	var id = message.id;
	var data = message.data;

	forkCallbacks[id](data);
	delete forkCallbacks[id];
});

function sendToFork(data, cb) {
	fmFork.send({
		id: forkMessageCounter,
		data: data
	});
	forkCallbacks[forkMessageCounter] = cb;

	forkMessageCounter++;
}

function updateFileList(username, userid, filenames) {
	sendToFork({ list: filenames, username: username }, function (files) {
		var packet = JSON.stringify({ fs: {
			list: files
		} });
		for (var i = 0; i < users.length; i++) {
			if (users[i].userid === userid) {
				sockets[i].send(packet);
			}
		}
	});
		

}

function getFilesForDownload(list, username, respond) {
	var userpath = path.join(__dirname, "users/", username.replace(validFilename, ''));

	fs.readdir(userpath, function (err, filenames) {

		var info = {
			filename: 'files.zip',
			file: null,
			error: ''
		}

		if (err) {
			console.error('READDIR', err.code, err.path);
			info.error = 'Error reading directory '+(err.code);
			respond(info);
			return;
		}

		var files = [];

		for (var i = 0; i < list.length; i++) {
			var name = list[i];
			if (filenames.indexOf(name) !== -1) {
				var fullName = path.join(userpath, name);
				if (files.indexOf(fullName) === -1) {
					files.push(fullName);
				}
			} else {
				console.error('INVALID FILENAME', name);
				info.error = 'Invalid filename '+name;
				respond(info);
				return;
			}
		}

		if (files.length === 0) {
			console.error('NO FILES', list);
			info.error = 'Empty list of files';
			respond(info);
			return;
		}
		if (files.length === 1) { // Single file, no zip
			info.filename = path.basename(files[0]);
			fs.readFile(files[0], function (err, filedata) {
				if (err) {
					info.error = 'Error opening '+info.filename;
					respond(info);
				} else {
					info.file = filedata;
					respond(info);
				}
			});

		} else {
			var args = ['-j', '-'].concat(files);

			var zip = child_process.spawn('zip', args);

			var filedata = "";

			zip.stdout.on('data', function (d) {
				filedata += d.toString('binary');
			});
			
			zip.stdout.on('end', function () {
				info.file = new Buffer(filedata, 'binary');
				
				respond(info);
			});

		}


	});
}

var httpServer = http.createServer(function (req, res) {
	
	var uri = url.parse(req.url, true);
	
	var pathname = decodeURI(uri.pathname.replace(/\/\//g, "/"));
	var pathlist = pathname.substr(1).split("/");

	var specialCommand = true;
	var acceptEncoding = req.headers['accept-encoding'] || '';
	
	switch (pathlist[0]) {

		case 'fs':

			switch (pathlist[1]) {
				
				case 'download':
					
					if (req.method.toLowerCase() === 'post') {
						var form = new formidable.IncomingForm();
						form.parse(req, function(err, fields, files) {
							if (err) {
								res.writeHead(500, {'Content-Type': 'text/plain;charset=utf-8'});
								res.end('500 Internal server error, form parsing '+err);
								return;
							}
							if (fields.username && fields.password && fields.files) {

								var hasher = crypto.createHash('sha1');
								hasher.update(fields.password);
								var pswdHash = hasher.digest('hex');

								var db = openDb();
								db.get("SELECT userid, username FROM users WHERE username = ? COLLATE NOCASE AND pswd_hash = ?", [fields.username, pswdHash], function (err, result) {
									if (result !== undefined) {
										
										var username = result.username;
										var files = JSON.parse(fields.files);
										
										
										getFilesForDownload(files, username, function (info) {
											
											var file = info.file;
											var filename = info.filename.substr(0, 255);
											
											if (file) {

												var header = new Buffer(1+filename.length);
												header.writeUInt8(filename.length, 0);
												header.write(filename, 1, filename.length, 'binary');
												
												var output = Buffer.concat([header, file], header.length+file.length);
												res.writeHead(200, {'Content-Type': mime.lookup(filename), 'Content-Length': output.length});
												res.end(output);
												
												
												
											} else {
												res.writeHead(500, {'Content-Type': 'text/plain;charset=utf-8'});
												res.end('500 Internal server error.\n\n'+info.error);
											}
										});
										

									} else {
										res.writeHead(403, {'Content-Type': 'text/plain;charset=utf-8'});
										res.end('403 Forbidden, invalid login credentials');
									}
								});
								db.close();

							} else {
								res.writeHead(500, {'Content-Type': 'text/plain;charset=utf-8'});
								res.end('500 Internal server error, invalid parameters');
								return;
							}
						});
					} else {
						res.writeHead(500, {'Content-Type': 'text/plain;charset=utf-8'});
						res.end('500 Internal server error, invalid method "'+req.method+'"');
					}

					break;

				case 'upload':
					if (req.method.toLowerCase() === 'post') {
						var form = new formidable.IncomingForm();
						form.parse(req, function(err, fields, files) {
							if (err) {
								res.writeHead(500, {'Content-Type': 'text/plain;charset=utf-8'});
								res.end('500 Internal server error, form parsing '+err);
								return;
							}
							var fileList = [];
							for (var i in files) {
								fileList.push(files[i]);
							}

							if (fields.username && fields.password && fileList.length > 0) {

								var hasher = crypto.createHash('sha1');
								hasher.update(fields.password);
								var pswdHash = hasher.digest('hex');

								var db = openDb();
								db.get("SELECT userid, username FROM users WHERE username = ? COLLATE NOCASE AND pswd_hash = ?", [fields.username, pswdHash], function (err, result) {



									if (result !== undefined) {
										var username = result.username;
										var userpath = path.join(__dirname, "users/", username.replace(validFilename, ''));
										fs.readdir(userpath, function (err, filesBefore) {

											var done = 0;
											var total = 0;
											var uploadedFiles = [];
											var failedFiles = [];

											function checkDone() {
												if (done === total) {
													console.log('all done');
													console.log('added: ', uploadedFiles);
													console.log('failed: ', failedFiles);

													res.writeHead(200, {'Content-Type': 'text/plain;charset=utf-8'});
													res.end(JSON.stringify({added: uploadedFiles, failed: failedFiles}));

													fs.readdir(userpath, function (err, filesAfter) {
														
														var filenames = filesAfter.filter(function(i) {return !(filesBefore.indexOf(i) > -1);});

														filenames.merge(uploadedFiles);
														
														updateFileList(username, result.userid, filenames);
													});
													
												}
											}

											fileList.forEach(function (f, i) {
												total++;
												var newpath = path.join(userpath, f.name);
												var base = path.basename(newpath);
												if (newpath.indexOf(userpath) === 0) {
													var gotError = false;
													var from = fs.createReadStream(f.path);
													var to = fs.createWriteStream(newpath);

													from.pipe(to, { end: false });
													from.on('end', function () {

														console.log('finished '+newpath);
														uploadedFiles.push(base);
														fs.unlink(f.path, function (err) {
															if (gotError) return;
															done++;
															checkDone();
														});
													});

													from.on('error', function (err) {
														console.log('read stream error', err);
														if (gotError) return;
														gotError = true;
														done++;
														checkDone();
													});
													to.on('error', function (err) {
														console.log('write error');
														if (gotError) return;
														gotError = true;
														done++;
														checkDone();
													});
												} else {
													failedFiles.push(base);
													done++;
													checkDone();
													console.log('Invalid filename', userpath, newpath);
												}
											});
										});
									} else {
										res.writeHead(403, {'Content-Type': 'text/plain;charset=utf-8'});
										res.end('403 Forbidden, invalid login credentials');
									}
								});
								db.close();

							} else {
								res.writeHead(500, {'Content-Type': 'text/plain;charset=utf-8'});
								res.end('500 Internal server error, invalid parameters');
								return;
							}
						});
					} else {
						res.writeHead(500, {'Content-Type': 'text/plain;charset=utf-8'});
						res.end('500 Internal server error, invalid method "'+req.method+'"');
					}

					break;

				default:
					specialCommand = false;
					break;
			}

			break;

		default:
			specialCommand = false;
			break;

	}
	if (specialCommand) {
		return;
	}
	
	httpGetFile(pathname, req, res);
});
httpServer.listen(panelPort, function () {
	console.log("jj2ded admin panel on port "+panelPort);
});

function startServer(port) {
	stopServer(port); // Just in case

	var db = openDb();
	db.get("SELECT *, (SELECT username FROM users WHERE userid = servers.userid) as username FROM servers WHERE port = ?", [port], function (err, result) {

		stopServer(port);
		var settings = result.settings.split('|');

		function launch() {
			var args = [
				'-windowed', '-nolog', '-nospy', '-nosound', '-noddraw', '-noddrawmemcheck', '-nojoy', '-noerrtrap', '-nocpucheck', '-server', '-maxplayers', result.maxplayers, '-counts', result.maxscore, '-'+result.gamemode,
				'-minimize', '-settings=settings-'+settings[0]+'.ini', '-admin=admin-'+settings[1]+'.ini', '-levellistfile=levellist-'+settings[2]+'.ini', '-port='+port, '-levellist', 1
			];

			if (result.listed > 0) {
				args.push('-list');
			}

			var opts = {
				cwd: path.dirname(JJ2_PATH),
				env: myEnv
			};
			
			var jj2 = execFile(JJ2_PATH, args, opts, function (err, stdout, stderr) {
				console.log('JJ2 on port '+port+' closed', pid+(err? ' '+err.toString()+' '+err.signal: ''));
				
				setTimeout(function () {
					if (instances[port] === jj2) {
						startServer(port);
					}
				}, 30*1000);
				
				
				
				
			});
			var pid = jj2.pid;
			console.log('JJ2 on port '+port+' started', pid);

			stopServer(port);

			instances[port] = jj2;
		}


		if (err || !result || !result.active) {
			//console.log('dont exists/inactive');
			stopServer(port);
			return;
		}

		var server = net.createServer();
		server.listen(port, function () {
			console.log(port, 'OK');
			server.close();

			if (isRegLocked) {
				console.log(port, 'Registry is locked, waiting...');
				setTimeout(function () {
					startServer(port);
				}, 1000);
				return;
			}

			isRegLocked = true;
			var tmpRegFilename = path.join(os.tmpDir(), 'jj2ded-dynamic.reg');
			fs.writeFile(tmpRegFilename, 'REGEDIT4\n\n[HKEY_CURRENT_USER\\Software\\Epic MegaGames\\Jazz Jackrabbit 2 Special Edition\\1.24\\Game]\n"NetServerName"="'+result.servername.replace(/\\/g, '\\\\').replace(/\"/g, '\\"')+'"\n', function (err) {
				if (err) {
					console.log(port, err.toString());
				} else {
					console.log('spawning regedit...');
					var reg = spawn('regedit', ['/S', tmpRegFilename], function (err, stdout, stderr) {
						
					});
					reg.on('exit', function () {
						launch();
						fs.unlink(tmpRegFilename, function (err) {
							if (err) {
								console.error('UNLINK REG', err);
							} else {
								console.log('unlinked', tmpRegFilename);
							}

							isRegLocked = false;
						});
					});
				}
				
			});
			clearTimeout(checkporttimers[port]);
			delete checkporttimers[port];
		});

		server.on('error', function (err) {
			console.log(port, err.toString());

			clearTimeout(checkporttimers[port]);
			checkporttimers[port] = setTimeout(function () {
				if (!instances[port]) {
					startServer(port);
				}
			}, 5000);
		});


		
	});
}
function stopServer(port) {
	if (instances[port] !== undefined) {
		var server = instances[port];
		server.kill && server.kill();
		delete instances[port];

		clearTimeout(checkporttimers[port]);
		delete checkporttimers[port];
	}
}

function getServersForUser(userid, cb) {
	var isAdmin = userid === 0;
	var db = openDb();
	db.all("SELECT *, (SELECT username FROM users WHERE userid = servers.userid) as username FROM servers"+(isAdmin?"":" WHERE userid = ?")+" ORDER BY port", isAdmin? [] : [userid], function (err, rows) {
		cb(rows);
	});
	db.close();
}

function broadcast(text) {
	for (var i = 0; i < sockets.length; i++) {
		if (sockets[i].readyState === 1) {
			sockets[i].send(text);
		}
	}
}

(function () {
	var db = openDb();
	db.all("SELECT port FROM servers ORDER BY port", function (err, rows) {
		for (var i = 0; i < rows.length; i++) {
			startServer(rows[i].port);
		}
	});
	db.close();
}());

var wss = new WebSocketServer({
	server: httpServer
});

wss.on('connection', function (ws) {
	//console.log(ws.upgradeReq.url);
	var query = url.parse(ws.upgradeReq.url, true).query;

	if (ws.protocol !== 'jj2ded') {
		ws.close();
	} else if (query.username.toLowerCase() === 'admin' && masterPassword === query.password) {
		wsOK(ws, 'admin', 0);
	} else if (query.username.toLowerCase() !== 'admin') {
		var hasher = crypto.createHash('sha1');
		hasher.update(query.password);
		var pswdHash = hasher.digest('hex');
		var db = openDb();
		db.get("SELECT userid, username FROM users WHERE username = ? COLLATE NOCASE AND pswd_hash = ?", [query.username, pswdHash], function (err, result) {
			if (result !== undefined) {
				wsOK(ws, result.username, result.userid);
			} else {
				ws.close();
			}
		});
		db.close();
	} else {
		ws.close();
	}

});
function wsOK(ws, username, userid) {
	var isAdmin = username === 'admin';
	var remoteAddress = ws._socket.remoteAddress;
	console.log(username+" joined");

	var user = {
		username: username,
		userid: userid
	}

	sockets.push(ws);
	users.push(user);

	getServersForUser(userid, function (servers) {
		for (var i = 0; i < servers.length; i++) {
			delete servers[i].userid;
			servers[i].listed = !!servers[i].listed;
			servers[i].settings = servers[i].settings.split("|");
		}
		
		ws.send(JSON.stringify({
			username: username,
			servers: servers,
			basePort: basePort,
			maxInstances: maxInstances
		}));
	});
	
	if (!isAdmin) {
		sendToFork({ list: true, username: username }, function (files) {
			ws.send(JSON.stringify({ fs: {
				list: files
			} }));
		});
	}

	ws.on('message', function (message, flags) {
		var data = JSON.parse(message);
		if (data.add !== undefined) {
			if (data.add.port < basePort || data.add.port >= basePort+maxInstances) {
				ws.send(JSON.stringify({
					alert: "Port out of range"
				}));

			} else {
				var port = +data.add.port;
				var servername = data.add.servername.substring(0, 31);
				var gamemode = data.add.gamemode.toUpperCase();
				var maxscore = Math.min(Math.max(+data.add.maxscore || 10, 1), 255);
				var maxplayers = Math.min(Math.max(+data.add.maxplayers || 10, 1), 32);
				var listed = data.add.listed === true;
				var active = data.add.active === true;
				var settings = data.add.settings;

				// Fixin' up
				for (var i = 0; i < settings.length; i++) {
					settings[i] = settings[i].trim().replace(validFilename, '');
				}

				var newData = {
					port: port,
					servername: servername,
					gamemode: gamemode,
					maxscore: maxscore,
					maxplayers: maxplayers,
					listed: listed,
					active: active,
					settings: settings
				};

				var db = openDb();
				db.get("SELECT userid, (SELECT username FROM users WHERE userid = servers.userid) as username FROM servers WHERE port = ?", [port], function (err, result) {
					if (result === undefined && userid !== 0) {
						// Don't exist, create new
						var db = openDb();
						db.run("INSERT INTO servers (userid, port, servername, gamemode, maxscore, maxplayers, listed, active, settings) VALUES(?,?,?,?,?,?,?,?,?)", [userid, port, servername, gamemode, maxscore, maxplayers, listed?1:0, active?1:0, settings.join("|")], function (err) {
							if (err) {
								ws.send(JSON.stringify({
									alert: "Unable to insert into database: "+err
								}));
							} else {

								if (active) {
									startServer(port);
								}

								newData.username = username;
								var addPacket = JSON.stringify({
									add: newData
								});
								for (var i = 0; i < users.length; i++) {
									if (users[i].userid === userid || users[i].userid === 0) {
										sockets[i].send(addPacket);
									}
								}
							}
						});
						db.close();

					} else if (result !== undefined && (result.userid === userid || userid === 0)) {
						// Update existing
						var db = openDb();
						db.run("UPDATE servers SET servername=?, gamemode=?, maxscore=?, maxplayers=?, listed=?, active=?, settings=? WHERE userid = ? AND port = ?", [servername, gamemode, maxscore, maxplayers, listed?1:0, active?1:0, settings.join("|"), result.userid, port], function (err) {
							if (err) {
								ws.send(JSON.stringify({
									alert: "Unable to update database, someone else own that port or servername is taken?"
								}));
							} else {

								if (active) {
									startServer(port);
								} else {
									stopServer(port);
								}

								newData.username = result.username;
								var updatePacket = JSON.stringify({
									update: newData
								});
								for (var i = 0; i < users.length; i++) {
									if (users[i].userid === result.userid || users[i].userid === 0) {
										sockets[i].send(updatePacket);
									}
								}
							}
						});
						db.close();

					} else {
						ws.send(JSON.stringify({
							alert: "You are not allowed to do that"
						}));
					}

				});
				db.close();
			}
		} else if (data.remove !== undefined) {
			if (data.remove < basePort || data.remove >= basePort+maxInstances) {
				ws.send(JSON.stringify({
					alert: "Port out of range"
				}));
			} else {
				var port = +data.remove;
				var db = openDb();
				db.get("SELECT userid FROM servers WHERE port = ?", [port], function (err, result) {
					if (result !== undefined && (result.userid === userid || userid === 0)) {

						var db = openDb();
						db.run("DELETE FROM servers WHERE port = ?", [port], function (err) {
							if (err) {
								ws.send(JSON.stringify({
									alert: "Error removing server"
								}));
							} else {

								stopServer(port);

								var removePacket = JSON.stringify({
									remove: port
								});
								for (var i = 0; i < users.length; i++) {
									if (users[i].userid === result.userid || users[i].userid === 0) {
										sockets[i].send(removePacket);
									}
								}
							}
						});
						db.close();

					} else {
						ws.send(JSON.stringify({
							alert: "You are not allowed to do that"
						}));
					}
				});
				db.close();

			}
		}
	});

	ws.on('close', function (reasonCode, reasonText) {
		console.log(username+" left");
		var index = sockets.indexOf(ws);

		sockets.splice(index, 1);
		users.splice(index, 1);
	});

	ws.on('error', function (err) {
		console.log(username+" got error: ", err);
	});
}

/*var args = [
	'-windowed', '-nospy', '-nosound', '-noddraw', '-noddrawmemcheck', '-nojoy', '-noerrtrap', '-nocpucheck', '-server', '-maxplayers', maxPlayers, '-counts', maxScore, '-'+gamemode,
	'-menu', '-minimize','-settings=settings-'+username+'.ini', '-admin=admin-'+username+'.ini', '-levellistfile=levellist-'+username+'.ini', '-port='+serverPort, '-levellist', 1
];

if (false) {
	args.push('-list');
}

var jj2 = execFile(JJ2_PATH, args, function (err, stdout, stderr) {
	console.log(err);
});
console.log(jj2.pid);

jj2.stdout.on('data', function (data) {
	
});
jj2.on('close', function (code, signal) {
	console.log('close', arguments);
})
jj2.on('exit', function (code, signal) {
	console.log('exit', arguments);
});
jj2.on('disconnect', function () {
	console.log('disconnected');
});

setTimeout(function () {
	//jj2.kill();
}, 5000);*/





function getRelativePath(filepath) {
	return path.join(__dirname, filepath)
}

function notFound(res) {
	res.writeHead(404, {'Content-Type': 'text/plain;charset=utf-8'});
	res.end('404 Not found');
}

function getServerInfo () {
	return "Raspberry Pi - "+os.type()+" "+os.release()+" "+os.arch().toUpperCase()+" - Node.JS "+process.version+", "+Math.floor(process.memoryUsage().rss/1024/1024)+" MB RAM used - "+Math.floor(os.uptime()/(60*60*24))+" day(s) device uptime";
}

function httpGetFile(reqpath, req, res, skipCache) {

	var dirname = path.join(basepath, reqpath);

	if (dirname.indexOf(basepath) !== 0) {
		res.writeHead(400, {'Content-Type': 'text/plain;charset=utf-8'});
		res.end('400 Bad request');
		return;
	}

	var pathname = reqpath;

	if (reqpath.substr(-1) === "/") {
		pathname += "index.html";
		skipCache = true;
	}

	var filename = path.join(__dirname, 'static/', pathname);


	fs.stat(filename, function (err, stats) {
		
		if (err) {
			if (reqpath.substr(-1) === "/") {

				fs.readdir(dirname, function (err, files) {
					
					if (err) {
						res.writeHead(403, {'Content-Type': 'text/html;charset=utf-8'});
						res.end('<pre>403 Not allowed to read directory contents\n<strong>'+reqpath+'</strong><hr>'+getServerInfo()+'</pre>');
						return;
					}
					res.writeHead(200, {'Content-Type': 'text/html;charset=utf-8'});
					res.write("<code>Listing directory <strong>"+reqpath+"</strong><br/><br/>\n\n");
					for (var i = 0; i < files.length; i++) {
						res.write("<a href=\""+files[i]+"\">"+files[i]+"</a><br/>\n")
					}
					res.write("<hr>");
					res.write(getServerInfo());
					res.end("</code>");
				});

			} else {
				res.writeHead(404, {'Content-Type': 'text/html;charset=utf-8'});
				res.end('<pre>404 Not found\n<strong>'+reqpath+'</strong><hr>'+getServerInfo()+'</pre>');
			}
			
			return;
		} else {
			
		}

		if (reqpath.substr(-1) !== "/" && stats.isDirectory()) {
			res.writeHead(302, {'Content-Type': 'text/plain;charset=utf-8', 'Location': reqpath+'/'});
			res.end('302 Redirection');
			return;
		}
		
		var isCached = false;

		if (req.headers['if-modified-since'] && !skipCache) {
			var req_date = new Date(req.headers['if-modified-since']);
			if (stats.mtime <= req_date && req_date <= Date.now()) {
				res.writeHead(304, {
					'Last-Modified': stats.mtime
				});
				res.end();
				isCached = true;
			}
		}
		if (!isCached) {
			
			var type = mime.lookup(filename);

			var headers = {
				'Content-Type': type+';charset=utf-8'
			};
			if (!skipCache) {
				headers['Last-Modified'] = stats.mtime;
			}

			var stream = fs.createReadStream(filename);
			var acceptEncoding = req.headers['accept-encoding'] || '';

			fs.readFile(filename, function (err, data) {

				function sendBody (buf) {
					headers['Content-Length'] = buf.length;
					res.writeHead(200, headers);
					res.end(buf);
				}

				if (err) {
					if (reqpath.substr(-1) !== "/") {
						res.writeHead(404, {'Content-Type': 'text/html;charset=utf-8'});
						res.end('<pre>404 Not found\n<strong>'+reqpath+'</strong>\n\nThis should not happen (dir).</pre>');
					} else {
						res.writeHead(404, {'Content-Type': 'text/html;charset=utf-8'});
						res.end('<pre>404 Not found\n<strong>'+reqpath+'</strong>\n\nThis should not happen (file).</pre>');
					}
					
				} else {
					if (acceptEncoding.match(/\bdeflate\b/)) {
						zlib.deflate(data, function (err, cdata) {
							if (err) {
								sendBody(data);
							} else {
								headers['Content-Encoding'] =  'deflate';
								sendBody(cdata);
							}
						});
					} else if (acceptEncoding.match(/\bgzip\b/)) {
						zlib.gzip(data, function (err, cdata) {
							if (err) {
								sendBody(data);
							} else {
								headers['Content-Encoding'] =  'gzip';
								sendBody(cdata);
							}
						});
					} else {
						sendBody(data);
					}
				}
			});
		}
	});
}