var assert = require("assert");
var fs = require('fs');

// file is included here:
eval(fs.readFileSync('index.js')+'');

describe('Github', function(){
  describe('#filenameForJekyllPost()', function(){
    it('should return return correct file name', function(){
      assert.equal("2004-08-11-awesome.md", filenameForJekyllPost({title: 'awesome', 'created': 1092219576}));
      assert.equal("2013-06-14-awesome-time.md", filenameForJekyllPost({title: 'awesome time', 'created': 1371201760}));
      
    })
  })
})