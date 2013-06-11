

var authToken = "S=s48:U=12be903:E=1449cb52258:C=13d4503f658:P=1cd:A=en-devtoken:V=2:H=02728126921fe27ce2376f555d85f41b"; //The token

var config   = require('../config.js');
var Evernote = require('../evernode').Evernote;
var util = require('util');

var evernote = new Evernote(
    config.evernoteConsumerKey,
    config.evernoteConsumerSecret,
    config.evernoteUsedSandbox
  );

var offset 		= 0;
var count 		= 10;
var words 		= '';
var sortOrder = 'UPDATED' // 'CREATED';
var ascending = false;

//Get the user object....
evernote.getUser(authToken,function(err, edamUser) {
	
	if (err)  return console.log(err);
  
  //Find the notes....
  evernote.findNotes(edamUser,  words, { offset:offset, count:count, sortOrder:sortOrder, ascending:ascending }, function(err, noteList) {
    
    if (err)  return console.log(err);
    
    return console.log(noteList);
  });
});

