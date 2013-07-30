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
  } else if (nodeEnv == 'stagging'){
    config.wordpressClientId = '4742';
    config.wordpressClientSecret = 'MLHm2hDDRDvlclVbZohN1ch96CXba4IhUB0cAomnH6en8t4799UFjBPpz61BDFvr';    

  } else {
  	config.wordpressClientId = '4812';
  	config.wordpressClientSecret = '1dB0ZM63GGhiFVcYLlj5kdV0p4vMBE9fwd4s3HGo1annqsxV5WWNftfKDFI3K82W';  	
  };

var marked = require('marked');

var EvernoteLib = require('../evernote');


// var FormData = require('form-data');
var request = require('request');
var fs = require('fs');
var flow = require('flow');

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

  // if (params && params['media[0]']) {
  // };

  var url = 'https://public-api.wordpress.com/rest/v1' + path;


  oa._request('POST', url, headers, JSON.stringify(params), null, function(error, data, response) {
    console.log('Callback: ' + url);
    console.log(error);
    console.log(data);

    callback(error, data);
  });
}


/// Resources

var saveResource = function(evernoteResource, wordpressResource, callback) {
  var resource = {
    'wordpress': {
      'media': wordpressResource
    }
    , 'evernote' : {
      'resource' :evernoteResource
    }
    , 'evernoteGuid' : evernoteResource.guid
  };

  app.db.resources.update({evernoteGuid: evernoteResource.guid}, {$set: resource}, {upsert: true}, function(error) {
    if (error) console.log('ERROR: ' + error);
    callback(error, resource);
  });
}


var uploadToWordpressResources = function (user, note, evernoteResources, keepWordpressPost, callback) {

  console.log('uploadToWordpressResources');
  var evernoteResourcesUrls = [];
  for (var i = 0; i < evernoteResources.length; i++) {
    evernoteResourcesUrls.push(EvernoteLib.URLOfResource(user.evernote.user, evernoteResources[i]));
  };


  console.log(evernoteResourcesUrls);


  wpPostDraftWithMediaUrls(user.wordpress.blog.ID, evernoteResourcesUrls, user.wordpress.oauthAccessToken, 
    function (error, wordpressResources, wordpressPost) {


      // map & save

      var resources = [];

      flow.serialForEach(evernoteResources, 
      function(evernoteResource) {
        var index = evernoteResources.indexOf(evernoteResource);
        wordpressResource = wordpressResources[index];

        saveResource(evernoteResource, wordpressResource, this);
      }
      , function(error, resource) {

          console.log('save resource callback');
          console.log(resource);
          if (!error && resource) {

            resources.push(resource);
  
          } else {
            console.log('Unexpected Error!: ');
            console.log(error);
          };
      }

      , function () {
        console.log('wpPostDraftWithMediaUrls');
        console.log(resources);
        callback(null, resources, wordpressPost);
      });

      if (!keepWordpressPost) {
        // delete
        wpDeletePostWithId(user, wordpressPost.ID, function(error, deletedWordpressPost) {
          console.log('DEleted post: ' + wordpressPost.ID);
        });
      };


    });
}

var uploadedResourceIfAvailable = function(user, note, evernoteResource, callback) {
  app.db.resources.findOne({evernoteGuid: evernoteResource.guid}, function(error, resource) {
    if( !error && resource  && resource.wordpress) {
      console.log("Found resource: " + resource.wordpress);
      callback(null, evernoteResource, resource);
    } else {
      callback(null, evernoteResource);
    }
  });
}

