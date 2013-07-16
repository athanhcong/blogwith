// View
var express = require("express");
var app = module.exports = express()
  , passport = require("passport")
  , TumblrStrategy = require('passport-tumblr').Strategy;



var Tumblr = require('tumblrwks');
var EvernoteLib = require('../evernote');

var url = require('url');

var fs = require('fs');
var flow = require('flow');

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
  passport.authenticate('tumblr', { failureRedirect: '/#evernote' }),
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

  // console.log('creating post: ' + JSON.stringify(post));
  var tumblr = tumblrWithData(user.tumblr);
  // console.log("createPost in host: " + blogHost + " with oauth: " + JSON.stringify(oauth));


  tumblr.post('/post', post, function(json){
    console.log('Created Post: ' + post.title + ' - Response: ' + JSON.stringify(json));

    callback(null, json);
  });

};

app.updatePost =  function(user, post, callback) {

  console.log('updating post: ' + JSON.stringify(post));

  var tumblr = tumblrWithData(user.tumblr);
  // console.log("createPost in host: " + blogHost + " with oauth: " + JSON.stringify(oauth));


  tumblr.post('/post/edit', post, function(json){
    console.log('Updated Post: ' + post.title + ' - Response: ' + JSON.stringify(json));

    callback(null, json);
  });

};

// Resource

