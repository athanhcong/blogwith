
module.exports = function() {
  var config = {
    evernoteConsumerKey    : 'athanhcong'
    , evernoteConsumerSecret : '661e2d2cbf120488'
    , evernoteUsedSandbox    : true
  }


  var nodeEnv = process.env.NODE_ENV;
  if (nodeEnv == 'production') {
      config.serverPort = process.env.PORT;
      config.serverUrl = process.env.URL;
      config['githubClientId'] = '1144e0f6ba3889d04621';
      config['githubClientSecret'] = '910f3c346e97c8bdfccbb9001d7b010f1ce6a0e3';
  } else {
      config['serverPort'] = '8082';
      config['serverUrl'] = 'http://localhost:' + config.serverPort;
      config['githubClientId'] = 'd40e218e245efc6cedb1';
      config['githubClientSecret'] = 'a026298fd821e95083fe4a1c9e640494088e741c';
  };

  config['githubRepo'] = process.env.BLOG_REPOSITORY;

  return config;
};