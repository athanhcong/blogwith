var config = {}

var nodeEnv = process.env.NODE_ENV;
if (nodeEnv == 'production') {
    config['githubClientId'] = '1144e0f6ba3889d04621';
    config['githubClientSecret'] = '910f3c346e97c8bdfccbb9001d7b010f1ce6a0e3';
} else {
    config['githubClientId'] = 'd40e218e245efc6cedb1';
    config['githubClientSecret'] = 'a026298fd821e95083fe4a1c9e640494088e741c';
};

// View
var express = require("express");
var app = module.exports = express();

var api = require('./octonode')
  , url = require('url')
  , qs = require('querystring');

var flow = require('flow');

var Repo = api.repo;
var Client = api.client;

var EvernoteLib = require('../evernote');

app.apiClient = function() {

  return api.client({
    id: config.githubClientId,
    secret: config.githubClientSecret
  });
}

// Build the authorization config and url
var auth_url = api.auth.config({
  id: config.githubClientId,
  secret: config.githubClientSecret
}).login(['user', 'repo', 'gist']);


// Store info to verify against CSRF
var state = auth_url.match(/&state=([0-9a-z]{32})/i);

app.db = null;

app.get('/github/authentication', function(req, res){

  if (!req.user) {
    res.end('Oops, you haven\'t logged in with Evernote yet. How about go back and try it?');
    return;
  };

  console.log(req.user);
  console.log("github/authentication");


  res.writeHead(301, {'Content-Type': 'text/plain', 'Location': auth_url})
  res.end('Redirecting to ' + auth_url);
});

app.get('/github/authentication/callback', function(req, res){
  console.log("github/authentication/callback");

  

  var uri = url.parse(req.url);
  var values = qs.parse(uri.query);
  // Check against CSRF attacks
  // if (!state || state[1] != values.state) {
  //   res.writeHead(403, {'Content-Type': 'text/plain'});
  //   res.end('');
  // } else {
    api.auth.login(values.code, function (err, token) {
      console.log("github/authentication/callback " + err + ' ' + token);
      // res.writeHead(200, {'Content-Type': 'text/plain'});
      if (err) { 
        res.writeHead(403, {'Content-Type': 'text/plain'});
        res.end('');
        return;
      };
      
      app.authenticationCallback(req, res, err, token);
      
    });
  // }
});

app.authenticationCallback = function(req, res, data, token) {};



app.get('/github/unlink', function(req, res){

  if (!req.user) {
    res.end('Oops, you haven\'t logged in with Evernote yet. How about go back and try it?');
    return;
  };

  // console.log(req.user);
  // req.user.github = null;
  // console.log("github db: ");
  // console.log(app.db);
  var evernoteUserId = req.session.evernoteUserId;


  app.db.users.update({evernoteId: evernoteUserId}, {$unset: {'github': 1}}, function(error) {
    console.log("Remove Github for evernoteUserId: " + evernoteUserId);

    if (error) console.log('ERROR: ' + error);
    req.user.github = null;
    return res.redirect('/');
  });

});


////// Utilities method /////


app.repoWithUser = function(user, callback) {
  var githubPageData = user.github.apiData;
  var githubUsername = githubPageData.login;

  githubRepoName = githubUsername + '/' + githubPageData.repoName;

  var _ghClient = app.apiClient();
  _ghClient.token = githubPageData.authToken;
  var _ghRepo = _ghClient.repo(githubRepoName);

  callback(null, _ghRepo);
};





Repo.prototype.createFile = function(path, contentInBase64, cb) {

  // console.log("GIT: /repos/" + this.name + "/contents/" + path);
  var filePath = "/repos/" + this.name + "/contents/" + path;
  this.client.put(filePath, 
    {
      "message": "Create filename: " + path
      , "content": contentInBase64 
      // , "ref": "master"
    }
    , function(err, s, b) {
      // console.log(err);
      // console.log(s);
      // console.log(b);
      console.log("GIT: " +  path + " - Error: " + err + " Status: " + s + " - Body: " + JSON.stringify(b));


      if (s !== 201) {
        return cb(new Error(s));
      } else {
        return cb(null, b.content);
      }
    });
};

Repo.prototype.updateFile = function(path, sha, contentInBase64, cb) {

  return this.client.put("/repos/" + this.name + "/contents/" + path, 
    {
      "message": "Update filename: " + path
      , "content": contentInBase64
      , "sha" : sha
    }
    , function(err, s, b) {
      // console.log(err);
      // console.log(s);
      // console.log(b);
      console.log("GIT: " +  path + " - Error: " + err + " Status: " + s + " - Body: " + b);

      if (s !== 200) {
        return cb(new Error(s));
      } else {
        return cb(null, b.content);  
      }

      
    });
};


