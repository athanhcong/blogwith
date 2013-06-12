
module.exports = function(){
  var config = {
    evernoteConsumerKey    : 'athanhcong'
    , evernoteConsumerSecret : '661e2d2cbf120488'
    , evernoteUsedSandbox    : true
  }


  var nodeEnv = process.env.NODE_ENV;
  if (nodeEnv == 'development') {
      config['serverPort'] = '8081';
      config['serverUrl'] = 'http://localhost:' + config.serverPort;
  } else if (nodeEnv == 'production') {
      config.serverPort = process.env.PORT;
      config.serverUrl = process.env.URL;
  };

  return config;
};