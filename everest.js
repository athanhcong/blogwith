const KEY = 'express.sid'
  , SECRET = 'express'
  , GITHUB_CLIENT_ID = '1144e0f6ba3889d04621'
  , GITHUB_CLIENT_SECRET = '910f3c346e97c8bdfccbb9001d7b010f1ce6a0e3'
  ;


require('./utils.js');

global.config = new require('./config.js')();
var config = global.config;

console.log("Starting with configuration");
console.log(global.config);

var util = require('util');
var querystring = require('querystring');
var express = require('express')
  // , connect = require('connect')
  , http = require('http');



var app = express()
  , server = http.createServer(app);


// Create an Evernote instance
var Evernote = require('./evernode').Evernote;
var evernote = new Evernote(
		config.evernoteConsumerKey,
		config.evernoteConsumerSecret,
		config.evernoteUsedSandbox
		);

var enml = require('enml-js');
var md = require('html-md');

var  redis = require('redis');
var redisClient;
if (process.env.REDISTOGO_URL) {
  // TODO: redistogo connection
  var rtg   = require("url").parse(process.env.REDISTOGO_URL);
  console.log ('Config RedisToGo: rtg', JSON.stringify(rtg));
  redisClient = redis.createClient(rtg.port, rtg.hostname);

  console.log ('Config RedisToGo: rtg.auth', JSON.stringify(rtg.auth.split(":")[1]));
  redisClient.auth(rtg.auth.split(":")[1], function(data) {
    console.log ('Config RedisToGo: callback.auth', JSON.stringify(data));
  }); 

  console.log ('Config RedisToGo');

} else {
  redisClient = redis.createClient()
};

var RedisStore = require('connect-redis')(express)
  , store = new RedisStore({
    client: redisClient,
  })
  // , store = new express.session.MemoryStore()
  , session = express.session({secret: SECRET
                             , key: KEY
                             , store: store
                             ,cookie: { secure: false, maxAge: 86400000 }
                            });


//

var github = require('octonode')
  , url = require('url')
  , qs = require('querystring');
// Build the authorization config and url
var auth_url = github.auth.config({
  id: GITHUB_CLIENT_ID,
  secret: GITHUB_CLIENT_SECRET
}).login(['user', 'repo', 'gist']);

var githubClient = github.client({
  id: GITHUB_CLIENT_ID,
  secret: GITHUB_CLIENT_SECRET
});


var ghme   = githubClient.me();

var Repo = github.repo;

var repositoryName = process.env.BLOG_REPOSITORY;

if (!repositoryName) {
  repositoryName = "testblog";
};

Repo.prototype.contentsCreate = function(filename, content, cb) {

  var path = '_posts/' + filename;

  var contentInBase64 = new Buffer(content).toString('base64');

  // console.log("GIT: /repos/" + this.name + "/contents/" + path);

  return this.client.put("/repos/" + this.name + "/contents/" + path, 
    {
      "message": "Create filename: " + path
      , "content": contentInBase64 
    }
    , function(err, s, b) {
      // console.log(err);
      // console.log(s);
      // console.log(b);
      // console.log("GIT: " +  path + ": Status: " + s);

      if (err) {
        return cb(err);
      }

      if (s !== 201) {
        return cb(new Error("Repo contents error with status: " + s));
      } else {
        return cb(null, b);
      }
    });
};

Repo.prototype.contentsUpdate = function(filename, sha, content, cb) {

  var path = '_posts/' + filename;

  var contentInBase64 = new Buffer(content).toString('base64');


  // console.log("GIT: /repos/" + this.name + "/contents/" + path);

  return this.client.put("/repos/" + this.name + "/contents/" + path, 
    {
      "message": "Create filename: " + path
      , "content": contentInBase64
      , "sha" : sha
    }
    , function(err, s, b) {
      // console.log(err);
      // console.log(s);
      // console.log(b);
      console.log("GIT: " +  path + ": Status: " + s);

      if (err) {
        return cb(err);
      }

      // if (s !== 201) {
      //   return cb(new Error("Repo contents error"));
      // } else {
      return cb(null, b);
      // }
    });
};


var ghme   = githubClient.me();
var ghrepo = githubClient.repo('athanhcong/' + repositoryName);

console.log('RepositoryName: ' + repositoryName);

