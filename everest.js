const KEY = 'express.sid'
  , SECRET = 'express'
  ;


require('./utils.js');

var config = new require('./config.js')();

console.log("Starting with configuration");
console.log(config);

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

var github = require('./lib/github')
  , url = require('url');


var flow = require('flow');

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

  app.use(github);

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

github.authenticationCallback = function(req, res, data, token) {
  console.log("Github Callback to Express");

  var userId = req.session.user.id;

  redisClient.set('users:' + userId + ':github:authToken', token);

  req.session.github = {};
  req.session.github.authToken = token;
  
  var _ghClient = github.apiClient();
  _ghClient.token = token;
  _ghClient.me().info(function(err, data) {
    console.log("error: " + err);
    console.log("data: " + data);

    if (data) {
      data.authToken = token;
      redisClient.set('users:' + userId + ':github:user', JSON.stringify(data));
      res.redirect('/');      
    };

  });
};


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


// app.get('/evernote/sync', function(req, res){
//   console.log("/evernote/create-notebook");

//   if(!req.session.user) return res.send('Unauthenticate',401);
//   if(!req.body) return res.send('Invalid content',400);

//   // Check notebook
//   var userId = req.session.user.id;
//   var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, data){
//     if(!data) return res.send('Can not find notebook',400);

//     // Get all notes
//     var notebook = JSON.parse(data);
  
//     console.log("Retrieve change from notebook " + notebook.name);
    
//     // evernote.createNotebook(userInfo, notebook, function(err, data) {
//     //   console.log("Creating " + err + ' ' + JSON.stringify(data));
//     //   if (err) {
//     //     if(err == 'EDAMUserException') return res.send(err,403);
//     //     return res.send(err,500);
//     //   } else {
//     //     redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
//     //   }
//     // });
//     return res.redirect('/');

//   });

//   console.log("Retrieve notebook " + JSON.stringify(result));
// });

app.get('/evernote/sync', function(req, res){
  console.log('/evernote/sync');
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

    evernote.findNotesMetadata(userInfo, notebookGuid, words, 
      { offset:offset, count:count, sortOrder:sortOrder, ascending:ascending }, 
      function(err, noteList) {
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
        
        flow.serialForEach(newNotes, function(note) {
          checkUpdateForPost(req.session.user, note, this);
        },function() {
          // console.log("DONE: syncNotesMetadata");
        });
      };
    }


    redisClient.set('users:' + userId + ':evernote:notesMetadata', JSON.stringify(notesMetadata));

    cb(null); // Callback
  });

  };


});



//////////////

var checkUpdateForPost = function(userInfo, note, callback) {
  var userId = userInfo.id;
  var result = redisClient.get('users:' + userId + ':posts:' + note.guid + ':updated', function(err, updated) {

    console.log('Get `updated` for note ' + note.guid + ': ' + updated);

    if (!updated) {
      console.log('New post: ' + note.title);

      createPostWithMetadata(userInfo, note.guid, callback);
    } else if (note.updated != updated) {
      // update note
      console.log('Update post: ' + note.title);
      updatePostWithMetadata(userInfo, note.guid, callback);
    } else {
      console.log('Old post: ' + note.title);
      callback(null);
    };
  });
}

var createPostWithMetadata = function(userInfo, noteGuid, callback) {
  // console.log('createPostWithMetadata');

  evernote.getNote(userInfo, noteGuid, {}, function(err, note) {
    console.log('Get note for creating: Error: ' + err + ' - Note: ' + note.title);

    if (err) {
      callback(err);
      return;
    }

    createGithubPost(userInfo.id, note, function(err, data) {
      callback(err, data);
    });
  });
}

var updatePostWithMetadata = function(userInfo, noteGuid, callback) {
  // console.log('updatePostWithMetadata');

  evernote.getNote(userInfo, noteGuid, {}, function(err, note) {
    
    console.log('Get note for updating: Error: ' + err + ' - Note: ' + note.title);

    if (err) {
      callback(err);
      return;
    }

    
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

  var newNotes = notesMetadata.notes;
        
  flow.serialForEach(newNotes, function(note) {
    checkUpdateForPost(req.session.user, note, this);
  },function() {
    // console.log("DONE: syncNotesMetadata");
  });
}

var createGithubPost = function(userId, note, callback){

  githubRepoWithUserId(userId, function(err, repo) {

    if (err) {
      callback(err);
      return;
    };

    console.log('Repo: ' + repo.name + " Token: " + repo.client.token);

    repo.createGithubPost(note, function(err, data) {
      // Save to database
      if (err) {
      } else if (data) {
        var guid = note.guid;
        redisClient.set('users:' + userId + ':posts:' + guid + ':note', JSON.stringify(note));
        redisClient.set('users:' + userId + ':posts:' + guid + ':updated', note.updated);
        redisClient.set('users:' + userId + ':posts:' + guid + ':githubData', JSON.stringify(data));
      };

      callback(err, data);
    });

  });
};

// Update a file in github
var updateGithubPost = function(userId, githubSha, note, callback){

  githubRepoWithUserId(userId, function(err, repo) {
    if (err) {
      callback(err);
      return;
    };

    console.log('Repo: ' + repo.name + " Token: " + repo.client.token);

    repo.updateGithubPost(githubSha, note, function(err, data) {
      // Save to database
      if (err) {

      } else if (data) {
        var guid = note.guid;
        redisClient.set('users:' + userId + ':posts:' + guid + ':note', JSON.stringify(note));
        redisClient.set('users:' + userId + ':posts:' + guid + ':updated', note.updated);
        redisClient.set('users:' + userId + ':posts:' + guid + ':githubData', JSON.stringify(data));
      };
      callback(err, data); 
    });
  });
};

var githubRepoWithUserId = function(userId, callback) {
  var result = redisClient.get('users:' + userId + ':github:user', function(err, data) {

    if (err) {
      return callback(err);
    };

    var githubUser = JSON.parse(data);
    var githubUsername = githubUser.login;

    var githubRepoName = githubUsername + '.github.com';
    if (config.githubRepo) {
      githubRepoName = config.githubRepo;
    };

    githubRepoName = githubUsername + '/' + githubRepoName;

    var _ghClient = github.apiClient();
    _ghClient.token = githubUser.authToken;
    var _ghRepo = _ghClient.repo(githubRepoName);

    callback(null, _ghRepo);

  });
};



/////////////////////////////////////////


app.get('/github/create', function(req, res){
  console.log('/github/create');
  if(!req.session.user) return res.send('Unauthenticate',401);

  return res.send(data,200);

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

    var userInfo = JSON.parse(data);

    if (reason == 'create') {
      createPostWithMetadata(userInfo, noteGuid, null));
    } else if (reason == 'update') {
      createPostWithMetadata(userInfo, noteGuid, null));
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
