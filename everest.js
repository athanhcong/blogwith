const KEY = 'express.sid'
  , SECRET = 'express'
  , GITHUB_CLIENT_ID = '1144e0f6ba3889d04621'
  , GITHUB_CLIENT_SECRET = '910f3c346e97c8bdfccbb9001d7b010f1ce6a0e3'
  ;


require('./utils.js');

global.config = new require('./config.js')();
var config = global.config;

console.log("Starting with configuration");
console.log(global.config);

var util = require('util');
var querystring = require('querystring');
var express = require('express')
  // , connect = require('connect')
  , http = require('http');



var app = express()
  , server = http.createServer(app);


// Create an Evernote instance
var Evernote = require('./evernode').Evernote;
var evernote = new Evernote(
		config.evernoteConsumerKey,
		config.evernoteConsumerSecret,
		config.evernoteUsedSandbox
		);

var enml = require('enml-js');
var md = require('html-md');

var  redis = require('redis');
var redisClient;
if (process.env.REDISTOGO_URL) {
  // TODO: redistogo connection
  var rtg   = require("url").parse(process.env.REDISTOGO_URL);
  console.log ('Config RedisToGo: rtg', JSON.stringify(rtg));
  redisClient = redis.createClient(rtg.port, rtg.hostname);

  console.log ('Config RedisToGo: rtg.auth', JSON.stringify(rtg.auth.split(":")[1]));
  redisClient.auth(rtg.auth.split(":")[1], function(data) {
    console.log ('Config RedisToGo: callback.auth', JSON.stringify(data));
  }); 

  console.log ('Config RedisToGo');

} else {
  redisClient = redis.createClient()
};

var RedisStore = require('connect-redis')(express)
  , store = new RedisStore({
    client: redisClient,
  })
  // , store = new express.session.MemoryStore()
  , session = express.session({secret: SECRET
                             , key: KEY
                             , store: store
                             ,cookie: { secure: false, maxAge: 86400000 }
                            });


//

var github = require('octonode')
  , url = require('url')
  , qs = require('querystring');
// Build the authorization config and url
var auth_url = github.auth.config({
  id: GITHUB_CLIENT_ID,
  secret: GITHUB_CLIENT_SECRET
}).login(['user', 'repo', 'gist']);

var githubClient = github.client({
  id: GITHUB_CLIENT_ID,
  secret: GITHUB_CLIENT_SECRET
});


var ghme   = githubClient.me();

var Repo = github.repo;

Repo.prototype.contentsCreate = function(filename, content, cb) {

  console.log("Repo.prototype.contentsCreate");

  var path = filename;

  var contentInBase64 = new Buffer(content).toString('base64');


  return this.client.put("/repos/" + this.name + "/contents/" + path, 
    {
      "message": "Create filename: " + path
      , "content": contentInBase64 
    }
    , function(err, s, b) {
      // console.log(err);
      // console.log(s);
      // console.log(b);

      if (err) {
        return cb(err);
      }
      if (s !== 201) {
        return cb(new Error("Repo contents error"));
      } else {
        return cb(null, b);
      }
    });
};

var ghme   = githubClient.me();
var ghrepo = githubClient.repo('athanhcong/testblog');

// Store info to verify against CSRF
var state = auth_url.match(/&state=([0-9a-z]{32})/i);

//Setup ExpressJS
app.configure(function(){

  //Use static files
  app.set('views', __dirname + '/views');
  app.engine('html', require('ejs').renderFile);


	app.use(express.cookieParser()); 
	app.use(express.bodyParser());

  app.use(express.methodOverride());

  app.use(session);


	app.use(express.static(__dirname + "/public"));
	//Use session
  // app.use(app.router);



  app.use(function(req, res, next){
    res.locals.session = req.session;
    next();
  });

  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));

});

// app.dynamicHelpers({
//   session: function(req, res){
//     return req.session;
//   }
// });

//Allow X-Domain Ajax
app.all('/', function(req, res, next) {
  console.log("app.all /");
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  next();
});

//===================================================
//								 			ETC
//===================================================

// Welcom Page
app.get('/', function(req, res){
	
  console.log("app.get / " + req + ' ' + req.session);
	if(!req.session.user) //Unauthenticate User
		return res.redirect('/login');

  console.log("loading index");
  return res.render("index.html");		
	// return res.redirect('/index');
});

app.get("/login", function (req, res) {
  res.render("login.html");
});

// app.get("/website/index", function (req, res) {
//   res.render("index.html");
// });

//===================================================
//								Authentications
//===================================================