// TODO: name need to be related to Path
Repo.prototype.createFileOrRetrieve = function(path, contentInBase64, cb) {

  var repo = this;


  repo.createFile(path, contentInBase64, function(error, file) {
    if (error) {
      if (error.message == '422') {

        // var filePath = "repos/" + repo.name + "/contents/" + path;

        file = {path: path};
        
        console.log("File exist at path: " + path);

        return cb (null, file);
      } else {
        return cb(err);
      }

    } else {
      cb(null, file);
    }

  });

  // var getFile = function() {
  //   console.log("File exist. Get file at path: " + filePath);

  //   repo.client.get(filePath
  //     , function(err, s, b) {

  //       //console.log("GIT: " +  path + " - Error: " + err + " Status: " + s + " - Body: " + b);
  //       console.log("GIT: " +  path + " - Error: " + err + " Status: " + s + " - Body: " + JSON.stringify(b));        
  //       if (err) {
  //         return cb(new Error(s));
  //       } else {
  //         return cb(null, b);
  //       }
  //     }
  //   );
  // }
};


Repo.prototype.createFileOrUpdate = function(path, contentInBase64, cb) {

  var repo = this;

  repo.createFile(path, contentInBase64, function(error, file) {
    if (error) {
      if (error.message == '422') {

        console.log("File exist at path: " + path);

        getFileShaThenUpdate();
      } else {
        return cb(error);
      }

    } else {
      cb(null, file);
    }

  });

  var getFileShaThenUpdate = function() {
    var contentPath = "/repos/" + repo.name + "/contents/" + path;
    repo.client.get(contentPath
      , function(err, s, b) {

        //console.log("GIT: " +  path + " - Error: " + err + " Status: " + s + " - Body: " + b);
        console.log("GIT: " +  path + " - Error: " + err + " Status: " + s + " - Body: " + JSON.stringify(b));        
        if (err) {
          return cb(new Error(s));
        } else {
          var sha = b.sha;
          console.log("GIT: got SHA: ", sha);        

          return repo.updateFile(path, sha, contentInBase64, cb);
        }
      }
    );
  }
};

Repo.prototype.createFileWithText = function(path, content, cb) {

  var contentInBase64 = new Buffer(content).toString('base64');

  // console.log("GIT: /repos/" + this.name + "/contents/" + path);
  this.createFile(path, contentInBase64, cb);  
};

Repo.prototype.createBlob = function(content, encoding, callback) {

  // var contentInBase64 = new Buffer(content).toString('base64');

  // console.log("GIT: /repos/" + this.name + "/contents/" + path);

  return this.client.put("/repos/" + this.name + "/git/blobs/", 
    {
      "content": content 
    , "encoding": "base64"
    }
    , function(err, s, b) {
      // console.log(err);
      // console.log(s);
      // console.log(b);
      console.log("GIT: " +  path + " - Error: " + err + " Status: " + s + " - Body: " + b);

      if (err) {
        return callback(err);
      }

      if (s !== 201) {
        return callback(new Error("Repo contents error with status: " + s));
      } else {
        return callback(null, b);
      }
    });
};

Repo.prototype.contentsCreate = function(filename, content, cb) {

  var path = '_posts/' + filename;

  var contentInBase64 = new Buffer(content).toString('base64');

  // console.log("GIT: /repos/" + this.name + "/contents/" + path);
  return this.createFileOrUpdate(path, contentInBase64, cb);
};

Repo.prototype.contentsUpdate = function(filename, sha, content, cb) {

  var path = '_posts/' + filename;

  var contentInBase64 = new Buffer(content).toString('base64');

  var repo = this;
  repo.updateFile(path, sha, contentInBase64, function(error, data) {

    if (error) {
      if (error.message == '409') {

        console.log("File exist at path: " + path);

        getFileShaThenUpdate();
      } else {
        return cb(error);
      }

    } else {
      cb(null, data);
    }

  });

  var getFileShaThenUpdate = function() {
    var contentPath = "/repos/" + repo.name + "/contents/" + path;
    repo.client.get(contentPath
      , function(err, s, b) {

        //console.log("GIT: " +  path + " - Error: " + err + " Status: " + s + " - Body: " + b);
        console.log("GIT: " +  path + " - Error: " + err + " Status: " + s + " - Body: " + JSON.stringify(b));        
        if (err) {
          return cb(new Error(s));
        } else {
          var sha = b.sha;
          console.log("GIT: got SHA: ", sha);        

          return repo.updateFile(path, sha, contentInBase64, cb);
        }
      }
    );
  }
};


