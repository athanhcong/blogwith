const KEY = 'express.sid'
  , SECRET = 'express'
  ;


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

var Evernote = require('evernote').Evernote;
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
	
  // evernote.oAuth(evernote_callback).getOAuthRequestToken( function(error, oauthToken, oauthTokenSecret, results){
		
		// if (error) return res.send("Error getting OAuth request token : " + util.inspect(error), 500);

  //   req.session.oauthRequestToken = oauthToken;
  //   res.redirect( evernote.oAuthRedirectUrl(oauthToken) );      
  // });


  var client = new Evernote.Client({
    consumerKey: config.evernoteConsumerKey,
    consumerSecret: config.evernoteConsumerSecret,
    sandbox: config.evernoteUsedSandbox
  });

  // console.log (JSON.stringify({
  //   consumerKey: config.evernoteConsumerKey,
  //   consumerSecret: config.evernoteConsumerKey,
  //   sandbox: config.evernoteUsedSandbox
  // }));
  client.getRequestToken(evernote_callback, function(error, oauthToken, oauthTokenSecret, results){
    if (error) return res.send("Error getting OAuth request token : " + util.inspect(error), 500);

    if(error) {
      req.session.error = JSON.stringify(error);
      res.redirect('/');
    }
    else { 

      req.session.oauthRequestToken = oauthToken; // Old code

      // store the tokens in the session
      req.session.oauthToken = oauthToken;
      req.session.oauthTokenSecret = oauthTokenSecret;



      // redirect the user to authorize the token
      res.redirect(client.getAuthorizeUrl(oauthToken));
    }
  });  

});

app.all('/authentication/callback', function(req, res){
	
	// var evernote_callback = config.serverUrl +'/evernote/authentication/callback';
		
  // evernote.oAuth(evernote_callback).getOAuthAccessToken( req.session.oauthRequestToken, 
		// req.session.oauthRequestTokenSecret, 
		// req.query.oauth_verifier, 
		// function(err, authToken, accessTokenSecret, results) {

		// 	if (err) return res.send("Error getting accessToken", 500);
			 
		// 	evernote.getUser(authToken, function(err, edamUser) {
			
		// 		if (err) return res.send("Error getting userInfo", 500);
				
		// 		req.session.authToken = authToken;
		// 		req.session.user = edamUser;

	 //      var userId = req.session.user.id;
  //       redisClient.sadd('users:' + userId, userId);
  //       redisClient.set('users:' + userId + ':evernote:user', JSON.stringify(req.session.user));
		// 		res.redirect('/');
		// 	});
  // });




  var client = new Evernote.Client({
    consumerKey: config.evernoteConsumerKey,
    consumerSecret: config.evernoteConsumerSecret,
    sandbox: config.evernoteUsedSandbox
  });

  client.getAccessToken(
    req.session.oauthToken, 
    req.session.oauthTokenSecret, 
    req.param('oauth_verifier'), 
    function(error, oauthAccessToken, oauthAccessTokenSecret, results) {


      if (error) return res.send("Error getting accessToken", 500);
       

      
      req.session.oauthAccessToken = oauthAccessToken;

      client.token = req.session.oauthAccessToken;

      client.getUserStore().getUser(oauthAccessToken, function(edamUser) {
        
        edamUser.oauthAccessToken = oauthAccessToken
        req.session.user = edamUser;

        var userId = req.session.user.id;
        redisClient.sadd('users:' + userId, userId);
        redisClient.set('users:' + userId + ':evernote:user', JSON.stringify(req.session.user));
        res.redirect('/');
      });


      // if(error) {
      //   console.log('error');
      //   console.log(error);
      //   res.redirect('/');
      // } else {
      //   // store the access token in the session
      //   req.session.oauthAccessToken = oauthAccessToken;
      //   req.session.oauthAccessTtokenSecret = oauthAccessTokenSecret;
      //   req.session.edamShard = results.edam_shard;
      //   req.session.edamUserId = results.edam_userId;
      //   req.session.edamExpires = results.edam_expires;
      //   req.session.edamNoteStoreUrl = results.edam_noteStoreUrl;
      //   req.session.edamWebApiUrlPrefix = results.edam_webApiUrlPrefix;
      //   res.redirect('/');
      // }
    });


});

