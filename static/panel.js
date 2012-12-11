
(function () {
	'use strict';

	function xhr(path, data, cb, pcb, ecb) {
		var x = new XMLHttpRequest();
		if (data) {
			var fd = new FormData();
			for (var i in data) {
				fd.append(i, data[i]);
			}
		}
		x.open('post', path, true);
		x.responseType = 'arraybuffer';
		x.onload = function () {
			cb(x.response);
		}
		x.onprogress = pcb;
		x.onerror = ecb;
		if (data) {
			x.send(fd);
		}
		
		return x;
	}

	function alphaSortFiles(a, b) {
		var a2 = a.filename.toLowerCase();
		var b2 = b.filename.toLowerCase();

		if (a2 === b2) {
			if (a > b) {
				a2 = a.filename;
				b2 = b.filename;
			} else {
				a2 = b.filename;
				b2 = a.filename;
			}
			
		}

		if (a2 < b2) return -1;
		else if (a2 > b2) return 1;
		else return 0;
	}

	function socketOpen() {
		console.log('socket open');
		clearTimeout(wsTimer);
	}
	function socketMessage(e) {
		var data = JSON.parse(e.data);
		if (data.alert !== undefined) {
			alert(data.alert);
		}
		if (data.username !== undefined) {
			username = data.username;
			isConnected = true;
			pagewrapper.classList.add('connected');
			console.log('logged in as', username);
			loginPassword.value = loginPassword.defaultValue;

			filelist = [];
			filenamesLower = [];
			while (filelisttable.rows.length > 0) {
				filelisttable.deleteRow(0);
			}

		}
		if (data.basePort !== undefined && data.maxInstances !== undefined) {
			var lastPort = +selectPort.value;
			while (selectPort.length > 0) {
				selectPort.remove(0);
			}
			for (var i = data.basePort; i < data.basePort + data.maxInstances; i++) {
				var opt = new Option(i, i);
				if (i === lastPort) {
					opt.selected = true;
				}
				selectPort.add(opt);
			}
		}
		if (data.servers !== undefined) {
			serverlist = [];
			while (servertable.rows.length > 0) {
				servertable.deleteRow(0);
			}
			for (var i = 0; i < data.servers.length; i++) {
				var s = data.servers[i];
				addServerRow(s, false);

				serverlist.push(s);
			}
		}
		if (data.add !== undefined || data.update !== undefined) {
			var newServer = data.add || data.update;

			var exists = false;

			if (data.update !== undefined) {
				for (var i = 0; i < serverlist.length && !exists; i++) {
					var s = serverlist[i];
					if (s.port === newServer.port) { // Modify existing server
						var row = s.row;
						var cells = row.cells;

						s.servername = newServer.servername;
						s.port = newServer.port;
						s.gamemode = newServer.gamemode;
						s.maxscore = newServer.maxscore;
						s.maxplayers = newServer.maxplayers;
						s.listed = newServer.listed;
						s.active = newServer.active;
						s.username = newServer.username;
						s.settings = newServer.settings;

						cells[0].textContent = s.servername;
						cells[1].textContent = s.port;
						cells[2].textContent = s.gamemode;
						cells[3].textContent = s.maxscore;
						cells[4].textContent = s.maxplayers;
						cells[5].textContent = s.listed? "yes" : "no";
						cells[6].textContent = s.settings.join(', ');
						cells[7].textContent = s.username;

						if (s.active) {
							s.row.classList.add('active');
						} else {
							s.row.classList.remove('active');
						}

						if (s.listed) {
							s.row.classList.add('listed');
						} else {
							s.row.classList.remove('listed');
						}
						

						exists = true;
						editServer(s)();
					}
				}
			}
			if (data.add !== undefined || !exists) { // Add new server to table
				
				addServerRow(newServer, true);

				serverlist.push(newServer);

				editServer(newServer)();

			}

		}
		if (data.remove !== undefined) {
			var port = data.remove;
			for (var i = 0; i < serverlist.length; i++) {
				var s = serverlist[i];
				if (s.port === port) {
					servertable.deleteRow(s.row.rowIndex-1);
					console.log(s.row, s.row.rowIndex);
					serverlist.splice(i, 1);
					break;
				}
			}
		}

		if (data.fs !== undefined) {

			if (data.fs.list !== undefined) {
				
				filelistlocked = true;
				
				var st = Date.now();

				var addChunks = [];
				var newFiles = [];

				data.fs.list.forEach(function (f, i) {

					// Replace existing files
					if (filenamesList.indexOf(f.filename) !== -1) {
						removeFileFromList(filelist[filenamesList.indexOf(f.filename)]);
					}
					filelist.push(f);
					newFiles.push(newFiles);

					if (f.stats !== undefined) {
						f.stats.mtime = new Date(f.stats.mtime);
					}
					
					var chunkId = Math.floor(i/25);
					if (!addChunks[chunkId]) addChunks[chunkId] = [];
					addChunks[chunkId].push(f);

				});

				filelist.sort(alphaSortFiles);
				filenamesLower = [];
				filenamesList = [];
				for (var i = 0; i < filelist.length; i++) {
					filenamesList.push(filelist[i].filename);
					filenamesLower.push(filelist[i].filename.toLowerCase());
				}

				addChunks.forEach(function (chunk, i) {
					setTimeout(function () {
						var frag = document.createDocumentFragment();
						for (var j = 0; j < chunk.length; j++) {
							var f = chunk[j];
							var index = filelist.indexOf(f);
							addFile(f);
							
							if (filelist[index+1] && filelist[index+1].row && filelist[index+1].row.parentNode) {
								filelist[index+1].row.parentNode.insertBefore(f.row, filelist[index+1].row);
							} else {
								frag.appendChild(f.row);
								//console.log('append');
							}
							updateFileWarnings(f);
						}
						filelisttable.appendChild(frag);
						//console.log(Date.now() - st, i);
						if (i === addChunks.length-1) {
							filelistlocked = false;
						}
					}, i*70);
				});
				
			}

		}

		console.log(data);

	}
	function socketClose(e) {
		clearTimeout(wsTimer);
		ws.onopen    = null;
		ws.onmessage = null;
		ws.onclose   = null;
		ws.onerror   = null;
		ws = null;
		
		wsTimer = setTimeout(socketReconnect, 5000);
		if (isConnected) {
			isConnected = false;
			pagewrapper.classList.remove('connected');
			console.log('logged out');
		}
		
		//console.log(e.reason, e.code);
	}
	function socketError(e) {
		console.log(e);
	}

	function socketReconnect() {
		if (ws || (username === "" && password === "")) {
			return;
		}
		clearTimeout(wsTimer);
		ws = new WebSocket('ws://'+document.location.host+'/?username='+encodeURIComponent(username)+'&password='+encodeURIComponent(password), 'jj2ded');
		ws.onopen    = socketOpen;
		ws.onmessage = socketMessage;
		ws.onclose   = socketClose;
		ws.onerror   = socketError;
	}

	function sendToServer(obj) {
		if (ws && ws.readyState === 1) {
			ws.send(JSON.stringify(obj));
		} else {
			alert("Couldn't send, not connected!\n\n"+JSON.stringify(obj));
		}
	}

	function addServerRow(s, insertSorted) {
		var rowPos = -1;
		if (insertSorted) {
			for (var i = 0; i < serverlist.length; i++) {
				if (serverlist[i].port > s.port) {
					rowPos = serverlist[i].row.rowIndex-1;
					break;
				}
			}
		}
		var row = servertable.insertRow(rowPos);
		for (var j = 0; j < 10; j++) {
			row.insertCell(-1);
		}
		var cells = row.cells;
		cells[0].textContent = s.servername;
		cells[1].textContent = s.port;
		cells[2].textContent = s.gamemode;
		cells[3].textContent = s.maxscore;
		cells[4].textContent = s.maxplayers;
		cells[5].textContent = s.listed? "yes" : "no";
		cells[6].textContent = s.settings.join(', ');
		cells[7].textContent = s.username;

		if (s.active) {
			row.classList.add('active');
		} else {
			row.classList.remove('active');
		}

		if (s.listed) {
			row.classList.add('listed');
		} else {
			row.classList.remove('listed');
		}

		var editButton = document.createElement('button');
		editButton.type = 'button';
		editButton.addEventListener('click', editServer(s), false);
		editButton.textContent = 'Edit';
		cells[8].appendChild(editButton);

		var deleteButton = document.createElement('button');
		deleteButton.type = 'button';
		deleteButton.addEventListener('click', removeServer(s), false);
		deleteButton.textContent = "Remove";
		cells[9].appendChild(deleteButton);

		s.row = row;
	}
	function editServer(s) {
		return function () {
			inputServername.value = s.servername;
			selectPort.value = s.port;
			selectGamemode.value = s.gamemode;
			inputMaxscore.value = s.maxscore;
			inputMaxPlayers = s.maxplayers;
			checkboxListed.checked = s.listed;
			checkboxActive.checked = s.active;
			inputPlusSettings.value = s.settings[0];
			inputPlusAdmin.value = s.settings[1];
			inputPlusLevelList.value = s.settings[2];
		}
	}
	function removeServer(s) {
		return function () {
			if (confirm("Do you really want to remove server "+s.servername+" on port "+s.port+"?")) {
				sendToServer({
					remove: s.port
				});
			}
		}
	}


	function addFile(f) {
		/*var rowPos = -1;
		if (insertSorted) {
			for (var i = 0; i < filelist.length; i++) {
				if (filelist[i].filename.toLowerCase() > f.filename.toLowerCase()) {
					rowPos = filelist[i].row.rowIndex-1;
					break;
				}
			}
		}*/
		//var row = filelisttable.insertRow(rowPos);
		var row = document.createElement('tr');
		for (var j = 0; j < 10; j++) {
			row.insertCell(-1);
		}
		var cells = row.cells;

		cells[1].textContent = f.filename;
		if (f.title !== undefined) {
			cells[2].textContent = f.title;
			if (f.info !== undefined) {
				cells[3].textContent = f.info[1]; // Tileset
				cells[4].textContent = f.info[5]; // Music
				cells[5].textContent = f.info[3]; // Next level
				cells[6].textContent = f.info[2]; // Bonus level
				cells[7].textContent = f.info[4]; // Secret level
			}
		}
		if (f.stats !== undefined) {
			cells[8].textContent = Math.ceil((f.stats.size/1024)*10)/10+' kb';
			cells[9].textContent = f.stats.mtime;
		}

		if ((f.ext === 'j2l' && f.version !== 0x202) || (f.ext === 'j2t' && f.version !== 0x200)) {
			row.classList.add('tsf');
		}

		var selectedBox = document.createElement('input');
		selectedBox.type = 'checkbox';
		cells[0].appendChild(selectedBox);
		selectedBox.addEventListener('change', function () {
			if (selectedBox.checked) {
				row.classList.add('selected');
			} else {
				row.classList.remove('selected');
			}
		}, false);

		f.selectedBox = selectedBox;
		f.row = row;
	}

	function downloadSelectedFiles() {
		if (filelistlocked) return;

		var files = [];
		for (var i = 0; i < filelist.length; i++) {
			if (filelist[i].selectedBox.checked) {
				files.push(filelist[i].filename);
			}
		}
		if (files.length > 0) {
			btnFileListDownload.disabled = true;
			downloadmeter.classList.add('visible');
			var x = xhr('/fs/download', {username: username, password: password, files: JSON.stringify(files)}, function (data) {
				console.log('loaded', data);
				var u8 = new Uint8Array(data);
				var filenameLength = u8[0];
				var filename = String.fromCharCode.apply(null, u8.subarray(1, 1+filenameLength));
				var blob = new Blob([u8.subarray(1+filenameLength)], {type: x.getResponseHeader('content-type')});
				saveAs(blob, filename);

				setTimeout(function () {
					downloadmeter.value = 0;
					btnFileListDownload.disabled = false;
					downloadmeter.classList.remove('visible');
				}, 500);
			}, function (e) {
				downloadmeter.value = e.loaded/e.total;
			}, function () {
				console.error('download error', arguments, x.responseText);
			});
		} else {
			alert("No files selected");
		}
	}

	function deleteFiles() {
		return function () {
			if (filelistlocked) return;
			var files = [];
			for (var i = 0; i < filelist.length; i++) {
				var f = filelist[i];
				if (f.selectedBox.checked) {
					files.push(f.filename);
				}
			}
			if (files.length > 0) {
				if (confirm("Do you really want to delete "+files.length+" file"+(files.length === 1?'':'s')+"?")) {
					sendToServer({
						fs: {
							delete: files
						}
					});
				}
			}
		}
	}
	function removeFileFromList(f) {
		var index = filelist.indexOf(f);
		f.row.parentNode.removeChild(f.row);
		filelist.splice(index, 1);
	}

	function updateFileWarnings(f) {
		if (f.info !== undefined) {
			var row = f.row;

			var tilesetPos = filenamesLower.indexOf(f.info[1].toLowerCase());

			if (tilesetPos === -1) row.classList.add('no-tileset'); else row.classList.remove('no-tileset');
			if (f.info[2] && !(filenamesLower.indexOf(f.info[2].toLowerCase()) !== -1 || filenamesLower.indexOf(f.info[2].toLowerCase()+'.j2l') !== -1)) row.classList.add('no-bonus'); else row.classList.remove('no-bonus');
			if (f.info[3] && !(filenamesLower.indexOf(f.info[3].toLowerCase()) !== -1 || filenamesLower.indexOf(f.info[3].toLowerCase()+'.j2l') !== -1)) row.classList.add('no-next'); else row.classList.remove('no-next');
			if (f.info[4] && !(filenamesLower.indexOf(f.info[4].toLowerCase()) !== -1 || filenamesLower.indexOf(f.info[4].toLowerCase()+'.j2l') !== -1)) row.classList.add('no-secret'); else row.classList.remove('no-secret');
			if (f.info[5] && !(filenamesLower.indexOf(f.info[5].toLowerCase()) !== -1 || filenamesLower.indexOf(f.info[5].toLowerCase()+'.j2b') !== -1)) row.classList.add('no-music');  else row.classList.remove('no-music');

			// Check tileset version

			if (tilesetPos !== -1 && (f.ext === 'j2l' && f.version !== 0x202) || (f.ext === 'j2t' && f.version !== 0x200)) row.classList.add('tsf-tileset'); else row.classList.remove('tsf-tileset');

		}
	}

	var ws = null;
	var wsTimer = null;
	var username = "";
	var password = "";
	var isConnected = false;
	var pagewrapper = document.querySelector('#pagewrapper');
	var loginForm = document.querySelector('#loginForm');
	var loginUsername = loginForm.querySelector('input[name="username"]');
	var loginPassword = loginForm.querySelector('input[name="password"]');
	var logoutBtn = document.querySelector('#logoutBtn');

	var addServerForm = document.querySelector('#addServerForm');
	var inputServername = addServerForm.querySelector('[name="servername"]');
	var selectPort = addServerForm.querySelector('[name="port"]');
	var selectGamemode = addServerForm.querySelector('[name="gamemode"]');
	var inputMaxscore = addServerForm.querySelector('[name="maxscore"]');
	var inputMaxPlayers = addServerForm.querySelector('[name="maxplayers"]');
	var checkboxListed = addServerForm.querySelector('[name="listed"]');
	var checkboxActive = addServerForm.querySelector('[name="active"]');
	var inputPlusSettings = addServerForm.querySelector('[name="plussettings"]');
	var inputPlusAdmin = addServerForm.querySelector('[name="plusadmin"]');
	var inputPlusLevelList = addServerForm.querySelector('[name="pluslevellist"]');

	var servertable = document.querySelector('#servertable');
	var serverlist = [];

	var filelisttable = document.querySelector('#filelisttable');
	var filelist = [];
	var filenamesLower = [];
	var filenamesList = [];
	var filelistlocked = false;
	var btnFileListCheckAll = document.querySelector('#filelistcheckall');
	var btnFileListUncheckAll = document.querySelector('#filelistuncheckall');
	var btnFileListDownload = document.querySelector('#filelistdownload');
	var btnFileListDelete = document.querySelector('#filelistdelete');
	var uploadmeter = document.querySelector('#uploadmeter');
	var downloadmeter = document.querySelector('#downloadmeter');
	var filelistuploadform = document.querySelector('#filelistuploadform');
	var uploadfiles = filelistuploadform.querySelector('[name="files"]');
	var uploadoverwrite = filelistuploadform.querySelector('[name="uploadoverwrite"]');


	loginForm.addEventListener('submit', function (e) {
		e.preventDefault();

		username = loginUsername.value;
		password = loginPassword.value;

		addServerForm.reset();
		socketReconnect();

	}, false);
	logoutBtn.addEventListener('click', function () {
		username = "";
		password = "";
		if (ws) ws.close();
	}, false);

	addServerForm.addEventListener('submit', function (e) {
		e.preventDefault();

		if (inputServername.value.length === 0 || inputServername.value.length > 31) {
			inputServername.focus();
			alert("Invalid servername");
		} else if (inputMaxscore.value < 1 || inputMaxscore.value > 255) {
			inputMaxscore.focus();
			alert("Maxscore out of range");
		} else if (inputMaxPlayers.value < 1 || inputMaxPlayers.value > 32) {
			inputMaxPlayers.focus();
			alert("Max players out of range");
		} else {
			// All valid, send to server!

			sendToServer({
				add: {
					servername: inputServername.value,
					port: +selectPort.value || 0,
					gamemode: selectGamemode.value || "BATTLE",
					maxscore: +inputMaxscore.value || 10,
					maxplayers: +inputMaxPlayers.value || 32,
					listed: checkboxListed.checked,
					active: checkboxActive.checked,
					settings: [inputPlusSettings.value.trim(), inputPlusAdmin.value.trim(), inputPlusLevelList.value.trim()]
				}
			});

		}

	}, false);

	btnFileListCheckAll.addEventListener('click', function () {
		if (filelistlocked) return;
		for (var i = 0; i < filelist.length; i++) {
			var f = filelist[i];
			f.selectedBox.checked = true;
			f.row.classList.add('selected');
		}
	}, false);
	btnFileListUncheckAll.addEventListener('click', function () {
		if (filelistlocked) return;
		for (var i = 0; i < filelist.length; i++) {
			var f = filelist[i];
			f.selectedBox.checked = false;
			f.row.classList.remove('selected');
		}
	}, false);
	btnFileListDownload.addEventListener('click', downloadSelectedFiles, false);

	filelistuploadform.addEventListener('submit', function (e) {
		e.preventDefault();
		if (filelistlocked || uploadfiles.files.length === 0) return;
		
		
		var fileList = [];
		for (var i = 0; i < uploadfiles.files.length; i++) {
			if (uploadoverwrite.checked || filenamesList.indexOf(uploadfiles.files[i].name) === -1) {
				fileList.push(uploadfiles.files[i]);
				
			}
		}
		if (fileList.length > 0) {

			filelistlocked = true;
			uploadmeter.value = 0;
			uploadmeter.classList.add('visible');

			var fd = new FormData();
			fd.append('username', username);
			fd.append('password', password);
			for (var i = 0; i < fileList.length; i++) {
				fd.append('file_'+i, fileList[i]);
			}

			var x = xhr('/fs/upload', null, function (response) {
				var info = JSON.parse(response);
				alert("Uploaded:\n"+info.added.join(', ')+(info.failed.length > 0? '\n\nFailed:\n'+info.failed.join(', ') : ''));
				filelistlocked = false;
				uploadmeter.value = 0;
				uploadmeter.classList.remove('visible');
			}, null, function (e) {
				alert('Error uploading!\n\n'+x.response);
			});
			x.upload.onprogress = function (e) {
				uploadmeter.value = e.loaded/e.total;
			}
			x.responseType = 'text';
			x.send(fd);

		} else {
			alert('No files were uploaded');
			
		}


	}, false);

}());