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



///////// DATABASE WITH REDIS
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

///////// DATABASE WITH MONGO
var mongojs = require('mongojs');
var collections = ["users", "posts", "resources"];
var db = mongojs(config.mongoConnectionString, collections);



///////// EVERNOTE
var Evernote = require('evernote').Evernote;
var EvernoteLib = require('./lib/evernote')
  , TumblrLib = require('./lib/tumblr')
  , GithubLib = require('./lib/github');
GithubLib.db = db;
TumblrLib.db = db;

var url = require('url');
var flow = require('flow');



var hbs = require('hbs');
hbs.registerPartials(__dirname + '/views/partials');

//Setup ExpressJS
app.configure(function(){

  //Use static files
  app.set('views', __dirname + '/views');
  // app.engine('html', require('ejs').renderFile);
  app.set('view engine', 'html');
  app.engine('html', hbs.__express);

	app.use(express.cookieParser()); 
	app.use(express.bodyParser());



  app.use(session);


  app.use(function(req, res, next){

    res.locals.session = req.session;

    if (req.session.evernoteUserId && !req.user) {
      db.users.findOne({evernoteId: req.session.evernoteUserId}, function(error, user) {
        if (error) {
          console.log('requesting note found' + req.session.evernoteUserId);
          req.session.evernoteUserId = null;
        } else {
          // console.log('requesting ' + req.session.evernoteUserId);
          // console.log('requesting ' + JSON.stringify(user));
          req.user = user;
        }      
        next();
      });
    } else {
      console.log('requesting not logged in');
      next();
    };
    
  });


  app.use(express.static(__dirname + "/public"));

  app.use(express.methodOverride());

  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));

  app.use(GithubLib);
  app.use(EvernoteLib);
  app.use(TumblrLib);

});


//===================================================
//								 			ETC
//===================================================

// Welcom Page
app.get('/', function(req, res){
	
  console.log("app.get / " + req.session.evernoteUserId);

	if(!req.user) //Unauthenticate User
		return res.render("login.html");

  var indexPageData = {};
  if (req.user.evernote && req.user.evernote.user) {
    indexPageData.user = {};
    indexPageData.user.evernote = {
      user: req.user.evernote.user
      , notebook : req.user.evernote.notebook
    }
  };

  console.log(req.user);
  
  if (req.user.github && req.user.github.user) {

    indexPageData.user.github = {
      user: req.user.github.user
      , repository : req.user.github.repository
    }

  } else if (req.user.tumblr && req.user.tumblr.user) {
    indexPageData.user.tumblr = {
      user: req.user.tumblr.user
      , blog : req.user.tumblr.blog
    }

    if (!req.user.tumblr.blog) {
      indexPageData.user.tumblr.blogs = req.user.tumblr.user.blogs;

    };
  } 


  db.posts.find({evernoteUserId : req.session.evernoteUserId}).count(function(error, postsCount) {
    if (postsCount > 0) {
      indexPageData.posts = {
        'count': postsCount
      };
      db.posts.find({evernoteUserId : req.session.evernoteUserId}).sort({updated: -1}).limit(1, function(error, posts) {

        if (posts.length > 0) {
          var post = posts[0];
          console.log('get latest updated: ' + post.evernote.note.title);
          indexPageData.posts.latestUpdate = post;  
        };
        
        return res.render("index.html", indexPageData);
      });

    } else {
      return res.render("index.html", indexPageData);
    };
  });

});

// Welcom Page
app.get('/home', function(req, res){
  
  console.log("app.get /home");

  var indexPageData = {};
  if (req.user.evernote && req.user.evernote.user) {
    indexPageData.user = {};
    indexPageData.user.evernote = {
      user: req.user.evernote.user
      , notebook : req.user.evernote.notebook
    }
  };
  return res.render("login.html", indexPageData);

});

//===================================================
//                Authentications
//===================================================


EvernoteLib.authenticationCallback = function(req, res, evernoteUser, token) {
  console.log("Evernote Callback to Express");

  // Check if I have this user yet.
  // If no, create one, else get him and update.

  req.session.evernoteUserId = evernoteUser.id;

  var userId = evernoteUser.id;

  console.log('user timezone '+ req.session.userTimezoneOffset);
  var user = {
    evernote : {
      user: evernoteUser
      , oauthAccessToken: token
    }
    , 'timezoneOffset': req.session.userTimezoneOffset
  };

  db.users.update({evernoteId: userId}, {$set: user}, {upsert: true}, function(err, updated) {

      if( err || !updated ) console.log("User not updated" + err);
      else console.log("User updated");

      req.user = user;
      upsertUserNotebook(req, res);
  });
}

