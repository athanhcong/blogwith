
// View
var express = require("express");
var app = module.exports = express();


app.get('/tumblr/authentication', function(req, res){

  if (!req.user) {
    res.end('Oops, you haven\'t logged in with Evernote yet. How about go back and try it?');
    return;
  };

  res.end('Sorry! Tumblr support is not available yet.\nWe know you love Tumblr, so we are working very hard on it.\n\nIn the meantime, please try Jekyll, the geeky and minimalist blogging platform.\nIf you have question, or request for more services integration, feel free to contact kong@blogwith.co');
});

app.get('/tumblr/authentication/callback', function(req, res){
  console.log("github/authentication/callback");
  res.end('');
});
