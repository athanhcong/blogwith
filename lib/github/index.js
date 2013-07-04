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

var api = require('../../octonode')
  , url = require('url')
  , qs = require('querystring');

var Repo = api.repo;
var Client = api.client;

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

app.get('/github/authentication', function(req, res){
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



////// Utilities method /////



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

      if (err) {
        return cb(err);
      }

      return cb(null, b);
    });
};

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
        return cb(err);
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

  this.updateFile(path, sha, contentInBase64, cb);
  
};


Repo.prototype.createGithubPost = function(data, callback){
  var note = data.note

  var contentMarkdown = data.content;
  var filename = filenameForJekyllPost(note);

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
Repo.prototype.updateGithubPost = function(githubSha, data, callback) {

  var note = data.note;

  var contentMarkdown = data.content;

  var filename = filenameForJekyllPost(note);

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

var filenameForJekyllPost = function(note) {

  console.log("filenameForJekyllPost");
  // console.log(note);

  var title = note.title;
  var createdDate = note.created;


  var timezoneOffsetInMinisecond = 0;
  if (isNumber(note.timezoneOffset)) {
    timezoneOffsetInMinisecond = parseFloat(note.timezoneOffset) * 60000;
  } else if(note.timezone) {
    // TODO: handle timezone string, not so important now
  };

  console.log("createdDate: " + createdDate + " - ");

  console.log(note.timezoneOffset);

  console.log(note.timezone);
  console.log(timezoneOffsetInMinisecond);
  var date = new Date(createdDate + timezoneOffsetInMinisecond);

  console.log(date);

  // var date = new Date();

  // http://stackoverflow.com/a/2013332/192800
  var titleFilename = title.toLowerCase().split(' ').join('-');
  var filename = date.getUTCFullYear() + '-' + (date.getUTCMonth() + 1).pad(2) + '-' + date.getUTCDate().pad(2) + '-' + titleFilename;

  console.log(date.getUTCFullYear());

// test
  // var timestamp = new Date().getTime();
  // filename += timestamp;


  filename += '.md';
  return filename;
}

app.filenameForJekyllPost = filenameForJekyllPost;

Number.prototype.pad = function(size){
      if(typeof(size) !== "number"){size = 2;}
      var s = String(this);
      while (s.length < size) s = "0" + s;
      return s;
    }