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

var api = require('octonode')
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
        res.end('');
        return;
      };
      
      app.authenticationCallback(req, res, err, token);
      
    });
  // }
});

app.authenticationCallback = function(req, res, data, token) {};