app.all('/authentication', function(req, res){
	
	var evernote_callback = config.serverUrl + '/authentication/callback';
	
  evernote.oAuth(evernote_callback).getOAuthRequestToken( function(error, oauthToken, oauthTokenSecret, results){
		
		if (error) return res.send("Error getting OAuth request token : " + util.inspect(error), 500);

    req.session.oauthRequestToken = oauthToken;
    res.redirect( evernote.oAuthRedirectUrl(oauthToken) );      
  });

});

app.all('/authentication/callback', function(req, res){
	
	var evernote_callback = config.serverUrl +'/evernote/authentication/callback';
		
  evernote.oAuth(evernote_callback).getOAuthAccessToken( req.session.oauthRequestToken, 
		req.session.oauthRequestTokenSecret, 
		req.query.oauth_verifier, 
		function(err, authToken, accessTokenSecret, results) {

			if (err) return res.send("Error getting accessToken", 500);
			 
			evernote.getUser(authToken, function(err, edamUser) {
			
				if (err) return res.send("Error getting userInfo", 500);
				
				req.session.authToken = authToken;
				req.session.user = edamUser;

	      var userId = req.session.user.id;
        redisClient.sadd('users:' + userId, userId);

				res.redirect('/');
			});
  });
});


app.get('/github/authentication', function(req, res){
  console.log("github/authentication");
  res.writeHead(301, {'Content-Type': 'text/plain', 'Location': auth_url})
  res.end('Redirecting to ' + auth_url);
});

app.all('/github/authentication/callback', function(req, res){
  console.log("github/authentication/callback");
  var uri = url.parse(req.url);
  var values = qs.parse(uri.query);
  // Check against CSRF attacks
  // if (!state || state[1] != values.state) {
  //   res.writeHead(403, {'Content-Type': 'text/plain'});
  //   res.end('');
  // } else {
    github.auth.login(values.code, function (err, token) {
      console.log("github/authentication/callback " + err + ' ' + token);
      // res.writeHead(200, {'Content-Type': 'text/plain'});

      var userId = req.session.user.id;

      redisClient.set('users:' + userId + ':github:authToken', token);

      req.session.github = {};
      req.session.github.authToken = token;
      githubClient.token = token;
      ghme.info(function(err, data) {
        console.log("error: " + err);
        console.log("data: " + data);

        redisClient.set('users:' + userId + ':github:user', JSON.stringify(data));
        res.redirect('/');
      });
      
    });
  // }
});




/////////////////



app.get('/evernote/create-notebook', function(req, res){
  console.log("/evernote/create-notebook");



  if(!req.session.user) return res.send('Unauthenticate',401);
  if(!req.body) return res.send('Invalid content',400);
  
  var userId = req.session.user.id;

  var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, notebook){
    if (notebook) {
      console.log(JSON.stringify(notebook));
    } else {
      console.log("No notebook. Creating one");
      var notebook = {"name": "Blog with Evernote"};
      var userInfo = req.session.user;
  
      evernote.createNotebook(userInfo, notebook, function(err, data) {
        console.log("Creating " + err + ' ' + JSON.stringify(data));
        if (err) {
          if(err == 'EDAMUserException') return res.send(err,403);
          return res.send(err,500);
        } else {
          redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
        }
      });
    }
    return res.redirect('/');

  });
});


app.get('/evernote/sync', function(req, res){
  console.log("/evernote/create-notebook");

  if(!req.session.user) return res.send('Unauthenticate',401);
  if(!req.body) return res.send('Invalid content',400);

  // Check notebook
  var userId = req.session.user.id;
  var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, data){
    if(!data) return res.send('Can not find notebook',400);

    // Get all notes
    var notebook = JSON.parse(data);
  
    console.log("Retrieve change from notebook " + notebook.name);
    
    // evernote.createNotebook(userInfo, notebook, function(err, data) {
    //   console.log("Creating " + err + ' ' + JSON.stringify(data));
    //   if (err) {
    //     if(err == 'EDAMUserException') return res.send(err,403);
    //     return res.send(err,500);
    //   } else {
    //     redisClient.set('users:' + userId + ':evernote:notebook', JSON.stringify(data));
    //   }
    // });
    return res.redirect('/');

  });

  console.log("Retrieve notebook " + JSON.stringify(result));
});

