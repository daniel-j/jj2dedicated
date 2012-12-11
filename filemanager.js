'use strict';
var fs = require('fs');
var path = require('path');
var WebSocketServer = require('ws').Server;
var sqlite3 = require('sqlite3').verbose();
var zlib = require('zlib');
var child_process = require('child_process');
var shared = require(path.join(__dirname, 'shared'));

var openDb = shared.openDb;

var validFilename = /[^a-zA-Z0-9_-]/g;
var parseTheseExtensions = ['j2l', 'j2t'];
var ignoreTheseExtensions = [];

function trimNull(str) {
	var pos = str.indexOf("\0");
	if (pos !== -1) {
		str = str.substring(0, pos).trim();
	}
	return str;
}



process.on('message', function (message) {
	console.log('FORK MESSAGE', message);
	var data = message.data;

	function respond(d) {
		var res = {
			id: message.id,
			data: d
		};
		process.send(res);
	}

	function handleFiles(filenames) {
		

		var waitlist = [];
		var failed = [];
		var files = [];
		var doneList = [];
		var filesDone = 0;
		var filesTotal = 0;
		var filenamesLower = [];

		// *le me handling async callbacks like a boss

		function fileDone(index, error, progress) {
			
			if (error) {
				for (var i = progress; i < waitlist[index].length; i++) {
					failed[index][i] = true;
					waitlist[index][i] = true;
				}
			}
			
			waitlist[index][progress] = true;

			var stepsDone = 0;
			var stepsTotal = 0;

			if (!doneList[index]) {
				
				for (var i = 0; i < waitlist[index].length; i++) {
					stepsTotal++;
					if (waitlist[index][i]) {
						stepsDone++;
					}
				}

				if (stepsDone === stepsTotal) {
					doneList[index] = true;
					filesDone++;
					//console.log('DONE', files[index].filename, filesDone, filesTotal);
					if (filesDone === filesTotal) {

						//console.log(filenamesLower);
						respond(files);
					}
				} else {
					//console.log(files[index].filename, waitlist[index], failed[index]);
				}
			}
		}
		


		

		filenames = filenames.filter(function (name) {
			var ext = path.extname(name).substr(1).toLowerCase();

			return ignoreTheseExtensions.indexOf(ext) === -1;
		});

		


		if (filenames.length === 0) {

			respond(files);

		} else {

			filenames.sort(shared.alphaSort);

			filenames.forEach(function (filename, index) {
				filesTotal++;
				filenamesLower[index] = filename.toLowerCase();

				var ext = path.extname(filename).substr(1).toLowerCase();
				var isSpecialFile = parseTheseExtensions.indexOf(ext) !== -1;
				var isJ2L = ext === 'j2l';

				files[index] = {
					filename: filename,
					ext: ext
				};
				waitlist[index] = [false, !isSpecialFile, !isSpecialFile, !isJ2L, !isJ2L, !isSpecialFile];
				failed[index] = [false, false, false, false, false];
				doneList[index] = false;

				var filepath = path.join(userpath, filename);
				fs.stat(filepath, function (err, stats) {
					if (err || !stats.isFile()) {
						console.error('STATS', err);
						fileDone(index, true, 0);
						return;
					}
					files[index].stats = {
						mtime: stats.mtime,
						size: stats.size
					};
					fileDone(index, false, 0);

					if (isSpecialFile) {
						fs.open(filepath, 'r', function (err, fd) {
							if (err) {
								console.error('OPEN', err);
								fileDone(index, true, 1);
								return;
							}
							fileDone(index, false, 1);
							if (252 > stats.size) {
								console.error('READ HEADER', 'OUT OF BOUNDS');
								fileDone(index, true, 2);
								return;
							}
							fs.read(fd, new Buffer(252), 0, 252, 0, function (err, bytesRead, buffer) {
								if (err || bytesRead !== 252) {
									console.error('READ HEADER', err);
									fileDone(index, true, 2);
									return;
								}
								

								var title = trimNull(buffer.slice(188, 188+32).toString('binary'));
								var version = buffer.readUInt16LE(220, true);
								var size = buffer.readUInt16LE(220, true);
								files[index].title = title;
								files[index].version = version;

								fileDone(index, false, 2);
								
								if (ext === 'j2l') {
									var streamCSize = buffer.readUInt32LE(230, true);
									var streamUSize = buffer.readUInt32LE(234, true);
									if (streamCSize + 252 > stats.size) {
										console.error('READ STREAM', 'OUT OF BOUNDS');
										fileDone(index, true, 3);
										return;
									}
									fs.read(fd, new Buffer(streamCSize), 0, streamCSize, 262, function (err, bytesRead, buffer) {
										if (err || bytesRead < streamCSize) {
											console.error('READ STREAM', err);
											fileDone(index, true, 3);
											return;
										}
										fileDone(index, false, 3);

										zlib.inflate(buffer, function (err, uncompressedData) {
											if (err || uncompressedData.length < streamUSize) {
												console.error('ZLIB INFLATE', err);
												fileDone(index, true, 4);
												return;
											}

											var info = [];

											for (var i = 0; i < 6; i++) {
												info.push(trimNull(uncompressedData.slice(19+i*32, 19+i*32+32).toString('binary')));
											}
											files[index].info = info;
											fileDone(index, false, 4);
										});

										fs.close(fd, function (err) {
											if (err) {
												console.error('CLOSE J2L', err);
												fileDone(index, true, 5);
												return;
											}
											fileDone(index, false, 5);
										});

									});
								} else {
									fs.close(fd, function (err) {
										if (err) {
											console.error('CLOSE J2T', err);
											fileDone(index, true, 5);
											return;
										}
										fileDone(index, false, 5);
									});
								}

							});
						});
					}

				});
				
				

			});
		}
	}

	if (data.list !== undefined) {
		var userpath = path.join(__dirname, "users/", data.username.replace(validFilename, ''));
		if (data.list === true) {
			fs.readdir(userpath, function (err, filenames) {
				if (err) {
					console.error('READDIR', err.code, err.path);
					respond([]);
					return;
				}
				handleFiles(filenames);
			});
		} else {
			handleFiles(data.list);
		}
	}
	

	
});