// Store info to verify against CSRF
var state = auth_url.match(/&state=([0-9a-z]{32})/i);

//Setup ExpressJS
app.configure(function(){

  //Use static files
  app.set('views', __dirname + '/views');
  app.engine('html', require('ejs').renderFile);


	app.use(express.cookieParser()); 
	app.use(express.bodyParser());

  app.use(express.methodOverride());

  app.use(session);

	app.use(express.static(__dirname + "/public"));
	//Use session
  // app.use(app.router);



  app.use(function(req, res, next){
    res.locals.session = req.session;
    next();
  });

  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));

});

// app.dynamicHelpers({
//   session: function(req, res){
//     return req.session;
//   }
// });

//Allow X-Domain Ajax
app.all('/', function(req, res, next) {
  console.log("app.all /");
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  next();
});

//===================================================
//								 			ETC
//===================================================

// Welcom Page
app.get('/', function(req, res){
	
  console.log("app.get / " + req + ' ' + req.session);
	if(!req.session.user) //Unauthenticate User
		return res.redirect('/login');

  console.log("loading index");
  return res.render("index.html");		
	// return res.redirect('/index');
});

app.get("/login", function (req, res) {
  res.render("login.html");
});

// app.get("/website/index", function (req, res) {
//   res.render("index.html");
// });

//===================================================
//								Authentications
//===================================================

app.all('/authentication', function(req, res){
	
	var evernote_callback = config.serverUrl + '/authentication/callback';
	
  evernote.oAuth(evernote_callback).getOAuthRequestToken( function(error, oauthToken, oauthTokenSecret, results){
		
		if (error) return res.send("Error getting OAuth request token : " + util.inspect(error), 500);

    req.session.oauthRequestToken = oauthToken;
    res.redirect( evernote.oAuthRedirectUrl(oauthToken) );      
  });

});

app.all('/authentication/callback', function(req, res){
	
	var evernote_callback = config.serverUrl +'/evernote/authentication/callback';
		
  evernote.oAuth(evernote_callback).getOAuthAccessToken( req.session.oauthRequestToken, 
		req.session.oauthRequestTokenSecret, 
		req.query.oauth_verifier, 
		function(err, authToken, accessTokenSecret, results) {

			if (err) return res.send("Error getting accessToken", 500);
			 
			evernote.getUser(authToken, function(err, edamUser) {
			
				if (err) return res.send("Error getting userInfo", 500);
				
				req.session.authToken = authToken;
				req.session.user = edamUser;

	      var userId = req.session.user.id;
        redisClient.sadd('users:' + userId, userId);
        redisClient.set('users:' + userId + ':evernote:user', JSON.stringify(req.session.user));
				res.redirect('/');
			});
  });
});


app.get('/github/authentication', function(req, res){
  console.log("github/authentication");
  res.writeHead(301, {'Content-Type': 'text/plain', 'Location': auth_url})
  res.end('Redirecting to ' + auth_url);
});

app.all('/github/authentication/callback', function(req, res){
  console.log("github/authentication/callback");
  var uri = url.parse(req.url);
  var values = qs.parse(uri.query);
  // Check against CSRF attacks
  // if (!state || state[1] != values.state) {
  //   res.writeHead(403, {'Content-Type': 'text/plain'});
  //   res.end('');
  // } else {
    github.auth.login(values.code, function (err, token) {
      console.log("github/authentication/callback " + err + ' ' + token);
      // res.writeHead(200, {'Content-Type': 'text/plain'});

      var userId = req.session.user.id;

      redisClient.set('users:' + userId + ':github:authToken', token);

      req.session.github = {};
      req.session.github.authToken = token;
      githubClient.token = token;
      ghme.info(function(err, data) {
        console.log("error: " + err);
        console.log("data: " + data);

        redisClient.set('users:' + userId + ':github:user', JSON.stringify(data));
        res.redirect('/');
      });
      
    });
  // }
});




/////////////////



app.get('/evernote/create-notebook', function(req, res){
  console.log("/evernote/create-notebook");



  if(!req.session.user) return res.send('Unauthenticate',401);
  if(!req.body) return res.send('Invalid content',400);
  
  var userId = req.session.user.id;

  var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, notebook){
    if (notebook) {
      console.log(JSON.stringify(notebook));
    } else {
      console.log("No notebook. Creating one");
      var notebook = {"name": "Blog with Evernote"};
      var userInfo = req.session.user;
  
      evernote.createNotebook(userInfo, notebook, function(err, data) {
        console.log("Creating " + err + ' ' + JSON.stringify(data));
        if (err) {
          if(err == 'EDAMUserException') return res.send(err,403);
          return res.send(err,500);
        } else {
          redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
        }
      });
    }
    return res.redirect('/');

  });
});