var uploadAResource = function (user, note, evernoteResource, callback) {
  var noteStore = EvernoteLib.Client(user.evernote.oauthAccessToken).getNoteStore();

  noteStore.getResourceData(user.evernote.oauthAccessToken, evernoteResource.guid, 
    function onsuccess(fileData) {

      console.log("Got resource: " + fileData + " Length: " + fileData.byteLength);

      // Send to github
      // var fileDataBase64 = new Buffer(fileData).toString('base64');
      // console.log(fileDataBase64);

      var photoDataBuffer = new Buffer(fileData);

      // upload a photo post

      var deleteTumblrPost = function(id) {
        var tumblr = tumblrWithData(user.tumblr);        
        tumblr.post('/post/delete', {'id': id}, function(postRes) {
          // TODO: put to processing queue if not successful
          console.log('Deleted Draft: ' + JSON.stringify(postRes));
        });
      };


      var tumblrPostRequest = {
        type: 'photo'
        , state: 'draft'
        , data: [photoDataBuffer]      
      }

      return app.createPost(user, tumblrPostRequest, function(error, tumblrPostResponse) {
        // 
        // Save to database
        if (error) {
          console.log(error);
          return callback(error); 

        } else if (tumblrPostResponse && tumblrPostResponse.id) { // Error handling here also
          // done now get the photo data

          var tumblr = tumblrWithData(user.tumblr);

          console.log('getting post id: ' + tumblrPostResponse.id);
          tumblr.get('/posts/draft', {'id': tumblrPostResponse.id}, function(postsRes){
            console.log('Got Post: ' + JSON.stringify(postsRes));


            if (postsRes && postsRes.posts && postsRes.posts.length > 0 && postsRes.posts[0].photos && postsRes.posts[0].photos.length > 0) {
              var tumblrPost = postsRes.posts[0];
              var photos = tumblrPost.photos;
              var photo = photos[0];
              console.log(photo);
              // save and callback
              deleteTumblrPost(tumblrPost.id);
              return callback(null, photo, tumblrPost);
            } else {
              // Error handling
              deleteTumblrPost(tumblrPostResponse.id);
              return callback(null);   
            };

          });
        }

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
    if( !error && resource  && resource.tumblr) {
      console.log("Found resource: " + resource.tumblr);
      callback(null, resource);
      return;
    } else {

      // Not found, then:
      // Get resource data
      // NoteStoreClient.prototype.getResourceData = function(authenticationToken, guid, callback)

      console.log("Not Found resource: " + user.evernote.oauthAccessToken + " xx " + evenoteResource.guid);

      uploadAResource(user, note, evenoteResource, function(error, tumblrResource, tumblrPost) {
        console.log(" ");

        if (!error && tumblrResource) {
          var resource = {
            'tumblr': {
              'photo': tumblrResource
            }
            , 'evernote' : {
              'resource' :evenoteResource
            }
            , 'evernoteGuid' : evenoteResource.guid
          };

          app.db.resources.update({evernoteGuid: evenoteResource.guid}, {$set: resource}, {upsert: true}, function(error) {
            if (error) console.log('ERROR: ' + error);
            callback(error, resource, tumblrPost);
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
    , function(error, resource, tumblrPost) {

        if (!error && resource && resource.tumblr && resource.tumblr.photo.alt_sizes) {
          // console.log("Finish uploadResourceIfNeeded: " + resource.tumblr.photo.all_sizes);  

          var resourceUrl = resource.tumblr.photo.alt_sizes[0].url;
          console.log('Uploaded resource: ' + resourceUrl);
          uploadedResources[resource.evernoteGuid] = resourceUrl;  
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



// Evernote




var contentInMarkdown = function(user, evernoteNote, callback) {
  console.log('contentInMarkdown');

  uploadResources(user, evernoteNote, function(error, resources, tumblrPost) {


    if (!error && resources) {
      // process the resource
      var noteContent = EvernoteLib.contentInMarkdown(user, evernoteNote, resources);
      // console.log("contentInMarkdown" + noteContent);
      callback(null, noteContent, tumblrPost);
    } else {
      callback (error);
    }

  });
};


app.createPostWithNote =  function(user, evernoteNote, callback) {

  console.log(EvernoteLib.createdDateForNote);


  var createdDate = EvernoteLib.createdDateForNote(evernoteNote, user.timezoneOffset);

  console.log("createPostWithNote: " + evernoteNote.title + ' date: ' + createdDate.toUTCString());
  contentInMarkdown(user, evernoteNote, function(error, noteContent, tumblrPost) {

    var tumblrPostRequest = {
      title: evernoteNote.title
      , body: noteContent
      , type: 'text'
      , format:'markdown'
      , date : createdDate.toUTCString()
    }

    return app.createPost(user, tumblrPostRequest, function(error, tumblrPostResponse) {
      // 
      // Save to database
      if (error) {
        console.log(error);
        callback(error); 

      } else if (tumblrPostResponse && tumblrPostResponse.id) { // Error handling here also
        // if there has id then get post

        var post = {
          'evernoteUserId': user.evernoteId
          , 'evernoteGuid' : evernoteNote.guid
          , 'evernote.note' : evernoteNote
          , 'tumblr.post' : tumblrPostResponse 
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

app.updatePostWithNoteAndId = function(user, tumblrPostId, evernoteNote, callback) {
  console.log('updatePostWithNote: ' + tumblrPostId);


  if (!tumblrPostId) {
    // should be more serious
    return callback(null);
  };

  console.log("updatePostWithNote: " + evernoteNote.title + ' id: ' + tumblrPostId);


  contentInMarkdown(user, evernoteNote, function(error, noteContent, tumblrPost) {

    //check for tumblrPost
    var tumblrPost = {
      title: evernoteNote.title
      , body: noteContent
      //, type: 'text'
      , format:'markdown'
      , id: tumblrPostId
    }
    return app.updatePost(user, tumblrPost, function(error, tumblrPostResponse) {
      // 
      // Save to database
      if (error) {
        console.log(error);
        callback(error); 

      } else if (tumblrPostResponse) { // somehow wrong logic here.

        var post = {
          'evernoteUserId': user.evernoteId
          , 'evernoteGuid' : evernoteNote.guid
          , 'evernote.note' : evernoteNote
          , 'tumblr.post' : tumblrPostResponse 
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

  var tumblrPostId;

  if (post.tumblr && post.tumblr.post) {
    tumblrPostId = post.tumblr.post.id;
  };
  if (tumblrPostId) {
    return app.updatePostWithNoteAndId(user, tumblrPostId, evernoteNote, callback);  
  } else {
    console.log('Not found tumblrPostId for updating');
    return app.createPostWithNote(user, evernoteNote, callback);
  }
  
}