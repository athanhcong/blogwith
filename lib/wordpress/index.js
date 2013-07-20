// View
var express = require("express");
var app = module.exports = express()
  , passport = require("passport")
  , WordpressStrategy = require('passport-wordpress').Strategy;



var config = new require('../../config.js')();


  var nodeEnv = process.env.NODE_ENV;
  if (nodeEnv == 'production') {
	config.wordpressClientId = '4739';
	config.wordpressClientSecret = 'IbpVWIVQ32X4cuEZOloaZ5Xo94c0blfegRhLSlkWwa699QamXEC1IeblukO1tHll';
  } else {
	config.wordpressClientId = '4740';
	config.wordpressClientSecret = 'rhDxnLojKKmXJDp2ShaNVQHg3NW31CmF68l2W4wNUeiVGcLHBZRz7OFskhqbNy4A';  	
  };




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


// 

passport.use(new WordpressStrategy({
    clientID: config.wordpressClientId,
    clientSecret: config.wordpressClientSecret,
    callbackURL: config.serverUrl + '/wordpress/authentication/callback'
  },
  function(accessToken, refreshToken, profile, done) {
  	console.log('Done authentication with WordPress.com: ' + accessToken);
  	console.log(profile);
    profile.oauthAccessToken = accessToken;
    profile.oauthRefreshToken = refreshToken;

    return done(null, profile);
  }
));


app.configure(function(){

  //Use static files
  app.use(passport.initialize());
  // app.use(passport.session());
});


app.get('/wordpress/hello', function(req, res) {
	res.end("Hello from BlogWith-Wordpress");
});

app.get('/wordpress/authentication', passport.authorize('wordpress'));

app.get('/wordpress/authentication/callback', 
  passport.authorize('wordpress', { failureRedirect: '/#evernote' }),
  function(req, res) {
    // Successful authentication, redirect home.

    console.log("wordpress/authentication/callback");

    var wordpressUser = req.session.passport.user._json;

    var oauthAccessToken = req.session.passport.user.oauthAccessToken;
    var oauthAccessSecret = req.session.passport.user.oauthAccessSecret;

    console.log(oauthAccessToken);
    console.log(oauthAccessSecret);
    console.log(wordpressUser);
    // console.log(req.session.passport.user);


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
        res.redirect('/#tumblr');
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