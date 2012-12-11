
var path = require('path');
var sqlite3 = require('sqlite3').verbose();

function openDb() {
	var db = new sqlite3.Database(path.join(__dirname, 'jj2ded.sqlite'), function (err) {
		if (err) {
			console.log("Error opening database", err);
		}
	});
	return db;
}

function alphaSort(a, b) {
	var a2 = a.toLowerCase();
	var b2 = b.toLowerCase();

	if (a2 === b2) {
		if (a > b) {
			a2 = a;
			b2 = b;
		} else {
			a2 = b;
			b2 = a;
		}
		
	}

	if (a2 < b2) return -1;
	else if (a2 > b2) return 1;
	else return 0;
}

module.exports = {
	openDb: openDb,
	alphaSort: alphaSort
};