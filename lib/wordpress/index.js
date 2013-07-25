// View
var express = require("express");
var app = module.exports = express()
  , passport = require("passport")
  , WordpressStrategy = require('./passport-wordpress').Strategy;

var OAuth2 = require('oauth').OAuth2;

var config = new require('../../config.js')();


  var nodeEnv = process.env.NODE_ENV;
  if (nodeEnv == 'production') {
	config.wordpressClientId = '4739';
	config.wordpressClientSecret = 'IbpVWIVQ32X4cuEZOloaZ5Xo94c0blfegRhLSlkWwa699QamXEC1IeblukO1tHll';
  } else {
	config.wordpressClientId = '4740';
	config.wordpressClientSecret = 'rhDxnLojKKmXJDp2ShaNVQHg3NW31CmF68l2W4wNUeiVGcLHBZRz7OFskhqbNy4A';  	
  };

var marked = require('marked');

var EvernoteLib = require('../evernote');

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

app.get('/wordpress/authentication', passport.authenticate('wordpress'));

app.get('/wordpress/authentication/callback', 
  passport.authenticate('wordpress', { failureRedirect: '/#evernote' }),
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

      // var tumblrBlogs = tumblrUser.blogs;
      // for (var i = 0; i < tumblrBlogs.length; i++) {
      //   var blog = tumblrBlogs[i];
      //   console.log(blog);
      //   blog.host = url.parse(blog.url).host;
      //   console.log(blog.host);
      // }




      // check for existen of site
      var siteUrl = wordpressUser.meta.links.site;
      console.log('Calling: ' + siteUrl);

      wpGet(siteUrl, oauthAccessToken, function(error, data) {


        if (error) {
          res.end('Error happen, please try again');
          return;
        };

        var blog = JSON.parse(data);


        var wordpressUserUpdate = {
          'wordpress.user' : wordpressUser
          , 'wordpress.blog' : blog
          , 'wordpress.oauthAccessToken' : oauthAccessToken
          , 'wordpress.oauthAccessSecret' : oauthAccessSecret
        };
        console.log(wordpressUserUpdate);

        app.db.users.update({evernoteId: evernoteUserId}, {$set: wordpressUserUpdate}, {upsert: true}, function(error) {
          if (error) console.log('ERROR: ' + error);
          res.redirect('/#wordpress');
        });
          
      });


    } else {
      res.end('Oops, you haven\'t logged in with Evernote yet. How about go back and try it?');
    };
    //https://public-api.wordpress.com/rest/v1/sites/7552114
    
    
  });


app.get('/wordpress/unlink', function(req, res){

  if (!req.user) {
    res.end('Oops, you haven\'t logged in with Evernote yet. How about go back and try it?');
    return;
  };

  var evernoteUserId = req.session.evernoteUserId;

  app.db.users.update({evernoteId: evernoteUserId}, {$unset: {'wordpress': 1}}, function(error) {
    console.log("Remove Wordpress for evernoteUserId: " + evernoteUserId);

    if (error) console.log('ERROR: ' + error);
    req.user.tumblr = null;
    return res.redirect('/');
  });
});



var wpGet = function(url, oauthAccessToken, callback) {
  var oa = new OAuth2({
    clientId: config.wordpressClientId,
    clientSecret: config.wordpressClientSecret
  });
  // wordpress._oauth2.get(siteUrl, oauthAccessToken, function(error, data) {
  //   console.log(error);
  //   console.log(data); 
  //   res.send(data, 200);

  // });

  oa.useAuthorizationHeaderforGET(true);
  oa.get(url, oauthAccessToken, function(error, data) {
    console.log('Callback: ' + url);
    console.log(error);
    console.log(data);

    callback(error, data);
  });
}

var wpGetPath = function(path, oauthAccessToken, callback) {
  var url = 'https://public-api.wordpress.com/rest/v1' + path;
  wpGet(url, oauthAccessToken, callback);

}


var wpPostPath = function(path, params, oauthAccessToken, callback) {
  var oa = new OAuth2({
    clientId: config.wordpressClientId,
    clientSecret: config.wordpressClientSecret
  });

  var headers= {'Authorization': oa.buildAuthHeader(oauthAccessToken) };
  var url = 'https://public-api.wordpress.com/rest/v1' + path;


  oa._request('POST', url, headers, JSON.stringify(params), null, function(error, data, response) {
    console.log('Callback: ' + url);
    console.log(error);
    console.log(data);

    callback(error, data);
  });
}

app.get('/wordpress/site', function(req, res) {
  // console.log(req.user);
  var siteUrl = '/sites/55523211';
  var meUrl = '/me';
  var oauthAccessToken = req.user.wordpress.oauthAccessToken;

  wpGet(siteUrl, oauthAccessToken, function(error, data) {
    res.end(data);
  });
});


app.get('/wordpress/create', function(req, res) {
  // console.log(req.user);
  var siteUrl = 'https://public-api.wordpress.com/rest/v1/sites/55523211/posts/new';

  var meUrl = 'https://public-api.wordpress.com/rest/v1/me';
  var oauthAccessToken = req.user.wordpress.oauthAccessToken;


  var oa = new OAuth2({
    clientId: config.wordpressClientId,
    clientSecret: config.wordpressClientSecret
  });

  var params = {
    'title': 'Hello World',
    'content': 'Hello. I am a test post. I was created by the API',
    'tags': 'tests',
    'categories': 'API'
  }


  wpPostPath('/sites/55523211/posts/new', params, oauthAccessToken, function(error, data) {
    res.send(data, 200);
  });

});



