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
var collections = ["users", "posts"]
var db = mongojs(config.mongoConnectionString, collections);


///////// EVERNOTE
var Evernote = require('evernote').Evernote;
var EvernoteLib = require('./lib/evernote')

var GithubLib = require('./lib/github')
  , url = require('url');


var flow = require('flow');

//Setup ExpressJS
app.configure(function(){

  //Use static files
  app.set('views', __dirname + '/views');
  // app.engine('html', require('ejs').renderFile);
  app.set('view engine', 'html');
  app.engine('html', require('hbs').__express);

	app.use(express.cookieParser()); 
	app.use(express.bodyParser());



  app.use(session);


  app.use(function(req, res, next){

    res.locals.session = req.session;

    if (req.session.evernoteUserId && !req.user) {
      db.users.findOne({evernoteUserId: req.session.evernoteUserId}, function(error, user) {
        if (error) {
          console.log('requesting note found' + req.session.evernoteUserId);
          req.session.evernoteUserId = null;
        } else {
          // console.log('requesting ' + user.evernoteUserId);
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

});


//===================================================
//								 			ETC
//===================================================

// Welcom Page
app.get('/', function(req, res){
	
  console.log("app.get / " + req.session.evernoteUserId);

	if(!req.user) //Unauthenticate User
		return res.render("index.html");


  var indexPageData = {};
  if (req.user.evernote && req.user.evernote.user) {
    indexPageData.evernoteUser = req.user.evernote.user;  
  };
  
  if (req.user.github && req.user.github.user) {
    indexPageData.githubUser = req.user.github.user;
  };  
  
  return res.render("index.html", indexPageData);    

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

  db.users.update({evernoteUserId: userId}, {$set: {
    'evernote.user': evernoteUser
    , 'evernote.oauthAccessToken': token
    , 'timezoneOffset': req.session.userTimezoneOffset}}, {upsert: true}, function(err, updated) {

      if( err || !updated ) console.log("User not updated" + err);
      else console.log("User updated");

      updateUserNotebook(req, res);
  });
}

GithubLib.authenticationCallback = function(req, res, err, token) {
  console.log("Github Callback to Express");

  var userId = req.session.evernoteUserId;


  db.users.update({evernoteUserId: userId}, {$set: {'github.oauthAccessToken': token}}, {upsert: true}, function(error) {
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

      db.users.update({evernoteUserId: userId}, {$set: {'github.user': data}}, {upsert: true}, function(error) {
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

            db.users.update({evernoteUserId: userId}, {$set: {'github.repository': foundRepo, 'github.apiData': apiData}}, {upsert: true}, function(error) {
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



var updateUserNotebook = function(req, res) {



  // redisClient.set('users:' + req.session.evernoteUserId + ':evernote:user', JSON.stringify(req.session.user));

  // console.log('users:' + req.session.evernoteUserId + ':evernote:user');

  // var result = redisClient.get('users:' + req.session.evernoteUserId + ':evernote:user', function(err, data){
  //   console.log('redis get: ' + data);
  // });

  if(!req.session.user) return res.send('Unauthenticate',401);


  var userInfo = req.session.user;
  var userId = req.session.evernoteUserId;

  console.log("/evernote/create-notebook: " + userId);

  // Create notebook
  var notebookName = "Blog with Evernote";
  var noteStore = EvernoteLib.Client(req.session.oauthAccessToken).getNoteStore();

  var createNotebook = function() {

    var notebookPublishing = new Evernote.Publishing(
      {
        publicDescription: "Blog with Evernote"
        , uri : "blog-with-evernote"
      });

    var notebook = new Evernote.Notebook({
      name: notebookName
      , published : true
      , publishing : notebookPublishing
    });

    var noteStore1 = EvernoteLib.Client(req.session.oauthAccessToken).getNoteStore();
    noteStore1.createNotebook(req.session.oauthAccessToken, notebook, 
      function onsuccess(data) {
        console.log("Created Notebook: Guid " + data.guid);

        redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
        
        return res.redirect('/');
      },
      function onerror(error) {
        console.log("Creating Notebook: Error " + error);
        res.send(error,500);
        
      });
  }
  // end createNotebook

  var updateNotebook = function(notebook) {

    var notebookPublishing = new Evernote.Publishing(
      {
        publicDescription: "Blog with Evernote"
        , uri : "blog-with-evernote"
      });

    notebook.published = true;
    notebook.publishing = notebookPublishing;

    var noteStore1 = EvernoteLib.Client(req.session.oauthAccessToken).getNoteStore();
    noteStore1.updateNotebook(req.session.oauthAccessToken, notebook, 
      function onsuccess(data) {
        console.log("Updated Notebook: Guid " + data.guid);
        redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
        
        return res.redirect('/');
      },
      function onerror(error) {
        console.log("Update Notebook: Error " + error);
        res.send(error,500);
        
      });
  }
  // end createNotebook

  var createNotebookIfNeeded = function() {
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

  var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, notebookData){
    if (notebookData) {
      var notebook = JSON.parse(notebookData);
      console.log("Notebook: " + JSON.stringify(notebook));
      console.log(req.session.oauthAccessToken);
      //NoteStoreClient.prototype.getNotebook = function(authenticationToken, guid, callback) {
      noteStore.getNotebook(req.session.oauthAccessToken, notebook.guid, 
        function(serverNotebook) {
          console.log("Get Notebook: " + JSON.stringify(serverNotebook));
          // update notebook info
          if (serverNotebook.published) {
            redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
            return res.redirect('/');
          } else {
            //NoteStoreClient.prototype.updateNotebook = function(authenticationToken, notebook, callback) {
            console.log("Updating notebook");
            updateNotebook(serverNotebook);
          };
          
        },
        function onerror(error) {
          console.log("Get Notebook: Error " + error); 
          // if (error instanceof Evernote.EDAMNotFoundException) {
            // console.log("Not found Notebook");

            createNotebookIfNeeded();
          // } else {
            
            // res.send(error,500);  
          // }
        }
      );

      // return res.redirect('/');
    } else {

      createNotebookIfNeeded(); 
    }

  });
}

app.get('/evernote/create-notebook', updateUserNotebook);


// app.get('/evernote/sync', function(req, res){
//   console.log("/evernote/create-notebook");

//   if(!req.session.user) return res.send('Unauthenticate',401);
//   if(!req.body) return res.send('Invalid content',400);

//   // Check notebook
//   var userId = req.session.evernoteUserId;
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


  var userId = req.session.evernoteUserId;



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

        syncNotesMetadata(req, res, noteList, function(err, data){
          return res.send(noteList,200);
        });
      }
    });

  });


  var syncNotesMetadata = function(req, res, notesMetadata, cb) {
    console.log('syncNotesMetadata');

    // Get old notesMetadata
    var userId = req.session.evernoteUserId;

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
          // checkUpdateForPost(userInfo, newNotes[0], this);
          // var note = newNotes[0];
          // console.log(note.guid);
          // updatePostWithMetadata(userInfo, note.guid, null, function(error, data) {

          // });
          // return;
          
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
  console.log("createPostWithMetadata" + noteGuid);
  //getNote = function(authenticationToken, guid, withContent, withResourcesData, withResourcesRecognition, withResourcesAlternateData, callback) {
  noteStore.getNote(userInfo.oauthAccessToken, noteGuid, true, false, false, false, function(note) {
    console.log('Get note for creating: - Note: ' + note.title);
    // console.log('Get note for creating: - Note: ' + JSON.stringify(note));

    if (validateWithNotebookGuid && note.notebookGuid != validateWithNotebookGuid) {
      console.log("Validate notebook failed! " + note.notebookGuid + " vs " + validateWithNotebookGuid);
      callback("Validate notebook failed!");
      return;
    };

    note.timezoneOffset = userInfo.timezoneOffset;
    note.timezone = userInfo.timezone;

    createGithubPost(userInfo, note, function(error, data) {
      callback(error, data);
    });



  }, function onerror(error) {
    // console.log("createPostWithMetadata" + error);
    // callback(error);
  });
}

var updatePostWithMetadata = function(userInfo, noteGuid, validateWithNotebookGuid, callback) {
  console.log('updatePostWithMetadata ' + noteGuid);

  // console.log(userInfo);

  var noteStore = EvernoteLib.Client(userInfo.oauthAccessToken).getNoteStore();

  noteStore.getNote(userInfo.oauthAccessToken, noteGuid, true, false, false, false, function(note) {
    
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
        updateGithubPost(userInfo, sha , note, function(err, data) {
          console.log(err);
          callback(err, data);
        });          
      } else {
        console.log('Can not find github sha. Create instead');
        note.timezoneOffset = userInfo.timezoneOffset;
        note.timezone = userInfo.timezone;
        createGithubPost(userInfo, note, function(err, data) {
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

  var userId = req.session.evernoteUserId;

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


var contentInMarkdown = function(userInfo, note, callback) {
  uploadResources(userInfo, note, function(error, resources) {


    if (!error && resources) {
      // process the resource
      var noteContent = EvernoteLib.contentInMarkdown(userInfo, note, resources);
      // console.log("contentInMarkdown" + noteContent);
      callback(null, noteContent);
    } else {
      callback (error);
    }

  });
}

var createGithubPost = function(userInfo, note, callback){

  var userId = userInfo.id;
  githubRepoWithUserId(userId, function(err, repo) {

    if (err) {
      callback(err);
      return;
    };

    console.log('Repo: ' + repo.name + " Token: " + repo.client.token);

    contentInMarkdown(userInfo, note, function (error, noteContent) {
      if (!error && noteContent) {
        console.log(noteContent);
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
      };
    })


  });
};


var uploadAResource = function (userInfo, note, resource, callback) {
  var noteStore = EvernoteLib.Client(userInfo.oauthAccessToken).getNoteStore();

  noteStore.getResourceData(userInfo.oauthAccessToken, resource.guid, 
    function onsuccess(fileData) {

      console.log("Got resource: " + fileData);
      console.log("Got resource: " + JSON.stringify(fileData));

      // Send to github
      var fileDataBase64 = new Buffer(fileData).toString('base64');
      // console.log(fileDataBase64);

      githubRepoWithUserId(userInfo.id, function(err, repo) {
        if (err) {
          console.log("Get Resouce error : " + err);

          callback(err);
          return;
        };



        console.log('Repo: ' + repo.name + " Token: " + repo.client.token);

        // var noteContent = EvernoteLib.contentInMarkdown(userInfo, note);
        var path = "images/" + note.guid + "/" 
        // + new Date().getTime() + "/" 
        + resource.attributes.fileName;


        console.log('createFile: ' + path);

        repo.createFile(path, fileDataBase64, function(error, data) {

          console.log("uploaded file error:" + error);          
          console.log("uploaded file" + JSON.stringify(data));

          if (error) {
            callback(error);
          } else {

            callback(null, data);

          };
          // Handle Error
          
          
        });

      });

      //contentsCreate
    },
    function onerror(error) {
      console.log("Get Resouce error : " + error);
      callback(error);
    });
}

var uploadResourceIfNeeded = function(userInfo, note, resource, callback, next) {
    // Check for cached resource info

  var resourceUrlKey = 'users:' + userInfo.id + ':posts:' + note.guid + ':resources:' + resource.guid + ':githubContent';

  console.log("uploadResourceIfNeeded " + resourceUrlKey);

  console.log("key: " + resourceUrlKey);
  redisClient.get(resourceUrlKey, function(error, data) {

    if (!error && data) {
      var githubResource = JSON.parse(data);
      console.log("Found resource: " + githubResource.content.path);
      callback(null, githubResource);
      next();
      return;
    }

    // Not found, then:
    // Get resource data
    // NoteStoreClient.prototype.getResourceData = function(authenticationToken, guid, callback)

    console.log("Not Found resource: " + userInfo.oauthAccessToken + " xx " + resource.guid);

    uploadAResource(userInfo, note, resource, function(error, data) {
      console.log("uploadAResource");

      if (!error && data) {
        redisClient.set(resourceUrlKey, JSON.stringify(data));
      };

      callback(error, data);
      next();


    });

    // Resource name for resource
    // send resource to github

    // save resource info


    
  });
}

var uploadResources = function(userInfo, note, callback) {

  var resources = note.resources

  if (resources) {
    console.log("uploadResources: " + resources.length);  
  };
  

  // resource = resources[0];
  // uploadResourceIfNeeded(userInfo, note, resource, function() {});

  var uploadedResources = [];
  flow.serialForEach(resources, 
    function(resource) {
      uploadResourceIfNeeded(userInfo, note, resource, function(error, data) {
        
        if (!error && data && data.content && data.content.path) {
          // console.log(data);
          var githubUrl = "/" + data.content.path;
          uploadedResources[resource.guid] = githubUrl;  
        };
        console.log("uploadResourceIfNeeded: ");
        console.log(uploadedResources);
      }, this);
    }
    , function (error) {
      console.log("this is weird");
    }
    , function () {
      console.log("Finished uploadResources flow: ");
      console.log(uploadedResources);
      callback(null, uploadedResources);
    }
  );

}

// Update a file in github
var updateGithubPost = function(userInfo, githubSha, note, callback){

  var userId = userInfo.id;
  githubRepoWithUserId(userId, function(err, repo) {
    if (err) {
      callback(err);
      return;
    };

    console.log('Repo: ' + repo.name + " Token: " + repo.client.token);

    contentInMarkdown(userInfo, note, function (error, noteContent) {
      if (!error && noteContent) {

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
      }
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

  db.users.findOne({evernoteUserId: req.session.evernoteUserId}, function(error, user) {
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
