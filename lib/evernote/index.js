
var config = new require('../../config.js')();


config.evernoteConsumerKey = 'athanhcong'
config.evernoteConsumerSecret = '661e2d2cbf120488'

var nodeEnv = process.env.NODE_ENV;
if (nodeEnv == 'production') {
    config.evernoteUsedSandbox = false;  
} else {
    config.evernoteUsedSandbox = true;
    // config.evernoteUsedSandbox = false;
};

var express = require("express");
var app = module.exports = express();


var Evernote = require('evernote').Evernote;


var enml = require('./enml-js');
var md = require('./html-md');
var util = require('util')
  , url = require('url');

app.Client = function(oauthAccessToken) {
  return new Evernote.Client(
  {  consumerKey: config.evernoteConsumerKey
    , consumerSecret: config.evernoteConsumerSecret
    , sandbox: config.evernoteUsedSandbox
    ,token: oauthAccessToken
  });
}


//===================================================
//                Authentications
//===================================================

app.all('/evernote/authentication', function(req, res){

  if (!req.session) {
    res.end("Sorry, BlogWith may experience a problem at this moment!\nPlease try again in a few minute!");
    console.log("ALERT: No session!!!!");
    return;
  };

  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;
  
  var timezone = query.timezone;
  console.log("timezone" + timezone);

  req.session.userTimezoneOffset = timezone;
  
  var evernote_callback = config.serverUrl + '/evernote/authentication/callback';
  
  // evernote.oAuth(evernote_callback).getOAuthRequestToken( function(error, oauthToken, oauthTokenSecret, results){
    
    // if (error) return res.send("Error getting OAuth request token : " + util.inspect(error), 500);

  //   req.session.oauthRequestToken = oauthToken;
  //   res.redirect( evernote.oAuthRedirectUrl(oauthToken) );      
  // });

  // console.log (JSON.stringify({
  //   consumerKey: config.evernoteConsumerKey,
  //   consumerSecret: config.evernoteConsumerKey,
  //   sandbox: config.evernoteUsedSandbox
  // }));

  var client = app.Client();
  client.getRequestToken(evernote_callback, function(error, oauthToken, oauthTokenSecret, results){
    if (error) return res.send("Error getting OAuth request token : " + util.inspect(error), 500);

    if(error) {
      req.session.error = JSON.stringify(error);
      res.redirect('/');
    }
    else { 

      req.session.oauthRequestToken = oauthToken; // Old code

      // store the tokens in the session
      req.session.oauthToken = oauthToken;
      req.session.oauthTokenSecret = oauthTokenSecret;



      // redirect the user to authorize the token
      res.redirect(client.getAuthorizeUrl(oauthToken));
    }
  });  

});

app.authenticationCallback = function(req, res, data, token) {};


app.all('/evernote/authentication/callback', function(req, res){
  
  console.log("/evernote/authentication/callback");
  var client = app.Client();
  client.getAccessToken(
    req.session.oauthToken, 
    req.session.oauthTokenSecret, 
    req.param('oauth_verifier'), 
    function(error, oauthAccessToken, oauthAccessTokenSecret, results) {


      if (error) return res.send("Error getting accessToken: " + error, 500);
      
      client.token = oauthAccessToken; 
      client.getUserStore().getUser(oauthAccessToken, function(edamUser) {
                
        return app.authenticationCallback(req, res, edamUser, oauthAccessToken);
      });

    });
});


app.findNotesMetadata = function(oauthAccessToken, filterDic, callback) {
  var noteStore = app.Client(oauthAccessToken).getNoteStore();

  //{notebookGuid : notebookGuid}
  var noteFilter = new Evernote.NoteFilter(filterDic);
  var resultSpec = new Evernote.NotesMetadataResultSpec(
    { includeTitle : true
    , includeContentLength: true
    , includeCreated: true
    , includeUpdated: true
    , includeDeleted: true
    , includeUpdateSequenceNum: true
    , includeNotebookGuid: true
    , includeTagGuids: true
    , includeAttributes: true
    , includeLargestResourceMime : true
    , includeLargestResourceSize: true});

  noteStore.findNotesMetadata(oauthAccessToken, noteFilter, 0, 50, resultSpec, 
    function(noteList) {
      callback(null, noteList);
  }, function onerror(error) {
      console.log(error);
      callback(error);
  });
}