app.get('/evernote/sync', function(req, res){
  console.log("/evernote/create-notebook");

  if(!req.session.user) return res.send('Unauthenticate',401);
  if(!req.body) return res.send('Invalid content',400);

  // Check notebook
  var userId = req.session.user.id;
  var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, data){
    if(!data) return res.send('Can not find notebook',400);

    // Get all notes
    var notebook = JSON.parse(data);
  
    console.log("Retrieve change from notebook " + notebook.name);
    
    // evernote.createNotebook(userInfo, notebook, function(err, data) {
    //   console.log("Creating " + err + ' ' + JSON.stringify(data));
    //   if (err) {
    //     if(err == 'EDAMUserException') return res.send(err,403);
    //     return res.send(err,500);
    //   } else {
    //     redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
    //   }
    // });
    return res.redirect('/');

  });

  console.log("Retrieve notebook " + JSON.stringify(result));
});

app.get('/evernote/notes', function(req, res){
  console.log('/evernote/notes');
  if(!req.session.user) return res.send('Unauthenticate',401);

  var userInfo  = req.session.user;
  var offset    = req.query.offset || 0;
  var count     = req.query.count || 50;
  var words     = req.query.words || '';
  var sortOrder = req.query.sortOrder || 'UPDATED';
  var ascending = req.query.ascending || false;


  var userId = req.session.user.id;



  var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, data) {

    if (!data) {
      return res.send('No notebook',500);
    }

    var notebook = JSON.parse(data);

    console.log('notebook ' + JSON.stringify(notebook));

    var notebookGuid = notebook.guid;
    
    console.log('notebookGuid ' + notebookGuid);

    evernote.findNotesMetadata(userInfo, notebookGuid, words, { offset:offset, count:count, sortOrder:sortOrder, ascending:ascending }, function(err, noteList) {
      if (err) {
        if(err == 'EDAMUserException') return res.send(err,403);
        return res.send(err,500);
      } else {

        
      syncNotesMetadata(req, res, noteList, function(err, data){
        return res.send(noteList,200);  
      });
      
      }
    });
  });




  var syncNotesMetadata = function(req, res, notesMetadata, cb) {
    console.log('syncNotesMetadata');


    // Get old notesMetadata
    var userId = req.session.user.id;

    var result = redisClient.get('users:' + userId + ':evernote:notesMetadata', function(err, oldNMData) {

      if (!oldNMData) {
        // No notesMetadata before
        initBlogWithNotesMetadata(req, res, notesMetadata);
      } else {
        oldNM = JSON.parse(oldNMData);

        var oldUpdateCount = oldNM.updateCount;
        var newUpdateCount = notesMetadata.updateCount;
        console.log('Compare updateCount ' + oldUpdateCount + ' vs ' + newUpdateCount);
        // if (oldUpdateCount != newUpdateCount) 
        {
          // Generate old note hashtable
          // var oldNotes = oldNM.notes;
          // var oldNotesTable = {};
          // for (var i = 0; i < oldNotes.length; i++) {
          //   var note = oldNotes[i];
          //   oldNotesTable[note.guid] = note.updated;

          // };

          var newNotes = notesMetadata.notes;

          for (var i = 0; i < newNotes.length; i++) {
            var note = newNotes[i];

            checkUpdateForPost(req.session.user, note);
          }

        };

      }
    });


    cb(null); // Callback
    redisClient.set('users:' + userId + ':evernote:notesMetadata', JSON.stringify(notesMetadata));
  };











});



//////////////


var gitOperations = [];
var isGitInOperation = false;
var addGitOperation = function (type, userInfo, noteGuid) {
  gitOperations.push({'type': type, 'userInfo': userInfo, 'noteGuid': noteGuid});

  startGitOperation();
}
var startGitOperation = function () {
  console.log("startGitOperation");

  if (!isGitInOperation && gitOperations.length > 0) {
    var operation = gitOperations.shift();
    var operator;
    if (operation.type == 'create') {
      operator = createPostWithMetadata;
    } else {
      operator = updatePostWithMetadata;
    }

    isGitInOperation = true;
    operator(operation.userInfo, operation.noteGuid, function (err, data) {
      isGitInOperation = false;
      startGitOperation(); // recursive
    });  
  };
}

