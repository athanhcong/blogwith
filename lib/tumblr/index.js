// View
var express = require("express");
var app = module.exports = express()
  , passport = require("passport")
  , TumblrStrategy = require('passport-tumblr').Strategy;



var Tumblr = require('tumblrwks');
var EvernoteLib = require('../evernote');

var url = require('url');

var config = new require('../../config.js')();

config.tumblrConsumerKey = 'MgEVdyzvHEKscLFkBwO5mglz19EDjzgRwGXTDt1hgkz658iAfy';
config.tumblrConsumerSecret = 'FhbEZ44CV6R7JXhFKT0RZUQM4CjrqvFi1ikdlGZCehMHHMkbTp';


//// Authentication


// Passport session setup.
//   To support persistent login sessions, Passport needs to be able to
//   serialize users into and deserialize users out of the session.  Typically,
//   this will be as simple as storing the user ID when serializing, and finding
//   the user by ID when deserializing.  However, since this example does not
//   have a database of user records, the complete Tumblr profile is serialized
//   and deserialized.
passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});



passport.use(new TumblrStrategy({
    consumerKey: config.tumblrConsumerKey,
    consumerSecret: config.tumblrConsumerSecret,
    callbackURL: config.serverUrl + '/tumblr/authentication/callback'
  },
  function(token, tokenSecret, profile, done) {
  	console.log('Done authentication with tumblr: ' + token);
  	// console.log(profile);
    profile.oauthAccessToken = token;
    profile.oauthAccessSecret = tokenSecret;
    // User.findOrCreate({ tumblrId: profile.id }, function (err, user) {
    return done(null, profile);
    // });
  }
));


app.configure(function(){

  //Use static files
  app.use(passport.initialize());
  // app.use(passport.session());
});

app.get('/tumblr/authentication', passport.authenticate('tumblr'));


app.get('/tumblr/authentication/callback', 
  passport.authenticate('tumblr', { failureRedirect: '/' }),
  function(req, res) {
    // Successful authentication, redirect home.

    console.log("github/authentication/callback");

    var tumblrUser = req.session.passport.user._json.response.user;




    var oauthAccessToken = req.session.passport.user.oauthAccessToken;
    var oauthAccessSecret = req.session.passport.user.oauthAccessSecret;

    // console.log(oauthAccessToken);
    // console.log(oauthAccessSecret);
    // console.log(tumblrUser);


    var evernoteUserId = req.session.evernoteUserId;
    if (evernoteUserId) {

      var tumblrBlogs = tumblrUser.blogs;
      for (var i = 0; i < tumblrBlogs.length; i++) {
        var blog = tumblrBlogs[i];
        console.log(blog);
        blog.host = url.parse(blog.url).host;
        console.log(blog.host);
      }


      var tumblrUserUpdate = {
        'tumblr.user' : tumblrUser
        , 'tumblr.oauthAccessToken' : oauthAccessToken
        , 'tumblr.oauthAccessSecret' : oauthAccessSecret
      };

      app.db.users.update({evernoteId: evernoteUserId}, {$set: tumblrUserUpdate}, {upsert: true}, function(error) {
        if (error) console.log('ERROR: ' + error);
        res.redirect('/');
      });
    } else {
      res.end('Oops, you haven\'t logged in with Evernote yet. How about go back and try it?');
    };

    
    
  });


app.get('/tumblr/unlink', function(req, res){

  if (!req.user) {
    res.end('Oops, you haven\'t logged in with Evernote yet. How about go back and try it?');
    return;
  };

  var evernoteUserId = req.session.evernoteUserId;

  app.db.users.update({evernoteId: evernoteUserId}, {$unset: {'tumblr': 1}}, function(error) {
    console.log("Remove Tumblr for evernoteUserId: " + evernoteUserId);

    if (error) console.log('ERROR: ' + error);
    req.user.tumblr = null;
    return res.redirect('/');
  });

});


app.get('/tumblr/blog/choose', function(req, res){

  if (!req.user) {
    res.end('Oops, you haven\'t logged in with Evernote yet. How about go back and try it?');
    return;
  };

  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;
  
  var host = query.host;


  var evernoteUserId = req.session.evernoteUserId;

  console.log('Receive chosen blog ' + host + ' for evernoteUserId ' + evernoteUserId);

  var chosenBlog = null;
  var tumblrBlogs = req.user.tumblr.user.blogs;
  for (var i = 0; i < tumblrBlogs.length; i++) {
    var blog = tumblrBlogs[i];
    if (blog.host == host) {
      chosenBlog = blog;
      break;
    };
  }

  if (chosenBlog) {
    app.db.users.update({evernoteId: evernoteUserId}, {$set: {'tumblr.blog': chosenBlog}}, function(error) {
      console.log("Choose Tumblog for evernoteUserId: " + evernoteUserId);
      if (error) console.log('ERROR: ' + error);

      return res.redirect('/#tumblr');
    });  
  } else {
    return res.redirect('/#tumblr');
  }

  

});




app.get('/tumblr/create', function(req, res){

  if (!req.user) {
    res.end('Oops, you haven\'t logged in with Evernote yet. How about go back and try it?');
    return;
  };


  app.createPost(req.user, null, function(error, data) {
    console.log("Done createPost");
  });
  

});




var tumblrWithData = function(tumblrData) {
  var oauth = {
    consumerKey: config.tumblrConsumerKey,
    consumerSecret: config.tumblrConsumerSecret,
    accessToken: tumblrData.oauthAccessToken,
    accessSecret: tumblrData.oauthAccessSecret
  };
  

  var tumblr = new Tumblr(oauth, tumblrData.blog.host);
  return tumblr;
}


app.createPost =  function(user, post, callback) {


  console.log('creating post: ' + JSON.stringify(post));
  var tumblr = tumblrWithData(user.tumblr);
  // console.log("createPost in host: " + blogHost + " with oauth: " + JSON.stringify(oauth));

  tumblr.post('/post', post, function(error, json){
    callback(error, json);
  });

};



// Evernote


var contentInMarkdown = function(user, evernoteNote, callback) {
  console.log('contentInMarkdown');

  var noteContent = EvernoteLib.contentInMarkdown(user, evernoteNote, []);
  callback(null, noteContent);
};


app.createPostWithNote =  function(user, evernoteNote, callback) {

  console.log(EvernoteLib.createdDateForNote);
  var createdDate = EvernoteLib.createdDateForNote(evernoteNote, user.timezoneOffset);

  console.log("createPostWithNote: " + evernoteNote.title + ' date: ' + createdDate.toUTCString());
  contentInMarkdown(user, evernoteNote, function(error, noteContent) {
    var tumblrPost = {
      title: evernoteNote.title
      , body: noteContent
      , type: 'text'
      , format:'markdown'
      , date : createdDate.toUTCString()
    }
    console.log('contentInMarkdown: callback');
    return app.createPost(user, tumblrPost, callback);
  });
};

app.updatePost = function(user, note, callback) {

};