/////////


app.all('/logout', function(req, res){
  
  var callback = req.query.callback;
  req.session.evernoteUserId = null;
  req.user = null;
  
  return res.redirect('/');
});



app.get('/note', function(req, res) {
  if(!req.session.user)
    return res.send('Please, provide valid authToken',401);
  
  var noteStore = app.Client(req.session.oauthAccessToken).getNoteStore();
  //getNote = function(authenticationToken, guid, withContent, withResourcesData, withResourcesRecognition, withResourcesAlternateData, callback) {
  noteStore.getNote(req.session.oauthAccessToken, "6195ef4b-eff6-4fb2-8c46-aec965330a83", true, false, false, false, function(note) {
      console.log(JSON.stringify(note));
      return res.send(note,200);
  });
});



/////////////

 var URLOfResourceWithInfo = function (guid, shardId, name, width){
  if (config.evernoteUsedSandbox) {
    var defaultServiceHost = 'sandbox.evernote.com';
  } else {
    var defaultServiceHost = 'www.evernote.com';
  }

  return 'https://'+ defaultServiceHost +'/shard/'+shardId+'/res/'+guid + '/' + escape(name);
  // + '?resizeSmall&width=' + width;
}

app.URLOfResource = function (evernoteUser, resource) {

  return URLOfResourceWithInfo(resource.guid, evernoteUser.shardId, resource.attributes.fileName, 860);
}

var contentInMarkdown = function(userInfo, note, resourceUrls) {
  // Create resource map
  var resourcesMap = [];

  console.log("resourceUrls");
  console.log(resourceUrls);

  if (note.resources) {
    console.log('EvernoteLib: Resource count ' + note.resources.length + ' - Resource URLs count: ' + resourceUrls.length);

    for (var i = 0; i < note.resources.length; i++) {
      var resource = note.resources[i];

      if (resourceUrls[resource.guid]) {
        // Resource data
        resourceData = {
          url : resourceUrls[resource.guid]
        };

       // var bodyHashString = new Buffer(resource.data.bodyHash).toString("hex");
        // var bodyHashString = new Buffer(resource.data.bodyHash).toString();

        // console.log("bodyHashString" + bodyHashString + "-" + resource.data.bodyHash);

        resourcesMap[resource.data.bodyHash] = resourceData;        
      } else {
        console.log("WARNING: no resource uploaded");
      };

    };    
  };

  console.log("resourcesMap: ");
  console.log(resourcesMap);

  // console.log("Note Content: " + note.content);

  var contentHtml = enml.HTMLOfENML(note.content, resourcesMap);
  console.log(contentHtml);
  var contentMarkdown = md(contentHtml);

  // console.log(contentMarkdown);


  return contentMarkdown;
}

app.contentInMarkdown = contentInMarkdown;

function isNumber(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

app.createdDateForNote = createdDateForNote = function(note, timezoneOffset) {
  console.log('createdDateForNote');

  var createdDate = note.created;
  var timezoneOffsetInMinisecond = 0;
  if (isNumber(timezoneOffset)) {
    timezoneOffsetInMinisecond = parseFloat(timezoneOffset) * 60000;
  } else if(note.timezone) {
    // TODO: handle timezone string, not so important now
  };

  // console.log("createdDate: " + createdDate + " - ");

  // console.log(note.timezoneOffset);

  console.log(timezoneOffset);
  console.log(timezoneOffsetInMinisecond);
  var date = new Date(createdDate + timezoneOffsetInMinisecond);
  console.log('date: ' + date);
  return date;
}