var checkUpdateForPost = function(userInfo, note) {
  var userId = userInfo.id;
  var result = redisClient.get('users:' + userId + ':posts:' + note.guid + ':updated', function(err, updated) {

    console.log('get updated for ' + note.guid + ': ' + updated);

    if (!updated) {
      console.log('New post: ' + note.title);
      // return 'create';

      // createPostWithMetadata(userInfo, note);
      addGitOperation('create', userInfo, note.guid);

    } else if (note.updated != updated) {
      // update note
      console.log('Update post: ' + note.title);
      // return 'update';
      // updatePostWithMetadata(userInfo, note);
      addGitOperation('update', userInfo, note.guid);
    } else {
      console.log('Old post: ' + note.title);
      return null;
    };
  });
}

var createPostWithMetadata = function(userInfo, noteGuid, callback) {
  // console.log('createPostWithMetadata');

  evernote.getNote(userInfo, noteGuid, {}, function(err, note) {
    
    if (err) {
      callback(err);
      return;
    }

    console.log('Get note for creating: ' + note.title);


    createGithubPost(userInfo.id, note, function(err, data) {
      callback(err, data);
    });
  });
}

var updatePostWithMetadata = function(userInfo, noteGuid, callback) {
  // console.log('updatePostWithMetadata');

  evernote.getNote(userInfo, noteGuid, {}, function(err, note) {
    
    if (err) {
      callback(err);
      return;
    }

    console.log('Get note for updating: ' + note.title);
    // redisClient.set('users:' + userId + ':posts:' + guid + ':githubData', JSON.stringify(data));
    var userId = userInfo.id;
    var result = redisClient.get('users:' + userId + ':posts:' + note.guid + ':githubData', function(err, data) {
      // console.log('Database: ' + 'users:' + userId + ':posts:' + guid + ':githubData' + ': '+ data);  
      if (err) {
        callback(err);
        return;
      };

      if (data) {
        var githubCommit = JSON.parse(data);
        var sha = githubCommit.content.sha;
        console.log('Updating github file with SHA: ' + sha);  
        updateGithubPost(userInfo.id, sha , note, function(err, data) {
          callback(err, data);
        });          
      } else {
        console.log('Can not find github sha. Create instead');
        
        createGithubPost(userInfo.id, note, function(err, data) {
          callback(err, data);
        });
      };


    });
  });
}

var initBlogWithNotesMetadata = function(req, res, notesMetadata) {
  console.log('initBlogWithNotesMetadata');
  var notes = notesMetadata.notes;
  for (var i = 0; i < notes.length; i++) {
    var metadata = notes[i];
    addGitOperation('create', req.session.user, metadata);
  };
}

var createGithubPost = function(userId, note, callback){

  var contentHtml = enml.HTMLOfENML(note.content);
  var contentMarkdown = md(contentHtml);
  var title = note.title;


  // var date = new Date(note.created);
  var date = new Date();
  var timestamp = new Date().getTime();

  var titleFilename = title.toLowerCase().split(' ').join('-');
  var filename = date.getFullYear() + '-' + date.getMonth().pad(2) + '-' + date.getDay().pad(2) + '-' + titleFilename + '.md';
  // var content = "Yeah this is cool";
  // filename = timestamp + filename;

  console.log('createGithubPost ' + filename + ' ' + contentMarkdown);

  var result = redisClient.get('users:' + userId + ':github:authToken', function(err, data) {

    if (err) {
      callback(err);
      return;
    };

    githubClient.token = data;
    ghrepo.contentsCreate(filename, contentMarkdown, function(err, data) {
      console.log("Git create: " + filename + " - Error: " + err + " - Data: " + data);
      // console.log("error: " + err);
      // console.log("data: " + JSON.stringify(data));

      // Save to database
      if (err) {
      } else if (data) {
        var guid = note.guid;
        redisClient.set('users:' + userId + ':posts:' + guid + ':note', JSON.stringify(note));
        redisClient.set('users:' + userId + ':posts:' + guid + ':updated', note.updated);
        redisClient.set('users:' + userId + ':posts:' + guid + ':githubData', JSON.stringify(data));
      };

      // Callback
      callback(err, data);
    });
  });
};