github.authenticationCallback = function(req, res, err, token) {
  console.log("Github Callback to Express");

  var userId = req.session.user.id;

  redisClient.set('users:' + userId + ':github:authToken', token);

  req.session.github = {};
  req.session.github.authToken = token;
  
  var _ghClient = github.apiClient();
  _ghClient.token = token;
  var _ghMe = _ghClient.me();
  _ghMe.info(function(err, data) {
    console.log("error: " + err);
    console.log("data: " + data);

    if (data) {
      data.authToken = token;
      redisClient.set('users:' + userId + ':github:user', JSON.stringify(data));

      var userLogin = data.login;
      _ghMe.repos(function(err, data) {
          console.log("repos: " + err);
        if (err) {
          res.send(err,500);
        } else {
          

          var comRepoName = userLogin + '.github.com';
          var ioRepoName = userLogin + '.github.io';

          var foundRepo;
          for (var i = data.length - 1; i >= 0; i--) {
            var repo = data[i];
            
            if (repo.name == ioRepoName || repo.name == comRepoName) {
              foundRepo = repo;
              break;
            };
          };

          if (foundRepo) {
            console.log("Found repo " + JSON.stringify(foundRepo));
            redisClient.set('users:' + userId + ':github:pageData', JSON.stringify(
              {
                'login' : userLogin
                , 'authToken' : token
                , 'repoName' : foundRepo.name
                , 'repo' : foundRepo
              }));
          } else {
            console.log("NOT Found repo. Create one");
            // Create repo

          };

          res.redirect('/#github');    
        }



        
      });

      
    } else {
      res.send(err,500);
    };
  });


};


/////////////////



