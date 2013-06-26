
var config = new require('../../config.js')();


config.evernoteConsumerKey = 'athanhcong'
config.evernoteConsumerSecret = '661e2d2cbf120488'

var nodeEnv = process.env.NODE_ENV;
if (nodeEnv == 'production') {
    config.evernoteUsedSandbox = false;  
} else {
    config.evernoteUsedSandbox = true;
};

var express = require("express");
var app = module.exports = express();

var Evernote = require('evernote').Evernote;


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
  
  var client = app.Client();
  client.getAccessToken(
    req.session.oauthToken, 
    req.session.oauthTokenSecret, 
    req.param('oauth_verifier'), 
    function(error, oauthAccessToken, oauthAccessTokenSecret, results) {


      if (error) return res.send("Error getting accessToken", 500);
       

      
      req.session.oauthAccessToken = oauthAccessToken;
      req.session.oauthAccessTokenSecret = oauthAccessTokenSecret;

      client.token = req.session.oauthAccessToken;

      client.getUserStore().getUser(oauthAccessToken, function(edamUser) {
        
        edamUser.oauthAccessToken = oauthAccessToken;
        edamUser.oauthAccessTokenSecret = oauthAccessTokenSecret;
        
        req.session.user = edamUser;

        app.authenticationCallback(req, res, edamUser, oauthAccessToken);
        res.redirect('/');
      });


      // if(error) {
      //   console.log('error');
      //   console.log(error);
      //   res.redirect('/');
      // } else {
      //   // store the access token in the session
      //   req.session.oauthAccessToken = oauthAccessToken;
      //   req.session.oauthAccessTtokenSecret = oauthAccessTokenSecret;
      //   req.session.edamShard = results.edam_shard;
      //   req.session.edamUserId = results.edam_userId;
      //   req.session.edamExpires = results.edam_expires;
      //   req.session.edamNoteStoreUrl = results.edam_noteStoreUrl;
      //   req.session.edamWebApiUrlPrefix = results.edam_webApiUrlPrefix;
      //   res.redirect('/');
      // }
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
  req.session.authToken = null;
  req.session.user = null;
  
  return res.send({ success:true });
});



app.get('/note', function(req, res){
  
  if(!req.session.user)
    return res.send('Please, provide valid authToken',401);
  
  var noteStore = app.Client(req.session.oauthAccessToken).getNoteStore();
  //getNote = function(authenticationToken, guid, withContent, withResourcesData, withResourcesRecognition, withResourcesAlternateData, callback) {
  noteStore.getNote(req.session.oauthAccessToken, "9af28b07-e4f8-4433-bae0-1d6aac37c699", false, false, false, false, function(note) {
      return res.send(note,200);
  });
});