var uploadResources = function(user, wordpressPostId, note, callback) {

  var evernoteResources = note.resources;

  if (evernoteResources) {
    console.log("uploadResources: " + evernoteResources.length);
  } else {
    return callback(null, []);
  };
  

  var uploadedResources = [];

  var callbackWithResources = function (allResources, newWordpressPostId) {
    console.log('callbackWithResources');
    console.log(allResources);
    var uploadedResourcesUrls = [];
    for (var i = 0; i < allResources.length; i++) {
      var resource = allResources[i];
      if (resource.wordpress.media && resource.wordpress.media.URL) {
        uploadedResourcesUrls[resource.evernoteGuid] = resource.wordpress.media.URL;  
      };
      
    };

    console.log(uploadedResourcesUrls);
    //making url map and callback

    callback(null, uploadedResourcesUrls, newWordpressPostId);
  }


  var notYetUploadedEvernoteResources = [];

  flow.serialForEach(evernoteResources, 
    function(evernoteResource) {
      uploadedResourceIfAvailable(user, note, evernoteResource, this);
    }
    , function(error, evernoteResource, resource) {

        if (!error && resource && resource.wordpress && resource.wordpress.media && resource.wordpress.media.URL) {
          console.log("Finish load resource: " + resource.wordpress.media.URL);  

          uploadedResources.push(resource);

        } else {
          notYetUploadedEvernoteResources.push(evernoteResource);
        };

        console.log("uploadedResource");
        console.log(uploadedResources);

    }

    , function () {
      console.log("Finished geting cached resource");

      if (notYetUploadedEvernoteResources.length > 0) {
        var keepDraft = !wordpressPostId;
        uploadToWordpressResources(user, note, notYetUploadedEvernoteResources, keepDraft, 
          function(error, resources, wordpressPost) {
            // have resource now.
            console.log('uploadToWordpressResources callback');
            console.log(resources);

            // uploadedResources.concat(resources);

            for (var i = 0; i < resources.length; i++) {
              uploadedResources.push(resources[i]);
            };


            console.log(uploadedResources);
            console.log(wordpressPost);


            var newWordpressPostId = (keepDraft)? wordpressPost.ID : wordpressPostId;
            console.log(newWordpressPostId);

            callbackWithResources(uploadedResources, newWordpressPostId);
        });
      } else {
        callbackWithResources(uploadedResources);
      }
      // // console.log(uploadedResources);
      // callback(null, uploadedResources);

    }
  );
}


// Task




var wpPostDraftWithMediaUrls = function(blog, mediaUrls, oauthAccessToken, callback) {
  var oa = new OAuth2({
    clientId: config.wordpressClientId,
    clientSecret: config.wordpressClientSecret
  });



  var headers= {'Authorization': oa.buildAuthHeader(oauthAccessToken) };

  var url = 'https://public-api.wordpress.com/rest/v1/sites/'+ blog + '/posts/new';
  
  console.log(url);

  console.log(oauthAccessToken);

  // return;
  var newReq = request.post({
      'url': url, 
      'headers': headers,
    },
  function (error, response, body) {
    // if(response.statusCode == 201){
    //   console.log('document saved as: http://mikeal.iriscouch.com/testjs/'+ rand)
    // } else {
    //   console.log('error: '+ response.statusCode)
    //   console.log(body)
    // }
    console.log('request, callback');

    // get all media content parse it into resources, and post, link with media urls

    console.log(body);

    var wordpressPost = JSON.parse(body);

    var wordpressResources = [];

    for(var key in wordpressPost.attachments) {
      var wordpressResource = wordpressPost.attachments[key];
      wordpressResources.push(wordpressResource);
    }

    console.log(wordpressResources);
    callback(null, wordpressResources, wordpressPost);


  });

  var form = newReq.form();

  form.append('title', 'A draft post');
  form.append('content', '');

  form.append('status', 'draft');

  for (var i = 0; i < mediaUrls.length; i++) {
      form.append('media['+ i + ']', request(mediaUrls[i]));
  };



};






var wpPostMultiPath2 = function(path, params, oauthAccessToken, callback) {
  var oa = new OAuth2({
    clientId: config.wordpressClientId,
    clientSecret: config.wordpressClientSecret
  });

  // 'title': 'Hello World',
  // 'content': 'Hello. I am a test post. I was created by the API',

  var headers= {'Authorization': oa.buildAuthHeader(oauthAccessToken) };

  var url = 'https://public-api.wordpress.com/rest/v1' + path;

  //var photo = fs.readFileSync('./public/images/backpack.png');
  // var photo = fs.createReadStream('./public/images/backpack.png');

  console.log(url);


  var newReq = request.post({
      'url': url, 
      'headers': headers,
      // 'oauth': oa
      // 'body' : JSON.stringify({title:'Hello World', content: 'Hello. I am a test post. I was created by the API'})
    },

  function (error, response, body) {
    // if(response.statusCode == 201){
    //   console.log('document saved as: http://mikeal.iriscouch.com/testjs/'+ rand)
    // } else {
    //   console.log('error: '+ response.statusCode)
    //   console.log(body)
    // }
    console.log('request, callback');
    console.log(error);

    console.log(body);

  });
    
  // var form = new FormData();

  var form = newReq.form();


  form.append('title', 'The World is full of Love');
  form.append('content', 'Love to blog in Wordpress, this is my first post!!!!');

  // form.append('tags', 'this, is, tags');
  // form.append('media[0]', request('https://sandbox.evernote.com/shard/s1/res/244b3b0d-f0c7-4cb8-8834-5fe42ef9d9d0/IMG_3867.JPG'));
  // form.append('media[1]', request('https://sandbox.evernote.com/shard/s1/res/80c87d94-ecc4-4726-bdd9-87e5e98b62e3/view.gif'));

  form.append('media[0]', request('https://sandbox.evernote.com/shard/s1/res/f0b19880-2574-48a5-aab4-e7171e391053/soholand.jpg'));


  // form.append('my_buffer', new Buffer([1, 2, 3]))
  // form.append('media[]', photo);



  // form.append('remote_file', request('http://google.com/doodle.png'))

};