GithubLib.authenticationCallback = function(req, res, err, token) {
  console.log("Github Callback to Express");

  var userId = req.session.evernoteUserId;


  db.users.update({evernoteId: userId}, {$set: {'github.oauthAccessToken': token}}, {upsert: true}, function(error) {
    if (error) console.log('ERROR: ' + error);
  });

  
  var _ghClient = GithubLib.apiClient();
  _ghClient.token = token;
  var _ghMe = _ghClient.me();
  _ghMe.info(function(err, data) {
    console.log("error: " + err);
    console.log("data: " + data);

    if (data) {
      // data.authToken = token;

      db.users.update({evernoteId: userId}, {$set: {'github.user': data}}, {upsert: true}, function(error) {
        if (error) console.log('ERROR: ' + error);
      });

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

            var apiData = {
                'login' : userLogin
                , 'authToken' : token
                , 'repoName' : foundRepo.name
            };

            db.users.update({evernoteId: userId}, {$set: {'github.repository': foundRepo, 'github.apiData': apiData}}, {upsert: true}, function(error) {
              if (error) console.log('ERROR: ' + error);
            });

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



var upsertUserNotebook = function(req, res) {


  if(!req.session.evernoteUserId) return res.send('Unauthenticate',401);


  var user = req.user;
  var userId = req.session.evernoteUserId;

  console.log("/evernote/create-notebook: " + userId);

  // Create notebook
  var notebookName = "BlogWith";
  var noteStore = EvernoteLib.Client(req.user.evernote.oauthAccessToken).getNoteStore();

  var createNotebook = function() {

    var notebookPublishing = new Evernote.Publishing({
        publicDescription: "BlogWith"
        , uri : "blogwith"
      });

    var notebook = new Evernote.Notebook({
      name: notebookName
      , published : true
      , publishing : notebookPublishing
    });

    var noteStore1 = EvernoteLib.Client(req.user.evernote.oauthAccessToken).getNoteStore();
    noteStore1.createNotebook(req.user.evernote.oauthAccessToken, notebook, 
      function onsuccess(data) {
        console.log("Created Notebook: Guid " + data.guid);
        
        db.users.update({evernoteId: userId}, {$set: {'evernote.notebook': data}}, {upsert: true}, function(error) {
          if (error) console.log('ERROR: ' + error);
          return res.redirect('/#evernote');  
        });        
        
      },
      function onerror(error) {
        console.log("Creating Notebook: Error " + error);
        return res.send(error,500);
      });
  }
  // end createNotebook

  var updateNotebook = function(notebook) {

    var notebookPublishing = new Evernote.Publishing(
      {
        publicDescription: "BlogWith"
        , uri : "blogwith"
      });

    notebook.published = true;
    notebook.publishing = notebookPublishing;

    var noteStore1 = EvernoteLib.Client(req.user.evernote.oauthAccessToken).getNoteStore();
    noteStore1.updateNotebook(req.user.evernote.oauthAccessToken, notebook, 
      function onsuccess(data) {
        console.log("Updated Notebook: Guid " + data.guid);

        db.users.update({evernoteId: userId}, {$set: {'evernote.notebook': data}}, {upsert: true}, function(error) {
          if (error) console.log('ERROR: ' + error);
          return res.redirect('/#evernote');  
        });
        
      },
      function onerror(error) {
        console.log("Update Notebook: Error " + error);
        return res.send(error,500);
      });
  }
  // end createNotebook

  var createNotebookIfNeeded = function() {
    // Check for note books
    noteStore.listNotebooks(req.user.evernote.oauthAccessToken, function(data) {
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
        console.log("Found notebook" + foundNotebook.guid);

        db.users.update({evernoteId: userId}, {$set: {'evernote.notebook': foundNotebook}}, {upsert: true}, function(error) {
          if (error) console.log('ERROR: ' + error);
          return res.redirect('/#evernote');  
        });

      } else {
        console.log("No notebook. Creating one");
        return createNotebook();
      };
    },
    function onerror(error) {
      console.log(error);
      return res.send(error,500);
      
    }); // list notebooks
  }


  // Check if I have notebook or not

  if (req.user.evernote && req.user.evernote.notebook) {
    var notebook = req.user.evernote.notebook;
    console.log("Notebook: " + JSON.stringify(notebook));

    //NoteStoreClient.prototype.getNotebook = function(authenticationToken, guid, callback) {
    noteStore.getNotebook(req.user.evernote.oauthAccessToken, notebook.guid, 
      function(updatedNotebook) {
        console.log("Get Notebook: " + JSON.stringify(updatedNotebook));
        // update notebook info
        if (updatedNotebook.published) {

          db.users.update({evernoteId: userId}, {$set: {'evernote.notebook': updatedNotebook}}, {upsert: true}, function(error) {
            if (error) console.log('ERROR: ' + error);
            return res.redirect('/#evernote');  
          });

        } else {
          //NoteStoreClient.prototype.updateNotebook = function(authenticationToken, notebook, callback) {
          console.log("Updating notebook");
          return updateNotebook(updatedNotebook);
        };
        
      },
      function onerror(error) {
        console.log("Get Notebook: Error " + error); 
        return createNotebookIfNeeded();
      }
    );
  } else {
    return createNotebookIfNeeded(); 
  }
};

app.get('/evernote/create-notebook', upsertUserNotebook);











////////////////////////////////////
//////////// SYNC ////////////
////////////////////////////////////


app.get('/evernote/sync', function(req, res){
  console.log('/evernote/sync');

  if(!req.session.evernoteUserId) return res.send('Unauthenticate',401);
  if(!req.user.evernote) return res.send('Not connected with Evernote',401);

  var offset    = req.query.offset || 0;
  var count     = req.query.count || 50;
  var words     = req.query.words || '';
  var sortOrder = req.query.sortOrder || 'UPDATED';
  var ascending = req.query.ascending || false;

  var userId = req.session.evernoteUserId;

  var notebook = req.user.evernote.notebook;


  if (!notebook) {
    return res.send('No notebook', 500);
  } else if (!connectedBlogEngine(req.user)) {
      return res.send('Not connect blog', 500);
  }

  var notebookGuid = notebook.guid;
  
  console.log('notebookGuid ' + notebookGuid);
  
  EvernoteLib.findNotesMetadata(req.user.evernote.oauthAccessToken, {notebookGuid : notebookGuid}, function(error, noteList) {
    if (error) {
      console.log(error);
      res.send(error,500);
    } else {
      

      // filter based on notebook
      var allNotes = noteList.notes;

      console.log(" Got Notes List: " + allNotes.length);
      var filteredNotes = [];

      for (var i = allNotes.length - 1; i >= 0; i--) {
        var note = allNotes[i];
        if (note.notebookGuid == notebookGuid) {
          filteredNotes.push(note);
        } else {
          console.log("WARNING: Found note not belong to this notebook");
        };
      };

      noteList.notes = filteredNotes;

      syncNotesMetadata(req, res, noteList, function(err, data) {
        return res.send(noteList,200);
      });
    }
  });


  var syncNotesMetadata = function(req, res, notesMetadata, callback) {
    console.log('syncNotesMetadata');

    if(!req.session.evernoteUserId) return res.send('Unauthenticate',401);
    if(!req.user.evernote) return res.send('Not connected with Evernote',401);

    // Get old notesMetadata
    var userId = req.session.evernoteUserId;


    var newNotes = notesMetadata.notes;

    // test
    // createPostWithMetadata(req.user, newNotes[0].guid, null, cb);
    // updatePostWithMetadata(req.user, newNotes[0].guid, null, cb);
    // checkUpdateForPost(req.user, newNotes[0], cb);

    // return;
    // end test


    flow.serialForEach(newNotes, function(note) {
      checkUpdateForPost(req.user, note, this);
    },function() {
      // callback for previous function

    },function() {
      // save note metadata here
      console.log("DONE: syncNotesMetadata");
      callback(null);
    });
  };


});



//////////////

var checkUpdateForPost = function(user, note, callback) {

  db.posts.findOne({evernoteGuid: note.guid}, function(error, post) {


    if (!post) {
      console.log('New post: ' + note.title);

      createPostWithMetadata(user, note.guid, null, callback);
    } else if (note.updated != post.evernoteUpdated) {
      // update note
      console.log('Get `updated` for note ' + note.title + ': ' + post.evernoteUpdated);
      updatePostWithMetadata(user, note.guid, null, callback);
    } else {
      console.log('Old post: ' + note.title);
      callback(null);
    };
  });
}


var connectedBlogEngine = function (user) {
  if (user.github && user.github.repository) {
    return GithubLib;
  } else if (user.tumblr && user.tumblr.blog) {
    return TumblrLib;
  } else {
    console.log("ERROR: no engine!");
    return null;
  }
}

var createPostWithMetadata = function(user, noteGuid, validateWithNotebookGuid, callback) {
  var noteStore = EvernoteLib.Client(user.evernote.oauthAccessToken).getNoteStore();
  console.log("createPostWithMetadata: " + noteGuid);
  //getNote = function(authenticationToken, guid, withContent, withResourcesData, withResourcesRecognition, withResourcesAlternateData, callback) {
  noteStore.getNote(user.evernote.oauthAccessToken, noteGuid, true, false, false, false, function(note) {
    console.log('Get note for creating: - Note: ' + note.title);
    // console.log('Get note for creating: - Note: ' + JSON.stringify(note));

    if (validateWithNotebookGuid && note.notebookGuid != validateWithNotebookGuid) {
      console.log("Validate notebook failed! " + note.notebookGuid + " vs " + validateWithNotebookGuid);
      callback("Validate notebook failed!");
      return;
    };

    // note.timezoneOffset = user.timezoneOffset;
    // note.timezone = user.timezone;


    // Choose engine and create

    var BlogEngineLib = connectedBlogEngine(user);
    BlogEngineLib.createPostWithNote(user, note, function(error, data) {
      callback(error, data);
    });

  }, function onerror(error) {
    // console.log("createPostWithMetadata" + error);
    callback(error);
  });
}

var updatePostWithMetadata = function(user, noteGuid, validateWithNotebookGuid, callback) {
  console.log('updatePostWithMetadata ' + noteGuid);

  // console.log(user);

  var noteStore = EvernoteLib.Client(user.evernote.oauthAccessToken).getNoteStore();

  noteStore.getNote(user.evernote.oauthAccessToken, noteGuid, true, false, false, false, function(evernoteNote) {
    
    console.log('Get note for updating: Note: ' + JSON.stringify(note));

    console.log('Get note for updating: Note: ' + evernoteNote.title);


    if (validateWithNotebookGuid && evernoteNote.notebookGuid != validateWithNotebookGuid) {
      console.log("Validate notebook failed! " + evernoteNote.notebookGuid + " vs " + validateWithNotebookGuid);
      callback("Validate notebook failed!");
      return;
    };
    
    // redisClient.set('users:' + userId + ':posts:' + guid + ':githubData', JSON.stringify(data));
    var userId = user.id;

    db.posts.findOne({evernoteGuid: evernoteNote.guid}, function(error, post) {
      if(error) {
        return callback(error);
      }

      var BlogEngineLib = connectedBlogEngine(user);

      if (post) {
        // console.log(data);
        BlogEngineLib.updatePostWithNote(user, post, evernoteNote, function(error, data) {
          callback(error, data);
        });
         
      } else { // for call from webhook
        console.log('Can not find post. Create instead');
        // note.timezoneOffset = user.timezoneOffset;
        // note.timezone = user.timezone;

        BlogEngineLib.createPostWithNote(user, evernoteNote, function(error, data) {
          callback(error, data);
        });

      };

    });
  }, function onerror(error) {
    callback(error);
  });
}

var initBlogWithNotesMetadata = function(req, res, notesMetadata) {
  console.log('initBlogWithNotesMetadata');

  var userId = req.session.evernoteUserId;

  var newNotes = notesMetadata.notes;
  flow.serialForEach(newNotes, function(note) {
    checkUpdateForPost(req.user, note, this);
  },function() {
    // console.log("DONE: syncNotesMetadata");
  }, function() {
    console.log("DONE: initBlogWithNotesMetadata");
  });


}








/////////////////////////////////////////


app.get('/evernote/webhook', function(req, res){

  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;
  
  var evernoteUserId = parseInt(query.userId.trim());
  var noteGuid = query.guid;
  var reason = query.reason;


  db.users.findOne({'evernoteId': evernoteUserId}, function(error, user) {
    if (error) {
      console.log('Can not find user ' + userId);
      res.end('');
      return;
    }
    

    if (!(user && user.evernote && user.evernote.notebook)) {
      console.log('Can not find notebook');
      res.end('');      
      return;
    } else if (!connectedBlogEngine(user)) {
      console.log('Can not find connected blog engine.');
      res.end('');
      return; 
    }

    var notebook = user.evernote.notebook;

    if (reason == 'create') {
      createPostWithMetadata(user, noteGuid, notebook.guid, function(error, data){
        if (error) {
          console.log(error);
        };
      });
    } else if (reason == 'update') {
      updatePostWithMetadata(user, noteGuid, notebook.guid, function(error, data){
        if (error) {
          console.log(error);
        };
      });
    }

    res.end('', 200);      

  });
});


//test

app.get('/evernote/test/create', function(req, res){
  
  if(!req.session.user)
    return res.send('Please, provide valid authToken',401);

  db.users.findOne({evernoteId: req.session.evernoteUserId}, function(error, user) {
    if (error) {
      return res.send(error,500); 
    } else {
      return res.send(user,200);   
    }
  });

});


app.get('/me', function(req, res){
  
  if(!req.session.user)
    return res.send('Please, provide valid authToken',401);

  db.users.findOne({evernoteId: req.session.evernoteUserId}, function(error, user) {
    if (error) {
      return res.send(error,500); 
    } else {
      return res.send(user,200);   
    }
  });

});

server.listen(config.serverPort, function(){
  console.log("Express server listening on port " + config.serverPort)
})
