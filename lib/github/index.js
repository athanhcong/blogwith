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

var enml = require('enml-js');
var md = require('html-md');

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

Repo.prototype.contentsCreate = function(filename, content, cb) {

  var path = '_posts/' + filename;

  var contentInBase64 = new Buffer(content).toString('base64');

  // console.log("GIT: /repos/" + this.name + "/contents/" + path);

  return this.client.put("/repos/" + this.name + "/contents/" + path, 
    {
      "message": "Create filename: " + path
      , "content": contentInBase64 
      // , "ref": "master"
    }
    , function(err, s, b) {
      // console.log(err);
      // console.log(s);
      // console.log(b);
      console.log("GIT: " +  path + " - Error: " + err + " Status: " + s + " - Body: " + b);

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

      // if (s !== 201) {
      //   return cb(new Error("Repo contents error"));
      // } else {
      return cb(null, b);
      // }
    });
};


Repo.prototype.createGithubPost = function(note, callback){

  var contentMarkdown = contentInMarkdown(note);
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
Repo.prototype.updateGithubPost = function(githubSha, note, callback) {

  var contentMarkdown = contentInMarkdown(note);
  var filename = filenameForJekyllPost(note);

  console.log('UpdateGithubPost: ' + filename + ' - SHA: ' + githubSha + ' \n' + contentMarkdown);

  this.contentsUpdate(filename, githubSha, contentMarkdown, function(err, data) {
    console.log("Git update: " + filename + " - Error: " + err + " - Data: " + data);
    // Save to database
    // Callback
    callback(err, data);
  });

};


var filenameForJekyllPost = function(note) {
  var title = note.title;

  var date = new Date(note.created);
  // var date = new Date();

  var titleFilename = title.toLowerCase().split(' ').join('-');
  var filename = date.getFullYear() + '-' + (date.getMonth() + 1).pad(2) + '-' + (date.getDay() + 1).pad(2) + '-' + titleFilename + '.md';

  // var timestamp = new Date().getTime();
  // filename = timestamp + '-' + filename;

  return filename;
}

var contentInMarkdown = function(note) {
  var contentHtml = enml.HTMLOfENML(note.content);
  var contentMarkdown = md(contentHtml);

  var title = note.title;
  contentMarkdown = '---\nlayout: post\ntitle: ' + title + '\n---\n' + contentMarkdown;

  return contentMarkdown;
}

