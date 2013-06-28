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
                             ,cookie: { secure: false, expires: new Date(Date.now() + (365 * 86400 * 1000))  }
                            });

var Evernote = require('evernote').Evernote;

var EvernoteLib = require('./lib/evernote')

var GithubLib = require('./lib/github')
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

  app.use(GithubLib);
  app.use(EvernoteLib);

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
//                Authentications
//===================================================


EvernoteLib.authenticationCallback = function(req, res, data, token) {
  console.log("Evernote Callback to Express");

  var userId = req.session.user.id;
  redisClient.sadd('users:' + userId, userId);
  redisClient.set('users:' + userId + ':evernote:user', JSON.stringify(req.session.user));
}

GithubLib.authenticationCallback = function(req, res, err, token) {
  console.log("Github Callback to Express");

  var userId = req.session.user.id;

  redisClient.set('users:' + userId + ':github:authToken', token);

  req.session.github = {};
  req.session.github.authToken = token;
  
  var _ghClient = GithubLib.apiClient();
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

  req.session.user.timezoneOffset = timezone;

  redisClient.set('users:' + req.session.user.id + ':evernote:user', JSON.stringify(req.session.user));

  console.log('users:' + req.session.user.id + ':evernote:user');
  console.log(JSON.stringify(req.session.user));

  console.log(JSON.stringify(req.session.user));

  var result = redisClient.get('users:' + req.session.user.id + ':evernote:user', function(err, data){
    console.log('redis get: ' + data);
  });

  if(!req.session.user) return res.send('Unauthenticate',401);
  if(!req.body) return res.send('Invalid content',400);

  var userInfo = req.session.user;
  var userId = req.session.user.id;

  console.log("/evernote/create-notebook: " + userId);

  // Create notebook
  var notebookName = "Blog with Evernote";
  var noteStore = EvernoteLib.Client(req.session.oauthAccessToken).getNoteStore();

  var createNotebook = function() {
    var notebook = new Evernote.Notebook({"name": notebookName});

    var noteStore1 = EvernoteLib.Client(req.session.oauthAccessToken).getNoteStore();
    noteStore1.createNotebook(req.session.oauthAccessToken, notebook, 
      function onsuccess(data) {
        redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
        
        return res.redirect('/');
      },
      function onerror(error) {
        console.log("Creating Notebook: Error " + error);
        res.send(error,500);
        
      });
  }
  // end createNotebook

  var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, notebookData){
    if (notebookData) {
      var notebook = JSON.parse(notebookData);
      // console.log(JSON.stringify(notebook));
      //NoteStoreClient.prototype.getNotebook = function(authenticationToken, guid, callback) {
      noteStore.getNotebook(req.session.oauthAccessToken, notebook.guid, 
        function(serverNotebook) {
          console.log("Get Notebook: " + JSON.stringify(serverNotebook));
          // update notebook info        
          redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
        },
        function onerror(error) {
          if (error instanceof Evernote.EDAMNotFoundException) {
            console.log("Not found Notebook");
            createNotebook();
          } else {
            console.log("Get Notebook: Error " + error);          
            res.send(error,500);  
          }
        }
      );

      return res.redirect('/');
    } else {



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
          createNotebook();
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
    


    EvernoteLib.findNotesMetadata(req.session.oauthAccessToken, {notebookGuid : notebookGuid}, function(error, noteList) {
      if (error) {
        console.log(error);
        res.send(error,500);
      } else {
        console.log(" Got Notes List: " + JSON.stringify(noteList));
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

        var result = redisClient.get('users:' + userId + ':evernote:user', function(err, data) {
          var userInfo = JSON.parse(data);
          flow.serialForEach(newNotes, function(note) {
            checkUpdateForPost(userInfo, note, this);
          },function() {
            // console.log("DONE: syncNotesMetadata");
          });

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

      createPostWithMetadata(userInfo, note.guid, null, callback);
    } else if (note.updated != updated) {
      // update note
      console.log('Update post: ' + note.title);
      updatePostWithMetadata(userInfo, note.guid, null, callback);
    } else {
      console.log('Old post: ' + note.title);
      callback(null);
    };
  });
}


var createPostWithMetadata = function(userInfo, noteGuid, validateWithNotebookGuid, callback) {
  var noteStore = EvernoteLib.Client(userInfo.oauthAccessToken).getNoteStore();
  
  //getNote = function(authenticationToken, guid, withContent, withResourcesData, withResourcesRecognition, withResourcesAlternateData, callback) {
  noteStore.getNote(userInfo.oauthAccessToken, noteGuid, true, true, true, true, function(note) {
    console.log('Get note for creating: - Note: ' + note.title);
    // console.log('Get note for creating: - Note: ' + JSON.stringify(note));

    if (validateWithNotebookGuid && note.notebookGuid != validateWithNotebookGuid) {
      console.log("Validate notebook failed! " + note.notebookGuid + " vs " + validateWithNotebookGuid);
      callback("Validate notebook failed!");
      return;
    };

    note.timezoneOffset = userInfo.timezoneOffset;
    note.timezone = userInfo.timezone;
    createGithubPost(userInfo.id, note, function(error, data) {
      callback(error, data);
    });

  }, function onerror(error) {
    callback(error);
  });
}

var updatePostWithMetadata = function(userInfo, noteGuid, validateWithNotebookGuid, callback) {
  console.log('updatePostWithMetadata ' + noteGuid);

  // console.log(userInfo);

  var noteStore = EvernoteLib.Client(userInfo.oauthAccessToken).getNoteStore();

  noteStore.getNote(userInfo.oauthAccessToken, noteGuid, true, true, true, true, function(note) {
    
    // console.log('Get note for updating: Note: ' + JSON.stringify(note));

    console.log('Get note for updating: Note: ' + note.title);

    if (validateWithNotebookGuid && note.notebookGuid != validateWithNotebookGuid) {
      console.log("Validate notebook failed! " + note.notebookGuid + " vs " + validateWithNotebookGuid);
      callback("Validate notebook failed!");
      return;
    };
    
    // redisClient.set('users:' + userId + ':posts:' + guid + ':githubData', JSON.stringify(data));
    var userId = userInfo.id;
    var result = redisClient.get('users:' + userId + ':posts:' + note.guid + ':githubData', function(err, data) {
      // console.log('Database: ' + 'users:' + userId + ':posts:' + guid + ':githubData' + ': '+ data);  
      if (err) {
        callback(err);
        return;
      };

      if (data) {
        // console.log(data);
        var githubCommit = JSON.parse(data);

        var sha;
        if (githubCommit.content) {
          sha = githubCommit.content.sha;
        };
        
        console.log('Updating github file with SHA: ' + sha);  
        updateGithubPost(userInfo.id, sha , note, function(err, data) {
          console.log(err);
          callback(err, data);
        });          
      } else {
        console.log('Can not find github sha. Create instead');
        note.timezoneOffset = userInfo.timezoneOffset;
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

  var userId = req.session.user.id;

  var result = redisClient.get('users:' + userId + ':evernote:user', function(err, data) {
    var userInfo = JSON.parse(data);

    var newNotes = notesMetadata.notes;
    flow.serialForEach(newNotes, function(note) {
      checkUpdateForPost(userInfo, note, this);
    },function() {
      // console.log("DONE: syncNotesMetadata");
    });
  });
}

var createGithubPost = function(userId, note, callback){

  githubRepoWithUserId(userId, function(err, repo) {

    if (err) {
      callback(err);
      return;
    };

    console.log('Repo: ' + repo.name + " Token: " + repo.client.token);

    var noteContent = EvernoteLib.contentInMarkdown(note);
    repo.createGithubPost({note: note, content: noteContent}, function(err, data) {
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

    var noteContent = EvernoteLib.contentInMarkdown(note);

    repo.updateGithubPost(githubSha, {note: note, content: noteContent} , function(err, data) {
      // Save to database
      if (err) {
        console.log(err);
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

    var _ghClient = GithubLib.apiClient();
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


  var result = redisClient.get('users:' + userId + ':evernote:user', function(err, userData) {

    if (err) {
      console.log('Can not find user ' + userId);
      res.end('');
      return;
    }
    var userInfo = JSON.parse(userData);
    console.log("user info: " + JSON.stringify(userInfo));

    var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, notebookData) {

      if (err) {
        console.log('Can not find notebook for ' + userId);
        res.end('');
        return;
      }

      var notebook = JSON.parse(notebookData);

      if (userInfo) {
        if (reason == 'create') {
          createPostWithMetadata(userInfo, noteGuid, notebook.guid, function(error, data){
            if (error) {
              console.log(error);
            };
          });
        } else if (reason == 'update') {
          updatePostWithMetadata(userInfo, noteGuid, notebook.guid, function(error, data){
            if (error) {
              console.log(error);
            };
          });
        }

        res.end('', 200);      
      };

    });

  });

});



app.get('/me', function(req, res){
  
  if(!req.session.user)
    return res.send('Please, provide valid authToken',401);

  // return res.send(req.session.user,200);


  // var userStore = new Evernote.Client({token: req.session.oauthAccessToken}).getUserStore();

  // userStore.getUser(function(edamUser) {
  //    req.session.user = edamUser;
  //    return res.send(edamUser,200);
  // });

  var result = redisClient.get('users:' + req.session.user.id + ':evernote:user', function(err, data) {
    var edamUser = JSON.parse(data);
    return res.send(edamUser,200); 
  });

});

server.listen(config.serverPort, function(){
  console.log("Express server listening on port " + config.serverPort)
})