// Update a file in github
var updateGithubPost = function(userId, githubSha, note, callback){

  var contentHtml = enml.HTMLOfENML(note.content);
  var contentMarkdown = md(contentHtml);
  var title = note.title;

  // console.log('createGithubPost ' + title + ' ' + contentHtml);


  // var date = new Date(note.created);
  var date = new Date();
  var timestamp = new Date().getTime();

  var titleFilename = title.toLowerCase().split(' ').join('-');
  var filename = date.getFullYear() + '-' + date.getMonth().pad(2) + '-' + date.getDay().pad(2) + '-' + titleFilename + '.md';
  // var content = "Yeah this is cool";
  // filename = timestamp + filename;

  console.log('updateGithubPost ' + filename + ' ' + contentMarkdown);

  var result = redisClient.get('users:' + userId + ':github:authToken', function(err, data) {

    if (err) {
      return callback(err);
    };

    githubClient.token = data;
    ghrepo.contentsUpdate(filename, githubSha, contentMarkdown, function(err, data) {
      console.log("Git update: " + filename + " - Error: " + err + " - Data: " + data);
      // Save to database
      if (err) {

      } else if (data) {
        var guid = note.guid;
        redisClient.set('users:' + userId + ':posts:' + guid + ':note', JSON.stringify(note));
        redisClient.set('users:' + userId + ':posts:' + guid + ':updated', note.updated);
        redisClient.set('users:' + userId + ':posts:' + guid + ':githubData', JSON.stringify(data));
      };

      // Callback
      callback(err, data);
    });
  });
};


// var getNote = function(req, res, guid, cb){
  
//   if(!req.session.user) return res.send('Unauthenticate',401);
//   if(!req.body) return res.send('Invalid content',400);
  
//   var userInfo = req.session.user;

//   evernote.getNote(userInfo, guid, null, function(err, note) {
    
//     if (err) {
//       cb(err);
//     } 
//     cb(null, note)
//   });
// });


app.get('/github/create', function(req, res){
  console.log('/github/create');
  if(!req.session.user) return res.send('Unauthenticate',401);


  var date = '13-06-01';
  var timestamp = new Date().getTime();
  var title = '' + timestamp;
  var filename = date + '-' + title + '.md';
  var content = "Yeah this is cool";

  var userId = req.session.user.id;


  var result = redisClient.get('users:' + userId + ':github:authToken', function(err, data) {
    console.log('got github token ' + data);

    githubClient.token = data;
    ghrepo.contentsCreate(title, content, function(err, data) {
      console.log("error" + err + "data: " + data);
      return res.send(data,200);
    });

  });

});


app.get('/evernote/webhook', function(req, res){
  

  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;
  
  var userId = query.userId;
  var noteGuid = query.guid;
  var reason = query.reason;

  console.log('/evernote/webhook ' + userId + ' ' + noteGuid + ' ' + reason);


  //redisClient.set('users:' + userId + ':evernote:user', JSON.stringify(req.session.user));

  var result = redisClient.get('users:' + userId + ':evernote:user', function(err, data) {

    if (err) {
      console.log('Can not find user ' + userId);
      res.end('');
      return;
    }

    var user = JSON.parse(data);

    if (reason == 'create') {
      addGitOperation('create', user, noteGuid);
    } else if (reason == 'update') {
      addGitOperation('update', user, noteGuid);
    }

    res.end('', 200);
  });  


});



/////////


app.all('/logout', function(req, res){
	
	var callback = req.query.callback;
	req.session.authToken = null;
	req.session.user = null;
	
	return res.send({ success:true });
});

app.get('/me', function(req, res){
	
	if(!req.session.user)
		return res.send('Please, provide valid authToken',401);
	
	evernote.getUser(req.session.user.authToken,function(err, edamUser) {
		
		if (err) {
			if(err == 'EDAMUserException') return res.send(err,403);
      return res.send(err,500);
    } else {
			
			req.session.user = edamUser;
			return res.send(edamUser,200);
    }
	});
});

server.listen(config.serverPort, function(){
  console.log("Express server listening on port " + config.serverPort)
})