Repo.prototype.createGithubPost = function(user, data, callback){
  var note = data.note

  var contentMarkdown = data.content;
  var filename = filenameForJekyllPost(user, note);

  console.log('CreateGithubPost: ' + filename + ' \n' + contentMarkdown);

  this.contentsCreate(filename, contentMarkdown, function(err, data) {
    console.log("Git create: " + filename + " - Error: " + err + " - Data: " + data);
    // console.log("error: " + err);
    // console.log("data: " + JSON.stringify(data));

    // Callback
    callback(err, data);
  });
};



// Update a file in github
Repo.prototype.updateGithubPost = function(user, githubSha, data, callback) {

  var note = data.note;

  var contentMarkdown = data.content;

  var filename = filenameForJekyllPost(user, note);

  console.log('UpdateGithubPost: ' + filename + ' - SHA: ' + githubSha + ' \n' + contentMarkdown);

  this.contentsUpdate(filename, githubSha, contentMarkdown, function(err, data) {
    console.log("Git update: " + filename + " - Error: " + err + " - Data: " + data);
    // Save to database
    // Callback
    callback(err, data);
  });

};


function isNumber(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

app.filenameForJekyllPost = filenameForJekyllPost = function(user, note) {

  console.log("filenameForJekyllPost");
  // console.log(note);

  var title = note.title;

  var date = EvernoteLib.createdDateForNote(note, user.timezoneOffset);

  console.log(date);

  // var date = new Date();

  // http://stackoverflow.com/a/2013332/192800
  var titleFilename = safeFileName(title);
  var filename = date.getUTCFullYear() + '-' + (date.getUTCMonth() + 1).pad(2) + '-' + date.getUTCDate().pad(2) + '-' + titleFilename;

  console.log(date.getUTCFullYear());

// test
  // var timestamp = new Date().getTime();
  // filename += timestamp;


  filename += '.md';
  return filename;
}

Number.prototype.pad = function(size){
  if(typeof(size) !== "number"){size = 2;}
  var s = String(this);
  while (s.length < size) s = "0" + s;
  return s;
};


/////////// RESOURCES & CONTENT in Markdown

var fileContentInMarkdown = function(userInfo, evernoteNote, resourceUrls) {
  var contentMarkdown = EvernoteLib.contentInMarkdown(userInfo, evernoteNote, resourceUrls);

  var title = evernoteNote.title;
  fileContentMarkdown = '---\nlayout: post\ntitle: ' + title + '\n---\n' + contentMarkdown;

  return fileContentMarkdown;
}

app.contentInMarkdown = contentInMarkdown = function(user, evernoteNote, callback) {
  uploadResources(user, evernoteNote, function(error, resources) {


    if (!error && resources) {
      // process the resource
      var noteContent = fileContentInMarkdown(user, evernoteNote, resources);
      // console.log("contentInMarkdown" + noteContent);
      callback(null, noteContent);
    } else {
      callback (error);
    }

  });
}


var safeFileName = function(string) {
  var safeString = string.replace(/[^A-Za-z 0-9]*/g, '').trim();
  safeString = safeString.toLowerCase().split(' ').join('-');
  return safeString;
}

var uploadAResource = function (user, note, evernoteResource, callback) {
  var noteStore = EvernoteLib.Client(user.evernote.oauthAccessToken).getNoteStore();

  noteStore.getResourceData(user.evernote.oauthAccessToken, evernoteResource.guid, 
    function onsuccess(fileData) {

      console.log("Got resource: " + fileData + " Length: " + fileData.byteLength);

      // Send to github
      var fileDataBase64 = new Buffer(fileData).toString('base64');
      // console.log(fileDataBase64);

      app.repoWithUser(user, function(err, repo) {
        if (err) {
          console.log("Get Resouce error : " + err);

          callback(err);
          return;
        };



        console.log('Repo: ' + repo.name + " Token: " + repo.client.token);


        var resourceFilename = safeFileName(evernoteResource.attributes.fileName | evernoteResource.guid);
        var path = "images/" + note.guid + "/" 
        // + new Date().getTime() + "/" 
        + resourceFilename;


        console.log('createFile: ' + path);

        repo.createFileOrRetrieve(path, fileDataBase64, function(error, data) {

          

          if (error) {
            console.log("uploaded file error:" + error);          

            callback(error);
          } else {
            console.log("uploaded file: " + data.name);
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

var uploadResourceIfNeeded = function(user, note, evenoteResource, callback) {
    // Check for cached resource info

  app.db.resources.findOne({evernoteGuid: evenoteResource.guid}, function(error, resource) {
    if( !error && resource && resource.github) {
      console.log("Found resource: " + resource.github);
      callback(null, resource);
      return;
    } else {

      // Not found, then:
      // Get resource data
      // NoteStoreClient.prototype.getResourceData = function(authenticationToken, guid, callback)

      console.log("Not Found resource: " + user.evernote.oauthAccessToken + " xx " + evenoteResource.guid);

      uploadAResource(user, note, evenoteResource, function(error, githubResource) {
        console.log(" ");

        if (!error && githubResource) {
          var resource = {
            'github': {
              'file': githubResource
            }
            , 'evernote' : {
              'resource' :evenoteResource
            }
            , 'evernoteGuid' : evenoteResource.guid
          };

          app.db.resources.update({evernoteGuid: evenoteResource.guid}, {$set: resource}, {upsert: true}, function(error) {
            if (error) console.log('ERROR: ' + error);
            callback(error, resource);
          });
        } else {
          callback(error, null);
        };

      });
    }
  });
}

var uploadResources = function(user, note, callback) {

  var evernoteResources = note.resources;

  if (evernoteResources) {
    console.log("uploadResources: " + evernoteResources.length);  
  } else {
    return callback(null, []);
  };
  

  // resource = resources[0];
  // uploadResourceIfNeeded(user, note, resource, function() {});

  var uploadedResources = [];
  flow.serialForEach(evernoteResources, 
    function(evernoteResource) {
      uploadResourceIfNeeded(user, note, evernoteResource, this);
    }
    , function(error, resource) {

        if (!error && resource && resource.github && resource.github.file.path) {
          console.log("Finish uploadResourceIfNeeded: " + resource.github.file.path);  

          var githubUrl = "/" + resource.github.file.path;
          uploadedResources[resource.evernoteGuid] = githubUrl;
        } else {
          console.log("Finish uploadResourceIfNeeded: ERROR: " + error + "DATA: " + JSON.stringify(resource));  
        };


        console.log("uploadResourceIfNeeded: ");
        console.log(uploadedResources);
    }

    , function () {
      console.log("Finished uploadResources flow: ");
      console.log(uploadedResources);
      callback(null, uploadedResources);
    }
  );
}



// CREATE POST

app.createPostWithNote = createPostWithNote = function(user, evernoteNote, callback) {

  if (!user.github) {
    console.log("WARNING: Not connected with Github");
    return;
  }

  var userId = user.evernoteId;
  app.repoWithUser(user, function(err, repo) {

    if (err) {
      callback(err);
      return;
    };

    console.log('Repo: ' + repo.name + " Token: " + repo.client.token);

    app.contentInMarkdown(user, evernoteNote, function (error, noteContent) {
      if (!error && noteContent) {
        console.log(noteContent);
        repo.createGithubPost(user, {note: evernoteNote, content: noteContent}, function(err, githubPost) {

          // Save to database
          if (err) {
            console.log(err);
            callback(err); 

          } else if (githubPost) { // check for sha, should have sha!!!!!!
            var post = {
              'evernoteUserId': user.evernoteId
              , 'evernoteGuid' : evernoteNote.guid
              , 'evernote.note' : evernoteNote
              , 'github.file' : githubPost 
              , 'evernoteUpdated' : evernoteNote.updated
              , 'updated' : new Date()
            };

            app.db.posts.update({evernoteGuid: evernoteNote.guid}, {$set: post}, {upsert: true}, function(error) {
              if (error) console.log('ERROR: ' + error);
              callback (error, post);
            });
          };


        });
      };
    })


  });
};


// Update a file in github
var updatePostWithNoteAndSha = function(user, githubSha, evernoteNote, callback){

  if (!user.github) {
    console.log("WARNING: Not connected with Github");
    return;
  }

  app.repoWithUser(user, function(err, repo) {
    if (err) {
      callback(err);
      return;
    };

    console.log('Repo: ' + repo.name + " Token: " + repo.client.token);

    app.contentInMarkdown(user, evernoteNote, function (error, noteContent) {
      if (!error && noteContent) {

        repo.updateGithubPost(user, githubSha, {note: evernoteNote, content: noteContent} , function(err, githubPost) {
          // Save to database
          if (err) {
            console.log(err);
            callback(err); 

          } else if (githubPost) {
            var post = {
              'evernoteUserId': user.evernoteId
              , 'evernoteGuid' : evernoteNote.guid
              , 'evernote.note' : evernoteNote
              , 'github.file' : githubPost 
              , 'evernoteUpdated' : evernoteNote.updated
              , 'updated' : new Date()
            };

            app.db.posts.update({evernoteGuid: evernoteNote.guid}, {$set: post}, {upsert: true}, function(error) {
              if (error) console.log('ERROR: ' + error);
              callback (error, post);
            });
          };

        });
      }
    });
  });
};


app.updatePostWithNote = updatePostWithNote = function(user, post, evernoteNote, callback) {

  var sha;

  if (post.github && post.github.file) {
    sha = post.github.file.sha;
  };
  if (sha) {
    return updatePostWithNoteAndSha(user, sha, evernoteNote, callback);  
  } else {
    console.log('Not found sha for updating');
    return createPostWithNote(user, evernoteNote, callback);
  }
  
}