app.get('/evernote/create-notebook', function(req, res){


  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;
  
  var timezone = query.timezone;
  console.log("timezone" + timezone);

  req.session.user.timezone = timezone;

  redisClient.set('users:' + req.session.user.userId + ':evernote:user', JSON.stringify(req.session.user));



  if(!req.session.user) return res.send('Unauthenticate',401);
  if(!req.body) return res.send('Invalid content',400);

  var userInfo = req.session.user;
  var userId = req.session.user.id;

  console.log("/evernote/create-notebook: " + userId);

  var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, notebook){
    if (notebook) {
      console.log(JSON.stringify(notebook));
      return res.redirect('/');
    } else {
      var notebookName = "Blog with Evernote";

      var noteStore = new Evernote.Client({token: req.session.oauthAccessToken}).getNoteStore();

      // Check for note books
      noteStore.listNotebooks(req.session.oauthAccessToken, function(data) {
        console.log("Retrieved notebooks: " + data.length +  JSON.stringify(data));

        var foundNotebook;
        if (data) {
          // Check for "Blog with Evernote"
          for (var i = data.length - 1; i >= 0; i--) {
            var aNotebook = data[i];
            console.log("Notebook " + JSON.stringify(aNotebook));
            console.log("Notebook name" +  aNotebook.name);
            if (aNotebook.name == notebookName) {
              console.log("Found name" + aNotebook.name);

              foundNotebook = aNotebook;
              break;
            };
          };
        };

        if (foundNotebook) {
          console.log("Found notebook");
          redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(foundNotebook));
          return res.redirect('/');

        } else {
          console.log("No notebook. Creating one");

          var notebook = new Evernote.Notebook({"name": notebookName});
      
          noteStore.createNotebook(req.session.oauthAccessToken, notebook, function(data) {
            redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
            return res.redirect('/');
          },
          function onerror(error) {
            console.log("Creating Notebook: Error " + error);
            res.send(error,500);
            
          });
        };
      },
      function onerror(error) {
        console.log(error);
        res.send(error,500);
        
      }); // list notebooks
    }

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
    

    //NoteStoreClient.prototype.findNotesMetadata = function(authenticationToken, filter, offset, maxNotes, resultSpec, callback) {
    var noteStore = new Evernote.Client({token: req.session.oauthAccessToken}).getNoteStore();

    var noteFilter = new Evernote.NoteFilter({notebookGuid : notebookGuid});
    var resultSpec = new Evernote.NotesMetadataResultSpec(
      { includeTitle : true
      , includeContentLength: true
      , includeCreated: true
      , includeUpdated: true
      , includeDeleted: true
      , includeUpdateSequenceNum: true
      , includeTagGuids: true
      , includeAttributes: true
      , includeLargestResourceMime : true
      , includeLargestResourceSize: true});

    resultSpec.includeTitle = true;
    console.log ("resultSpec");
    console.log (resultSpec);
    noteStore.findNotesMetadata(req.session.oauthAccessToken, noteFilter, 0, 50, resultSpec, 
      function(noteList) {
        console.log(" Got Notes List: " + JSON.stringify(noteList));
        syncNotesMetadata(req, res, noteList, function(err, data){
          return res.send(noteList,200);
        });
    }, function onerror(error) {
        console.log(error);
        res.send(error,500);
        
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
          checkUpdateForPost(req, note, this);
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

var checkUpdateForPost = function(req, note, callback) {
  var userInfo = req.session.user;
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
  var noteStore = new Evernote.Client({token: userInfo.oauthAccessToken }).getNoteStore();

  //getNote = function(authenticationToken, guid, withContent, withResourcesData, withResourcesRecognition, withResourcesAlternateData, callback) {
  noteStore.getNote(userInfo.oauthAccessToken, noteGuid, true, false, false, false, function(note) {
    console.log('Get note for creating: - Note: ' + note.title);
    note.timezone = userInfo.timezone;
    createGithubPost(userInfo.id, note, function(error, data) {
      callback(error, data);
    });

  }, function onerror(error) {
    callback(error);
  });
}

var updatePostWithMetadata = function(userInfo, noteGuid, callback) {
  console.log('updatePostWithMetadata');

  var noteStore = new Evernote.Client({token: userInfo.oauthAccessToken }).getNoteStore();


  noteStore.getNote(userInfo.oauthAccessToken, noteGuid, true, false, false, false, function(note) {
    
    console.log('Get note for updating: Note: ' + JSON.stringify(note));

    console.log('Get note for updating: Note: ' + note.title);
    
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
        note.timezone = userInfo.timezone;
        createGithubPost(userInfo.id, note, function(err, data) {
          callback(err, data);
        });
      };

    });
  }, function onerror(error) {
    callback(error);
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
  var result = redisClient.get('users:' + userId + ':github:pageData', function(err, data) {

    if (err) {
      return callback(err);
    };

    var githubPageData = JSON.parse(data);
    var githubUsername = githubPageData.login;

    githubRepoName = githubUsername + '/' + githubPageData.repoName;

    var _ghClient = github.apiClient();
    _ghClient.token = githubPageData.authToken;
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
    console.log(userInfo);
    if (userInfo) {
      if (reason == 'create') {
        createPostWithMetadata(userInfo, noteGuid, function(err, data){});
      } else if (reason == 'update') {
        updatePostWithMetadata(userInfo, noteGuid, function(err, data){});
      }

      res.end('', 200);      
    };

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

  return res.send(req.session.user,200);

  // var userStore = new Evernote.Client({token: req.session.oauthAccessToken}).getUserStore();

  // userStore.getUser(function(edamUser) {
  // 		req.session.user = edamUser;
  // 		return res.send(edamUser,200);
  // });
});

server.listen(config.serverPort, function(){
  console.log("Express server listening on port " + config.serverPort)
})


app.get('/note', function(req, res){
  
  if(!req.session.user)
    return res.send('Please, provide valid authToken',401);
  

  var evernote = new Evernote.Client({token: req.session.oauthAccessToken});
  var noteStore = evernote.getNoteStore();
  //getNote = function(authenticationToken, guid, withContent, withResourcesData, withResourcesRecognition, withResourcesAlternateData, callback) {
  noteStore.getNote(req.session.oauthAccessToken, "9af28b07-e4f8-4433-bae0-1d6aac37c699", false, false, false, false, function(note) {
      return res.send(note,200);
  });
});

server.listen(config.serverPort, function(){
  console.log("Express server listening on port " + config.serverPort)
})
