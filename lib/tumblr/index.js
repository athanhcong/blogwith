// View
var express = require("express");
var app = module.exports = express()
  , passport = require("passport")
  , TumblrStrategy = require('passport-tumblr').Strategy;


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

    console.log(oauthAccessToken);
    console.log(oauthAccessSecret);
    console.log(tumblrUser);


    var evernoteUserId = req.session.evernoteUserId;
    if (evernoteUserId) {

      var tumblrBlogs = tumblrUser.blogs;
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

  // console.log(req.user);
  // req.user.github = null;
  // console.log("github db: ");
  // console.log(app.db);
  var evernoteUserId = req.session.evernoteUserId;

  app.db.users.update({evernoteId: evernoteUserId}, {$unset: {'tumblr': 1}}, function(error) {
    console.log("Remove Tumblr for evernoteUserId: " + evernoteUserId);

    if (error) console.log('ERROR: ' + error);
    req.user.tumblr = null;
    return res.redirect('/');
  });

});
// var Blog = require('tumblr').Blog;
// var blog = new Blog('blog.tumblr.com', oauth);

// blog.text({limit: 2}, function(error, response) {
//     if (error) {
//         throw new Error(error);
//     }

//     console.log(response.posts);
// });