app.get('/evernote/notes', function(req, res){
  console.log('/evernote/notes');
  if(!req.session.user) return res.send('Unauthenticate',401);

  var userInfo  = req.session.user;
  var offset    = req.query.offset || 0;
  var count     = req.query.count || 50;
  var words     = req.query.words || '';
  var sortOrder = req.query.sortOrder || 'UPDATED';
  var ascending = req.query.ascending || false;


  var userId = req.session.user.id;



  var result = redisClient.get('users:' + userId + ':evernote:notebook', function(err, data) {

    if (!data) {
      return res.send('No notebook',500);
    }

    var notebook = JSON.parse(data);

    console.log('notebook ' + JSON.stringify(notebook));

    var notebookGuid = notebook.guid;
    
    console.log('notebookGuid ' + notebookGuid);

    evernote.findNotesMetadata(userInfo, notebookGuid, words, { offset:offset, count:count, sortOrder:sortOrder, ascending:ascending }, function(err, noteList) {
      if (err) {
        if(err == 'EDAMUserException') return res.send(err,403);
        return res.send(err,500);
      } else {

        
      syncNotesMetadata(req, res, noteList, function(err, data){
        return res.send(noteList,200);  
      });
      
      }
    });
  });




  var syncNotesMetadata = function(req, res, notesMetadata, cb) {
    console.log('syncNotesMetadata');


    // Get old notesMetadata
    var userId = req.session.user.id;

    var result = redisClient.get('users:' + userId + ':evernote:notesMetadata', function(err, data) {

      if (!data) {
        // No notesMetadata before
        initBlogWithNotesMetadata(req, res, notesMetadata);
      } else {
        initBlogWithNotesMetadata(req, res, notesMetadata);
      }
    });


    cb(null);
    redisClient.set('users:' + userId + ':evernote:notesMetadata', JSON.stringify(notesMetadata));
  };

  var createPostWithMetadata = function(req, res, metadata) {
    console.log('createPostWithMetadata');

    var userInfo = req.session.user;
    var guid = metadata.guid;

    evernote.getNote(userInfo, guid, {}, function(err, note) {
      
      if (err) {
        cb(err);
      }

      console.log(JSON.stringify(note));

      createGithubPost(userInfo, note, function(err, data) {
        // Save to database
      });
    });
  }



  var initBlogWithNotesMetadata = function(req, res, notesMetadata) {
    console.log('initBlogWithNotesMetadata');
    var notes = notesMetadata.notes;
    for (var i = 0; i < notes.length; i++) {
      var metadata = notes[i];
      createPostWithMetadata(req, res, metadata);
    };
  }

  var createGithubPost = function(user, note, cb){

    var contentHtml = enml.HTMLOfENML(note.content);
    var contentMarkdown = md(contentHtml);
    var title = note.title;

    console.log('createGithubPost ' + title + ' ' + contentHtml);


    // var date = new Date(note.created);
    var date = new Date();
    var timestamp = new Date().getTime();

    var titleFilename = title.toLowerCase().split(' ').join('-');
    var filename = date.getFullYear() + '-' + date.getMonth().pad(2) + '-' + date.getDay().pad(2) + '-' + titleFilename + '.md';
    // var content = "Yeah this is cool";
    console.log('createGithubPost ' + filename + ' ' + contentMarkdown);

    var result = redisClient.get('users:' + user.id + ':github:authToken', function(err, data) {
      console.log('got github token ' + data);

      githubClient.token = data;
      ghrepo.contentsCreate(filename, contentMarkdown, function(err, data) {
        console.log("error: " + err);
        console.log("data: " + JSON.stringify(data));
      });
    });


  };


});



//////////////



// var getNote = function(req, res, guid, cb){
  
//   if(!req.session.user) return res.send('Unauthenticate',401);
//   if(!req.body) return res.send('Invalid content',400);
  
//   var userInfo = req.session.user;

//   evernote.getNote(userInfo, guid, null, function(err, note) {
    
//     if (err) {
//       cb(err);
//     } 
//     cb(null, note)
//   });
// });


  app.get('/github/create', function(req, res){
    console.log('/github/create');
    if(!req.session.user) return res.send('Unauthenticate',401);


    var date = '13-06-01';
    var timestamp = new Date().getTime();
    var title = '' + timestamp;
    var filename = date + '-' + title + '.md';
    var content = "Yeah this is cool";

    var userId = req.session.user.id;


    var result = redisClient.get('users:' + userId + ':github:authToken', function(err, data) {
      console.log('got github token ' + data);

      githubClient.token = data;
      ghrepo.contentsCreate(title, content, function(err, data) {
        console.log("error: " + err);
        console.log("data: " + data);
        return res.send(data,200);
      });

    });

  });


/////////


app.all('/logout', function(req, res){
	
	var callback = req.query.callback;
	req.session.authToken = null;
	req.session.user = null;
	
	return res.send({ success:true });
});

app.get('/me', function(req, res){
	
	if(!req.session.user)
		return res.send('Please, provide valid authToken',401);
	
	evernote.getUser(req.session.user.authToken,function(err, edamUser) {
		
		if (err) {
			if(err == 'EDAMUserException') return res.send(err,403);
      return res.send(err,500);
    } else {
			
			req.session.user = edamUser;
			return res.send(edamUser,200);
    }
	});
});

server.listen(config.serverPort, function(){
  console.log("Express server listening on port " + config.serverPort)
})