/// Evernote


app.createPost =  function(user, post, callback) {

  var path = '/sites/' + user.wordpress.blog.ID + '/posts/new';

  var oauthAccessToken = user.wordpress.oauthAccessToken;


  var oa = new OAuth2({
    clientId: config.wordpressClientId,
    clientSecret: config.wordpressClientSecret
  });

  wpPostPath(path, post, oauthAccessToken, function(error, data) {
    callback(error, JSON.parse(data));
  });

};


app.updatePost =  function(user, postId, post, callback) {

  var path = '/sites/' + user.wordpress.blog.ID + '/posts/' + postId;

  var oauthAccessToken = user.wordpress.oauthAccessToken;


  var oa = new OAuth2({
    clientId: config.wordpressClientId,
    clientSecret: config.wordpressClientSecret
  });

  wpPostPath(path, post, oauthAccessToken, function(error, data) {
    callback(error, JSON.parse(data));
  });

};




var contentInMarkdown = function(user, evernoteNote, callback) {
  console.log('contentInMarkdown');

  var noteContent = EvernoteLib.contentInMarkdown(user, evernoteNote, null);


  callback(null, noteContent);

  // uploadResources(user, evernoteNote, function(error, resources, tumblrPost) {


  //   if (!error && resources) {
  //     // process the resource
  //     var noteContent = EvernoteLib.contentInMarkdown(user, evernoteNote, resources);
  //     // console.log("contentInMarkdown" + noteContent);
  //     callback(null, noteContent, tumblrPost);
  //   } else {
  //     callback (error);
  //   }

  // });
};




app.createPostWithNote =  function(user, evernoteNote, callback) {

  console.log("createPostWithNote");

  var createdDate = EvernoteLib.createdDateForNote(evernoteNote, user.timezoneOffset);

  console.log("createPostWithNote: " + evernoteNote.title + ' date: ' + createdDate.toUTCString());

  contentInMarkdown(user, evernoteNote, function(error, noteContent, tumblrPost) {

    var contentInHtml = marked(noteContent);

    var wordpressPostRequest = {
      'content' : contentInHtml
    }

    if (evernoteNote.title) { // avoid 'Untitle' Post
      wordpressPostRequest.title = evernoteNote.title;
    };

    console.log(wordpressPostRequest);
    return app.createPost(user, wordpressPostRequest, function(error, wordpressPostResponse) {
      // 
      // Save to database
      if (error) {
        console.log(error);
        callback(error); 

      } 
      else if (wordpressPostResponse && wordpressPostResponse.ID) { // Error handling here also
        // if there has id then get post

        var post = {
          'evernoteUserId': user.evernoteId
          , 'evernoteGuid' : evernoteNote.guid
          , 'evernote.note' : evernoteNote
          , 'wordpress.post' : wordpressPostResponse 
          , 'evernoteUpdated' : evernoteNote.updated
          , 'updated' : new Date()

        };


        app.db.posts.update({evernoteGuid: evernoteNote.guid}, {$set: post}, {upsert: true}, function(error) {
          if (error) console.log('ERROR: ' + error);
          console.log('saved + ' + evernoteNote.guid);
          callback (error, post);
        });


      };
    });
    // end // create post




  });
};




app.updatePostWithNoteAndId = function(user, wordpressPostId, evernoteNote, callback) {
  console.log('updatePostWithNote: ' + wordpressPostId);


  if (!wordpressPostId) {
    // should be more serious
    return callback(null);
  };

  console.log("updatePostWithNote: " + evernoteNote.title + ' id: ' + wordpressPostId);

  contentInMarkdown(user, evernoteNote, function(error, noteContent, wordpressPost) {

    var contentInHtml = marked(noteContent);
    //check for tumblrPost
    var wordpressPostRequest = {
      'content' : contentInHtml
    }

    if (evernoteNote.title) { // avoid 'Untitle' Post
      wordpressPostRequest.title = evernoteNote.title;
    };


    console.log(wordpressPostRequest);

    return app.updatePost(user, wordpressPostId, wordpressPostRequest, function(error, wordpressPostResponse) {
      // 
      // Save to database
      if (error) {
        console.log(error);
        callback(error); 

      } else if (wordpressPostResponse) { // somehow wrong logic here.

        var post = {
          'evernoteUserId': user.evernoteId
          , 'evernoteGuid' : evernoteNote.guid
          , 'evernote.note' : evernoteNote
          , 'tumblr.post' : wordpressPostResponse
          , 'evernoteUpdated' : evernoteNote.updated
          , 'updated' : new Date()
        };

        app.db.posts.update({evernoteGuid: evernoteNote.guid}, {$set: post}, {upsert: true}, function(error) {
          if (error) console.log('ERROR: ' + error);
          console.log('saved + ' + evernoteNote.guid);
          callback (error, post);
        });

      };
    });
  });

};


app.updatePostWithNote = updatePostWithNote = function(user, post, evernoteNote, callback) {

  var wordpressPostId;

  if (post.wordpress && post.wordpress.post) {
    wordpressPostId = post.wordpress.post.ID;
  };
  if (wordpressPostId) {
    if (evernoteNote.deleted) {
      console.log("Post is deleted: " + evernoteNote.guid);
      return app.deletePost(user, post, callback);
    } else {
      return app.updatePostWithNoteAndId(user, wordpressPostId, evernoteNote, callback);    
    }

    
  } else {
    console.log('Not found wordpressPostId for updating');
    return app.createPostWithNote(user, evernoteNote, callback);
  }
  
}