var wpPostMultiPath = function(path, params, oauthAccessToken, callback) {
  var oa = new OAuth2({
    clientId: config.wordpressClientId,
    clientSecret: config.wordpressClientSecret
  });

  var data = fs.readFileSync('./public/images/home_tutorial_write.png');
  console.log(data);


  var photoName = 'backpack.png';

  var params = {
    'title': 'Hello World',
    'content': 'Hello. I am a test post. I was created by the API',
    'media[0]' : data.toString('binary'),
    'tags': 'tests',
    'categories': 'API'
  }

  var crlf = "\r\n";
  var boundary = '---------------------------10102754414578508781458777923';

  var separator = '--' + boundary;
  var footer = crlf + separator + '--' + crlf;
  var fileHeader = 'Content-Disposition: file; name="media[0]"; filename="' + photoName + '"';

  var contents = separator + crlf
      + 'Content-Disposition: form-data; name="title"' + crlf
      + crlf
      + 'Hello World' + crlf
      + separator + crlf
      + fileHeader + crlf
      + 'Content-Type: image/png' +  crlf
      + crlf;

  var multipartBody = Buffer.concat([
      new Buffer(contents),
      data,
      new Buffer(footer)]);

  var headers = {
      'Authorization': oa.buildAuthHeader(oauthAccessToken),
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      // 'Content-Length': multipartBody.length,
      'Connection': 'Keep-Alive'
  };

  // var options = {
  //     host: hostname,
  //     port: 443,
  //     path: '/1/statuses/update_with_media.json',
  //     method: 'POST',
  //     headers: headers
  // };

  // var request = https.request(options);     
  // request.write(multipartBody);
  // request.end();

  // request.on('error', function (err) {
  //     console.log('Error: Something is wrong.\n'+JSON.stringify(err)+'\n');
  // });

  // request.on('response', function (response) {            
  //     response.setEncoding('utf8');            
  //     response.on('data', function (chunk) {
  //         console.log(chunk.toString());
  //     });
  //     response.on('end', function () {
  //         console.log(response.statusCode +'\n');
  //     });
  // });

  var url = 'https://public-api.wordpress.com/rest/v1' + path;


  oa._request('POST', url, headers, multipartBody.toString('binary'), null, function(error, data, response) {
    console.log('Callback: ' + url);
    console.log(error);
    console.log(data);

    callback(error, data);
  });


}

app.get('/wordpress/site', function(req, res) {
  // console.log(req.user);
  var siteUrl = '/sites/55716304';
  var meUrl = '/me';
  var oauthAccessToken = req.user.wordpress.oauthAccessToken;

  wpGet(siteUrl, oauthAccessToken, function(error, data) {
    res.end(data);
  });
});


app.get('/wordpress/create', function(req, res) {
  // console.log(req.user);

  var oauthAccessToken = req.user.wordpress.oauthAccessToken;


  var oa = new OAuth2({
    clientId: config.wordpressClientId,
    clientSecret: config.wordpressClientSecret
  });

  // var photo = fs.readFileSync('./public/images/backpack.png');
  // console.log(photo);

  // var params = {
  //   'title': 'Hello World',
  //   'content': 'Hello. I am a test post. I was created by the API',
  //   'media[0]' : photo.toString('binary'),
  //   'tags': 'tests',
  //   'categories': 'API'
  // }


  wpPostMultiPath2('/sites/55523211/posts/new', null, oauthAccessToken, function(error, data) {
    res.send(data, 200);
  });

});



app.get('/wordpress/update', function(req, res) {
  // console.log(req.user);

  var oauthAccessToken = req.user.wordpress.oauthAccessToken;


  wpPostMultiPath2('/sites/55523211/posts/64', null, oauthAccessToken, function(error, data) {
    res.send(data, 200);
  });

});

app.get('/wordpress/delete', function(req, res) {

  wpDeletePostWithId(req.user, '130', function () {

  });

});




/// Evernote


app.createPost =  function(user, post, callback) {

  var path = '/sites/' + user.wordpress.blog.ID + '/posts/new';

  var oauthAccessToken = user.wordpress.oauthAccessToken;


  // var oa = new OAuth2({
  //   clientId: config.wordpressClientId,
  //   clientSecret: config.wordpressClientSecret
  // });

  wpPostPath(path, post, oauthAccessToken, function(error, data) {
    callback(error, JSON.parse(data));
  });

};


app.updatePost =  function(user, postId, post, callback) {

  var path = '/sites/' + user.wordpress.blog.ID + '/posts/' + postId;

  var oauthAccessToken = user.wordpress.oauthAccessToken;

  // var oa = new OAuth2({
  //   clientId: config.wordpressClientId,
  //   clientSecret: config.wordpressClientSecret
  // });

  wpPostPath(path, post, oauthAccessToken, function(error, data) {
    callback(error, JSON.parse(data));
  });

};


var contentInMarkdown = function(user, wordpressPostId, evernoteNote, callback) {
  console.log('contentInMarkdown');

  // var noteContent = EvernoteLib.contentInMarkdown(user, evernoteNote, null);

  uploadResources(user, wordpressPostId, evernoteNote, function(error, resources, newWordpressPostId) {
    console.log('uploadResources callback');
    console.log(resources);
    console.log(newWordpressPostId);

    if (!error && resources) {
      // process the resource
      var noteContent = EvernoteLib.contentInMarkdown(user, evernoteNote, resources);
      // console.log("contentInMarkdown" + noteContent);
      callback(null, noteContent, newWordpressPostId);
    } else {
      callback (error);
    }

  });
};


app.createPostWithNote =  function(user, evernoteNote, callback) {

  console.log("createPostWithNote");

  var createdDate = EvernoteLib.createdDateForNote(evernoteNote, user.timezoneOffset);

  console.log("createPostWithNote: " + evernoteNote.title + ' date: ' + createdDate.toUTCString());

  app.updatePostWithNoteAndId(user, null, evernoteNote, callback);
};




app.updatePostWithNoteAndId = function(user, wordpressPostId, evernoteNote, callback) {
  console.log('updatePostWithNote: ' + wordpressPostId);

  // if (!wordpressPostId) {
  //   // should be more serious
  //   return callback(null);
  // };

  console.log("updatePostWithNote: " + evernoteNote.title + ' id: ' + wordpressPostId);

  contentInMarkdown(user, wordpressPostId, evernoteNote ,function(error, noteContent, newWordpressPostId) {

    console.log(noteContent);

    var contentInHtml = marked(noteContent);

    var wordpressPostRequest = {
      'content' : contentInHtml
      , 'status' : 'publish'      
    }

    if (evernoteNote.title) { // avoid 'Untitle' Post
      wordpressPostRequest.title = evernoteNote.title;
    };

    console.log(wordpressPostRequest);

    var updatePostCallback = function(error, wordpressPostResponse) {
      // 
      // Save to database
      console.log(wordpressPostResponse);

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
    };


    var updatingWordpressPostId = (wordpressPostId) ? wordpressPostId : newWordpressPostId;

    if (updatingWordpressPostId) {
      app.updatePost(user, updatingWordpressPostId, wordpressPostRequest, updatePostCallback);  
    } else {
      app.createPost(user, wordpressPostRequest, updatePostCallback);  
    }

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


var wpDeletePostWithId = function(user, wordpressPostId, callback) {
//  https://public-api.wordpress.com/rest/v1/sites/$site/posts/$post_ID/delete

  var path = '/sites/' + user.wordpress.blog.ID + '/posts/' + wordpressPostId + '/delete';

  var oauthAccessToken = user.wordpress.oauthAccessToken;

  return wpPostPath(path, null, oauthAccessToken, function(error, wordpressPost) {
    console.log(wordpressPost);

    if (wordpressPost.status == 'trash') {
      wpDeletePostWithId(user, wordpressPostId, callback);
    } else {
      callback(error, wordpressPost);
    }

  });

}


app.deletePost = function(user, post, callback) {
  wpDeletePostWithId(user, post.wordpress.post.ID, callback);

}