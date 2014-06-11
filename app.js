require('newrelic');

const KEY = 'express.sid'
  , SECRET = 'express'
  ;


var config = new require('./config.js')();

console.log("Starting with configuration");
console.log(config);

var util = require('util');
var querystring = require('querystring');
var express = require('express')
  // , connect = require('connect')
  , http = require('http');



var app = express()
  , server = http.createServer(app);



///////// DATABASE WITH REDIS
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
                             ,cookie: { secure: false, expires: new Date(Date.now() + (365 * 86400 * 1000))  }
                            });

///////// DATABASE WITH MONGO
var mongojs = require('mongojs');
var collections = ["users", "posts", "resources"];
var db = mongojs(config.mongoConnectionString, collections);



///////// EVERNOTE
var Evernote = require('evernote').Evernote;
var EvernoteLib = require('./lib/evernote')
  , TumblrLib = require('./lib/tumblr')
  , GithubLib = require('./lib/github')
  , WordpressLib = require('./lib/wordpress');

GithubLib.db = db;
TumblrLib.db = db;
WordpressLib.db = db;

var url = require('url');
var flow = require('flow');



var hbs = require('hbs');
hbs.registerPartials(__dirname + '/views/partials');

//Setup ExpressJS
app.configure(function(){

  //Use static files
  app.set('views', __dirname + '/views');
  // app.engine('html', require('ejs').renderFile);
  app.set('view engine', 'html');
  app.engine('html', hbs.__express);

	app.use(express.cookieParser()); 
	app.use(express.bodyParser());



  app.use(session);


  app.use(function(req, res, next){

    res.locals.session = req.session;

    if (req.session && req.session.evernoteUserId && !req.user) {
      db.users.findOne({evernoteId: req.session.evernoteUserId}, function(error, user) {
        if (error) {
          console.log('requesting note found' + req.session.evernoteUserId);
          req.session.evernoteUserId = null;
        } else {
          // console.log('requesting ' + req.session.evernoteUserId);
          // console.log('requesting ' + JSON.stringify(user));
          req.user = user;
        }      
        next();
      });
    } else {
      // console.log('requesting not logged in'); #
      next();
    };
    
  });


  app.use(express.static(__dirname + "/public"));

  app.use(express.methodOverride());

  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));

  app.use(GithubLib);
  app.use(EvernoteLib);
  app.use(TumblrLib);
  app.use(WordpressLib);
});


//===================================================
//								 			ETC
//===================================================

// Welcom Page
app.get('/', function(req, res){	

	if(!req.user) //Unauthenticate User
		return res.render("login.html");


  console.log("app.get / user: " + req.session.evernoteUserId);

  var indexPageData = {};
  if (req.user.evernote && req.user.evernote.user) {
    indexPageData.user = {};
    indexPageData.user.evernote = {
      user: req.user.evernote.user
      , notebook : req.user.evernote.notebook
    }
  };
  

  var connectedEngine;
  if (req.user.github && req.user.github.user) {

    indexPageData.user.github = {
      user: req.user.github.user
      , repository : req.user.github.repository
    }
    connectedEngine = 'Github';

  } else if (req.user.tumblr && req.user.tumblr.user) {
    indexPageData.user.tumblr = {
      user: req.user.tumblr.user
      , blog : req.user.tumblr.blog
    }

    if (!req.user.tumblr.blog) {
      indexPageData.user.tumblr.blogs = req.user.tumblr.user.blogs;
    };

    connectedEngine = 'Tumblr';
  } else if (req.user.wordpress && req.user.wordpress.user) {
    indexPageData.user.wordpress = {
      user: req.user.wordpress.user
      , blog : req.user.wordpress.blog
    }

    if (!req.user.wordpress.blog) {
      indexPageData.user.wordpress.blogs = req.user.wordpress.user.blogs;
    };
    connectedEngine = 'Wordpress';
  } 
  indexPageData.connectedEngine = connectedEngine;

  db.posts.find({evernoteUserId : req.session.evernoteUserId}).count(function(error, postsCount) {
    if (postsCount > 0) {
      indexPageData.posts = {
        'count': postsCount
      };
      db.posts.find({evernoteUserId : req.session.evernoteUserId}).sort({updated: -1}).limit(1, function(error, posts) {

        if (posts.length > 0) {
          var post = posts[0];
          console.log('get latest updated: ' + post.evernote.note.title);
          indexPageData.posts.latestUpdate = post;  
        };
        
        return res.render("index.html", indexPageData);
      });

    } else {
      return res.render("index.html", indexPageData);
    };
  });

});

// Welcom Page
app.get('/home', function(req, res){
  
  console.log("app.get /home");

  var indexPageData = {};
  if (req.user && req.user.evernote && req.user.evernote.user) {
    indexPageData.user = {};
    indexPageData.user.evernote = {
      user: req.user.evernote.user
      , notebook : req.user.evernote.notebook
    }
  };
  return res.render("login.html", indexPageData);

});

//===================================================
//                Authentications
//===================================================


EvernoteLib.authenticationCallback = function(req, res, evernoteUser, token) {
  console.log("Evernote Callback to Express");

  // Check if I have this user yet.
  // If no, create one, else get him and update.

  req.session.evernoteUserId = evernoteUser.id;

  var userId = evernoteUser.id;

  console.log('user timezone '+ req.session.userTimezoneOffset);
  var user = {
    evernote : {
      user: evernoteUser
      , oauthAccessToken: token
    }
    , 'timezoneOffset': req.session.userTimezoneOffset
  };

  db.users.update({evernoteId: userId}, {$set: user}, {upsert: true}, function(err, updated) {

      if( err || !updated ) console.log("User not updated" + err);
      else console.log("User updated");

      req.user = user;
      upsertUserNotebook(req, res);
  });
}

GithubLib.authenticationCallback = function(req, res, err, token) {
  console.log("Github Callback to Express");

  var userId = req.session.evernoteUserId;


  db.users.update({evernoteId: userId}, {$set: {'github.oauthAccessToken': token}}, {upsert: true}, function(error) {
    if (error) console.log('ERROR: ' + error);
  });

  
  var _ghClient = GithubLib.apiClient();
  _ghClient.token = token;
  var _ghMe = _ghClient.me();
  _ghMe.info(function(err, data) {
    console.log("error: " + err);
    console.log("data: " + data);

    if (data) {
      // data.authToken = token;

      db.users.update({evernoteId: userId}, {$set: {'github.user': data}}, {upsert: true}, function(error) {
        if (error) console.log('ERROR: ' + error);
      });

      var userLogin = data.login;
      _ghMe.repos(function(err, data) {
          console.log("repos: " + err);
        if (err) {
          res.send(err,500);
        } else {
          

          var comRepoName = userLogin + '.github.com';
          var ioRepoName = userLogin + '.github.io';

          var foundRepo;
          for (var i = data.length - 1; i >= 0; i--) {
            var repo = data[i];
            
            if (repo.name == ioRepoName || repo.name == comRepoName) {
              foundRepo = repo;
              break;
            };
          };

          if (foundRepo) {
            console.log("Found repo " + JSON.stringify(foundRepo));

            var apiData = {
                'login' : userLogin
                , 'authToken' : token
                , 'repoName' : foundRepo.name
            };

            db.users.update({evernoteId: userId}, {$set: {'github.repository': foundRepo, 'github.apiData': apiData}}, {upsert: true}, function(error) {
              if (error) console.log('ERROR: ' + error);
            });

          } else {
            console.log("NOT Found repo. Create one");
            // Create repo

          };

          res.redirect('/#github');    
        }

      });

      
    } else {
      res.send(err,500);
    };
  });


};


/////////////////



var upsertUserNotebook = function(req, res) {


  if(!req.session.evernoteUserId) return res.send('Unauthenticate',401);


  var user = req.user;
  var userId = req.session.evernoteUserId;

  console.log("/evernote/create-notebook: " + userId);

  // Create notebook
  var notebookName = "BlogWith";
  var noteStore = EvernoteLib.Client(req.user.evernote.oauthAccessToken).getNoteStore();

  var createNotebook = function() {

    var notebookPublishing = new Evernote.Publishing({
        publicDescription: "BlogWith"
        , uri : "blogwith"
      });

    var notebook = new Evernote.Notebook({
      name: notebookName
      , published : true
      , publishing : notebookPublishing
    });

    var noteStore1 = EvernoteLib.Client(req.user.evernote.oauthAccessToken).getNoteStore();
    noteStore1.createNotebook(req.user.evernote.oauthAccessToken, notebook, 
      function onsuccess(data) {
        console.log("Created Notebook: Guid " + data.guid);
        
        db.users.update({evernoteId: userId}, {$set: {'evernote.notebook': data}}, {upsert: true}, function(error) {
          if (error) console.log('ERROR: ' + error);
          return res.redirect('/#evernote');  
        });        
        
      },
      function onerror(error) {
        console.log("Creating Notebook: Error " + error);
        return res.send(error,500);
      });
  }
  // end createNotebook

  var updateNotebook = function(notebook) {

    var notebookPublishing = new Evernote.Publishing(
      {
        publicDescription: "BlogWith"
        , uri : "blogwith"
      });

    notebook.published = true;
    notebook.publishing = notebookPublishing;

    var noteStore1 = EvernoteLib.Client(req.user.evernote.oauthAccessToken).getNoteStore();
    noteStore1.updateNotebook(req.user.evernote.oauthAccessToken, notebook, 
      function onsuccess(data) {
        console.log("Updated Notebook: Guid " + data.guid);

        db.users.update({evernoteId: userId}, {$set: {'evernote.notebook': data}}, {upsert: true}, function(error) {
          if (error) console.log('ERROR: ' + error);
          return res.redirect('/#evernote');  
        });
        
      },
      function onerror(error) {
        console.log("Update Notebook: Error " + error);
        return res.send(error,500);
      });
  }
  // end createNotebook

  var createNotebookIfNeeded = function() {
    // Check for note books
    noteStore.listNotebooks(req.user.evernote.oauthAccessToken, function(data) {
      console.log("Retrieved notebooks: " + data.length +  JSON.stringify(data));

      var foundNotebook;
      if (data) {
        // Check for "Blog with Evernote"
        for (var i = data.length - 1; i >= 0; i--) {
          var aNotebook = data[i];
          console.log("Notebook " + JSON.stringify(aNotebook));
          console.log("Notebook name" +  aNotebook.name);
          if (aNotebook.name == notebookName) {
            console.log("Found name" + aNotebook.name);

            foundNotebook = aNotebook;
            break;
          };
        };
      };

      if (foundNotebook) {
        console.log("Found notebook" + foundNotebook.guid);

        db.users.update({evernoteId: userId}, {$set: {'evernote.notebook': foundNotebook}}, {upsert: true}, function(error) {
          if (error) console.log('ERROR: ' + error);
          return res.redirect('/#evernote');  
        });

      } else {
        console.log("No notebook. Creating one");
        return createNotebook();
      };
    },
    function onerror(error) {
      console.log(error);
      return res.send(error,500);
      
    }); // list notebooks
  }


  // Check if I have notebook or not

  if (req.user.evernote && req.user.evernote.notebook) {
    var notebook = req.user.evernote.notebook;
    console.log("Notebook: " + JSON.stringify(notebook));

    //NoteStoreClient.prototype.getNotebook = function(authenticationToken, guid, callback) {
    noteStore.getNotebook(req.user.evernote.oauthAccessToken, notebook.guid, 
      function(updatedNotebook) {
        console.log("Get Notebook: " + JSON.stringify(updatedNotebook));
        // update notebook info
        if (updatedNotebook.published) {

          db.users.update({evernoteId: userId}, {$set: {'evernote.notebook': updatedNotebook}}, {upsert: true}, function(error) {
            if (error) console.log('ERROR: ' + error);
            return res.redirect('/#evernote');  
          });

        } else {
          //NoteStoreClient.prototype.updateNotebook = function(authenticationToken, notebook, callback) {
          console.log("Updating notebook");
          return updateNotebook(updatedNotebook);
        };
        
      },
      function onerror(error) {
        console.log("Get Notebook: Error " + error); 
        return createNotebookIfNeeded();
      }
    );
  } else {
    return createNotebookIfNeeded(); 
  }
};

app.get('/evernote/create-notebook', upsertUserNotebook);





////////////////////////////////////
//////////// SYNC ////////////
////////////////////////////////////


app.get('/evernote/sync2', function(req, res) {

  var BlogEngineLib = connectedBlogEngine(req.user);
  // var noteString = '{"guid":"951b6c65-0743-4b5d-8b90-8a5c1dcefdbe","title":"BlogWith is coming to Wordpress land","content":"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE en-note SYSTEM \"http://xml.evernote.com/pub/enml2.dtd\">\n<en-note><div>I love to be in Wordpress for so long.</div>\n<div>Today, finally I can post a text post to Wordpress.</div>\n<div>Yeah</div>\n<div><br clear=\"none\"/></div>\n<div>I need to work more, image is the next exciting part.</div>\n<div><br clear=\"none\"/></div>\n<div><br clear=\"none\"/></div><br/><en-media hash=\"262bc833a4bbec4da60bd27e80cd4de9\" type=\"image/jpeg\"/></en-note>","contentHash":{"0":159,"1":68,"2":61,"3":143,"4":30,"5":92,"6":185,"7":247,"8":15,"9":171,"10":77,"11":86,"12":158,"13":43,"14":91,"15":103,"BYTES_PER_ELEMENT":1,"buffer":{"0":128,"1":1,"2":0,"3":2,"4":0,"5":0,"6":0,"7":7,"8":103,"9":101,"10":116,"11":78,"12":111,"13":116,"14":101,"15":0,"16":0,"17":0,"18":0,"19":12,"20":0,"21":0,"22":11,"23":0,"24":1,"25":0,"26":0,"27":0,"28":36,"29":57,"30":53,"31":49,"32":98,"33":54,"34":99,"35":54,"36":53,"37":45,"38":48,"39":55,"40":52,"41":51,"42":45,"43":52,"44":98,"45":53,"46":100,"47":45,"48":56,"49":98,"50":57,"51":48,"52":45,"53":56,"54":97,"55":53,"56":99,"57":49,"58":100,"59":99,"60":101,"61":102,"62":100,"63":98,"64":101,"65":11,"66":0,"67":2,"68":0,"69":0,"70":0,"71":36,"72":66,"73":108,"74":111,"75":103,"76":87,"77":105,"78":116,"79":104,"80":32,"81":105,"82":115,"83":32,"84":99,"85":111,"86":109,"87":105,"88":110,"89":103,"90":32,"91":116,"92":111,"93":32,"94":87,"95":111,"96":114,"97":100,"98":112,"99":114,"100":101,"101":115,"102":115,"103":32,"104":108,"105":97,"106":110,"107":100,"108":11,"109":0,"110":3,"111":0,"112":0,"113":1,"114":245,"115":60,"116":63,"117":120,"118":109,"119":108,"120":32,"121":118,"122":101,"123":114,"124":115,"125":105,"126":111,"127":110,"128":61,"129":34,"130":49,"131":46,"132":48,"133":34,"134":32,"135":101,"136":110,"137":99,"138":111,"139":100,"140":105,"141":110,"142":103,"143":61,"144":34,"145":85,"146":84,"147":70,"148":45,"149":56,"150":34,"151":63,"152":62,"153":10,"154":60,"155":33,"156":68,"157":79,"158":67,"159":84,"160":89,"161":80,"162":69,"163":32,"164":101,"165":110,"166":45,"167":110,"168":111,"169":116,"170":101,"171":32,"172":83,"173":89,"174":83,"175":84,"176":69,"177":77,"178":32,"179":34,"180":104,"181":116,"182":116,"183":112,"184":58,"185":47,"186":47,"187":120,"188":109,"189":108,"190":46,"191":101,"192":118,"193":101,"194":114,"195":110,"196":111,"197":116,"198":101,"199":46,"200":99,"201":111,"202":109,"203":47,"204":112,"205":117,"206":98,"207":47,"208":101,"209":110,"210":109,"211":108,"212":50,"213":46,"214":100,"215":116,"216":100,"217":34,"218":62,"219":10,"220":60,"221":101,"222":110,"223":45,"224":110,"225":111,"226":116,"227":101,"228":62,"229":60,"230":100,"231":105,"232":118,"233":62,"234":73,"235":32,"236":108,"237":111,"238":118,"239":101,"240":32,"241":116,"242":111,"243":32,"244":98,"245":101,"246":32,"247":105,"248":110,"249":32,"250":87,"251":111,"252":114,"253":100,"254":112,"255":114,"256":101,"257":115,"258":115,"259":32,"260":102,"261":111,"262":114,"263":32,"264":115,"265":111,"266":32,"267":108,"268":111,"269":110,"270":103,"271":46,"272":60,"273":47,"274":100,"275":105,"276":118,"277":62,"278":10,"279":60,"280":100,"281":105,"282":118,"283":62,"284":84,"285":111,"286":100,"287":97,"288":121,"289":44,"290":32,"291":102,"292":105,"293":110,"294":97,"295":108,"296":108,"297":121,"298":32,"299":73,"300":32,"301":99,"302":97,"303":110,"304":32,"305":112,"306":111,"307":115,"308":116,"309":32,"310":97,"311":32,"312":116,"313":101,"314":120,"315":116,"316":32,"317":112,"318":111,"319":115,"320":116,"321":32,"322":116,"323":111,"324":32,"325":87,"326":111,"327":114,"328":100,"329":112,"330":114,"331":101,"332":115,"333":115,"334":46,"335":60,"336":47,"337":100,"338":105,"339":118,"340":62,"341":10,"342":60,"343":100,"344":105,"345":118,"346":62,"347":89,"348":101,"349":97,"350":104,"351":44,"352":32,"353":105,"354":116,"355":39,"356":115,"357":32,"358":97,"359":32,"360":103,"361":114,"362":101,"363":97,"364":116,"365":32,"366":110,"367":101,"368":119,"369":115,"370":46,"371":60,"372":47,"373":100,"374":105,"375":118,"376":62,"377":10,"378":60,"379":100,"380":105,"381":118,"382":62,"383":60,"384":98,"385":114,"386":32,"387":99,"388":108,"389":101,"390":97,"391":114,"392":61,"393":34,"394":110,"395":111,"396":110,"397":101,"398":34,"399":47,"400":62,"401":60,"402":47,"403":100,"404":105,"405":118,"406":62,"407":10,"408":60,"409":100,"410":105,"411":118,"412":62,"413":73,"414":32,"415":110,"416":101,"417":101,"418":100,"419":32,"420":116,"421":111,"422":32,"423":119,"424":111,"425":114,"426":107,"427":32,"428":109,"429":111,"430":114,"431":101,"432":44,"433":32,"434":105,"435":109,"436":97,"437":103,"438":101,"439":32,"440":105,"441":115,"442":32,"443":116,"444":104,"445":101,"446":32,"447":110,"448":101,"449":120,"450":116,"451":32,"452":101,"453":120,"454":99,"455":105,"456":116,"457":105,"458":110,"459":103,"460":32,"461":112,"462":97,"463":114,"464":116,"465":46,"466":60,"467":47,"468":100,"469":105,"470":118,"471":62,"472":10,"473":60,"474":100,"475":105,"476":118,"477":62,"478":60,"479":98,"480":114,"481":32,"482":99,"483":108,"484":101,"485":97,"486":114,"487":61,"488":34,"489":110,"490":111,"491":110,"492":101,"493":34,"494":47,"495":62,"496":60,"497":47,"498":100,"499":105,"500":118,"501":62,"502":10,"503":60,"504":100,"505":105,"506":118,"507":62,"508":60,"509":98,"510":114,"511":32,"512":99,"513":108,"514":101,"515":97,"516":114,"517":61,"518":34,"519":110,"520":111,"521":110,"522":101,"523":34,"524":47,"525":62,"526":60,"527":47,"528":100,"529":105,"530":118,"531":62,"532":60,"533":98,"534":114,"535":47,"536":62,"537":60,"538":101,"539":110,"540":45,"541":109,"542":101,"543":100,"544":105,"545":97,"546":32,"547":104,"548":97,"549":115,"550":104,"551":61,"552":34,"553":50,"554":54,"555":50,"556":98,"557":99,"558":56,"559":51,"560":51,"561":97,"562":52,"563":98,"564":98,"565":101,"566":99,"567":52,"568":100,"569":97,"570":54,"571":48,"572":98,"573":100,"574":50,"575":55,"576":101,"577":56,"578":48,"579":99,"580":100,"581":52,"582":100,"583":101,"584":57,"585":34,"586":32,"587":116,"588":121,"589":112,"590":101,"591":61,"592":34,"593":105,"594":109,"595":97,"596":103,"597":101,"598":47,"599":106,"600":112,"601":101,"602":103,"603":34,"604":47,"605":62,"606":60,"607":47,"608":101,"609":110,"610":45,"611":110,"612":111,"613":116,"614":101,"615":62,"616":11,"617":0,"618":4,"619":0,"620":0,"621":0,"622":16,"623":159,"624":68,"625":61,"626":143,"627":30,"628":92,"629":185,"630":247,"631":15,"632":171,"633":77,"634":86,"635":158,"636":43,"637":91,"638":103,"639":8,"640":0,"641":5,"642":0,"643":0,"644":1,"645":245,"646":10,"647":0,"648":6,"649":0,"650":0,"651":1,"652":64,"653":20,"654":10,"655":178,"656":32,"657":10,"658":0,"659":7,"660":0,"661":0,"662":1,"663":64,"664":33,"665":8,"666":120,"667":144,"668":2,"669":0,"670":9,"671":1,"672":8,"673":0,"674":10,"675":0,"676":0,"677":1,"678":164,"679":11,"680":0,"681":11,"682":0,"683":0,"684":0,"685":36,"686":50,"687":50,"688":49,"689":52,"690":51,"691":97,"692":48,"693":97,"694":45,"695":54,"696":53,"697":102,"698":53,"699":45,"700":52,"701":99,"702":98,"703":49,"704":45,"705":97,"706":57,"707":51,"708":53,"709":45,"710":52,"711":57,"712":56,"713":48,"714":97,"715":52,"716":54,"717":101,"718":48,"719":100,"720":55,"721":97,"722":15,"723":0,"724":13,"725":12,"726":0,"727":0,"728":0,"729":1,"730":11,"731":0,"732":1,"733":0,"734":0,"735":0,"736":36,"737":54,"738":57,"739":52,"740":54,"741":100,"742":52,"743":98,"744":99,"745":45,"746":52,"747":51,"748":53,"749":50,"750":45,"751":52,"752":48,"753":53,"754":48,"755":45,"756":98,"757":57,"758":56,"759":100,"760":45,"761":101,"762":102,"763":98,"764":54,"765":101,"766":48,"767":55,"768":51,"769":50,"770":55,"771":51,"772":100,"773":11,"774":0,"775":2,"776":0,"777":0,"778":0,"779":36,"780":57,"781":53,"782":49,"783":98,"784":54,"785":99,"786":54,"787":53,"788":45,"789":48,"790":55,"791":52,"792":51,"793":45,"794":52,"795":98,"796":53,"797":100,"798":45,"799":56,"800":98,"801":57,"802":48,"803":45,"804":56,"805":97,"806":53,"807":99,"808":49,"809":100,"810":99,"811":101,"812":102,"813":100,"814":98,"815":101,"816":12,"817":0,"818":3,"819":11,"820":0,"821":1,"822":0,"823":0,"824":0,"825":16,"826":38,"827":43,"828":200,"829":51,"830":164,"831":187,"832":236,"833":77,"834":166,"835":11,"836":210,"837":126,"838":128,"839":205,"840":77,"841":233,"842":8,"843":0,"844":2,"845":0,"846":2,"847":188,"848":119,"849":0,"850":11,"851":0,"852":4,"853":0,"854":0,"855":0,"856":10,"857":105,"858":109,"859":97,"860":103,"861":101,"862":47,"863":106,"864":112,"865":101,"866":103,"867":6,"868":0,"869":5,"870":2,"871":95,"872":6,"873":0,"874":6,"875":3,"876":32,"877":2,"878":0,"879":8,"880":1,"881":12,"882":0,"883":11,"884":11,"885":0,"886":10,"887":0,"888":0,"889":0,"890":28,"891":77,"892":101,"893":109,"894":101,"895":110,"896":116,"897":111,"898":45,"899":109,"900":111,"901":118,"902":105,"903":101,"904":95,"905":112,"906":111,"907":115,"908":116,"909":101,"910":114,"911":45,"912":48,"913":50,"914":46,"915":106,"916":112,"917":101,"918":103,"919":0,"920":8,"921":0,"922":12,"923":0,"924":0,"925":1,"926":165,"927":0,"928":12,"929":0,"930":14,"931":0,"932":0,"933":0,"byteLength":934},"length":16,"byteOffset":623,"byteLength":16},"contentLength":501,"created":1374725780000,"updated":1374943738000,"deleted":null,"active":true,"updateSequenceNum":420,"notebookGuid":"22143a0a-65f5-4cb1-a935-4980a46e0d7a","tagGuids":null,"resources":[{"guid":"6946d4bc-4352-4050-b98d-efb6e073273d","noteGuid":"951b6c65-0743-4b5d-8b90-8a5c1dcefdbe","data":{"bodyHash":{"0":38,"1":43,"2":200,"3":51,"4":164,"5":187,"6":236,"7":77,"8":166,"9":11,"10":210,"11":126,"12":128,"13":205,"14":77,"15":233,"BYTES_PER_ELEMENT":1,"buffer":{"0":128,"1":1,"2":0,"3":2,"4":0,"5":0,"6":0,"7":7,"8":103,"9":101,"10":116,"11":78,"12":111,"13":116,"14":101,"15":0,"16":0,"17":0,"18":0,"19":12,"20":0,"21":0,"22":11,"23":0,"24":1,"25":0,"26":0,"27":0,"28":36,"29":57,"30":53,"31":49,"32":98,"33":54,"34":99,"35":54,"36":53,"37":45,"38":48,"39":55,"40":52,"41":51,"42":45,"43":52,"44":98,"45":53,"46":100,"47":45,"48":56,"49":98,"50":57,"51":48,"52":45,"53":56,"54":97,"55":53,"56":99,"57":49,"58":100,"59":99,"60":101,"61":102,"62":100,"63":98,"64":101,"65":11,"66":0,"67":2,"68":0,"69":0,"70":0,"71":36,"72":66,"73":108,"74":111,"75":103,"76":87,"77":105,"78":116,"79":104,"80":32,"81":105,"82":115,"83":32,"84":99,"85":111,"86":109,"87":105,"88":110,"89":103,"90":32,"91":116,"92":111,"93":32,"94":87,"95":111,"96":114,"97":100,"98":112,"99":114,"100":101,"101":115,"102":115,"103":32,"104":108,"105":97,"106":110,"107":100,"108":11,"109":0,"110":3,"111":0,"112":0,"113":1,"114":245,"115":60,"116":63,"117":120,"118":109,"119":108,"120":32,"121":118,"122":101,"123":114,"124":115,"125":105,"126":111,"127":110,"128":61,"129":34,"130":49,"131":46,"132":48,"133":34,"134":32,"135":101,"136":110,"137":99,"138":111,"139":100,"140":105,"141":110,"142":103,"143":61,"144":34,"145":85,"146":84,"147":70,"148":45,"149":56,"150":34,"151":63,"152":62,"153":10,"154":60,"155":33,"156":68,"157":79,"158":67,"159":84,"160":89,"161":80,"162":69,"163":32,"164":101,"165":110,"166":45,"167":110,"168":111,"169":116,"170":101,"171":32,"172":83,"173":89,"174":83,"175":84,"176":69,"177":77,"178":32,"179":34,"180":104,"181":116,"182":116,"183":112,"184":58,"185":47,"186":47,"187":120,"188":109,"189":108,"190":46,"191":101,"192":118,"193":101,"194":114,"195":110,"196":111,"197":116,"198":101,"199":46,"200":99,"201":111,"202":109,"203":47,"204":112,"205":117,"206":98,"207":47,"208":101,"209":110,"210":109,"211":108,"212":50,"213":46,"214":100,"215":116,"216":100,"217":34,"218":62,"219":10,"220":60,"221":101,"222":110,"223":45,"224":110,"225":111,"226":116,"227":101,"228":62,"229":60,"230":100,"231":105,"232":118,"233":62,"234":73,"235":32,"236":108,"237":111,"238":118,"239":101,"240":32,"241":116,"242":111,"243":32,"244":98,"245":101,"246":32,"247":105,"248":110,"249":32,"250":87,"251":111,"252":114,"253":100,"254":112,"255":114,"256":101,"257":115,"258":115,"259":32,"260":102,"261":111,"262":114,"263":32,"264":115,"265":111,"266":32,"267":108,"268":111,"269":110,"270":103,"271":46,"272":60,"273":47,"274":100,"275":105,"276":118,"277":62,"278":10,"279":60,"280":100,"281":105,"282":118,"283":62,"284":84,"285":111,"286":100,"287":97,"288":121,"289":44,"290":32,"291":102,"292":105,"293":110,"294":97,"295":108,"296":108,"297":121,"298":32,"299":73,"300":32,"301":99,"302":97,"303":110,"304":32,"305":112,"306":111,"307":115,"308":116,"309":32,"310":97,"311":32,"312":116,"313":101,"314":120,"315":116,"316":32,"317":112,"318":111,"319":115,"320":116,"321":32,"322":116,"323":111,"324":32,"325":87,"326":111,"327":114,"328":100,"329":112,"330":114,"331":101,"332":115,"333":115,"334":46,"335":60,"336":47,"337":100,"338":105,"339":118,"340":62,"341":10,"342":60,"343":100,"344":105,"345":118,"346":62,"347":89,"348":101,"349":97,"350":104,"351":44,"352":32,"353":105,"354":116,"355":39,"356":115,"357":32,"358":97,"359":32,"360":103,"361":114,"362":101,"363":97,"364":116,"365":32,"366":110,"367":101,"368":119,"369":115,"370":46,"371":60,"372":47,"373":100,"374":105,"375":118,"376":62,"377":10,"378":60,"379":100,"380":105,"381":118,"382":62,"383":60,"384":98,"385":114,"386":32,"387":99,"388":108,"389":101,"390":97,"391":114,"392":61,"393":34,"394":110,"395":111,"396":110,"397":101,"398":34,"399":47,"400":62,"401":60,"402":47,"403":100,"404":105,"405":118,"406":62,"407":10,"408":60,"409":100,"410":105,"411":118,"412":62,"413":73,"414":32,"415":110,"416":101,"417":101,"418":100,"419":32,"420":116,"421":111,"422":32,"423":119,"424":111,"425":114,"426":107,"427":32,"428":109,"429":111,"430":114,"431":101,"432":44,"433":32,"434":105,"435":109,"436":97,"437":103,"438":101,"439":32,"440":105,"441":115,"442":32,"443":116,"444":104,"445":101,"446":32,"447":110,"448":101,"449":120,"450":116,"451":32,"452":101,"453":120,"454":99,"455":105,"456":116,"457":105,"458":110,"459":103,"460":32,"461":112,"462":97,"463":114,"464":116,"465":46,"466":60,"467":47,"468":100,"469":105,"470":118,"471":62,"472":10,"473":60,"474":100,"475":105,"476":118,"477":62,"478":60,"479":98,"480":114,"481":32,"482":99,"483":108,"484":101,"485":97,"486":114,"487":61,"488":34,"489":110,"490":111,"491":110,"492":101,"493":34,"494":47,"495":62,"496":60,"497":47,"498":100,"499":105,"500":118,"501":62,"502":10,"503":60,"504":100,"505":105,"506":118,"507":62,"508":60,"509":98,"510":114,"511":32,"512":99,"513":108,"514":101,"515":97,"516":114,"517":61,"518":34,"519":110,"520":111,"521":110,"522":101,"523":34,"524":47,"525":62,"526":60,"527":47,"528":100,"529":105,"530":118,"531":62,"532":60,"533":98,"534":114,"535":47,"536":62,"537":60,"538":101,"539":110,"540":45,"541":109,"542":101,"543":100,"544":105,"545":97,"546":32,"547":104,"548":97,"549":115,"550":104,"551":61,"552":34,"553":50,"554":54,"555":50,"556":98,"557":99,"558":56,"559":51,"560":51,"561":97,"562":52,"563":98,"564":98,"565":101,"566":99,"567":52,"568":100,"569":97,"570":54,"571":48,"572":98,"573":100,"574":50,"575":55,"576":101,"577":56,"578":48,"579":99,"580":100,"581":52,"582":100,"583":101,"584":57,"585":34,"586":32,"587":116,"588":121,"589":112,"590":101,"591":61,"592":34,"593":105,"594":109,"595":97,"596":103,"597":101,"598":47,"599":106,"600":112,"601":101,"602":103,"603":34,"604":47,"605":62,"606":60,"607":47,"608":101,"609":110,"610":45,"611":110,"612":111,"613":116,"614":101,"615":62,"616":11,"617":0,"618":4,"619":0,"620":0,"621":0,"622":16,"623":159,"624":68,"625":61,"626":143,"627":30,"628":92,"629":185,"630":247,"631":15,"632":171,"633":77,"634":86,"635":158,"636":43,"637":91,"638":103,"639":8,"640":0,"641":5,"642":0,"643":0,"644":1,"645":245,"646":10,"647":0,"648":6,"649":0,"650":0,"651":1,"652":64,"653":20,"654":10,"655":178,"656":32,"657":10,"658":0,"659":7,"660":0,"661":0,"662":1,"663":64,"664":33,"665":8,"666":120,"667":144,"668":2,"669":0,"670":9,"671":1,"672":8,"673":0,"674":10,"675":0,"676":0,"677":1,"678":164,"679":11,"680":0,"681":11,"682":0,"683":0,"684":0,"685":36,"686":50,"687":50,"688":49,"689":52,"690":51,"691":97,"692":48,"693":97,"694":45,"695":54,"696":53,"697":102,"698":53,"699":45,"700":52,"701":99,"702":98,"703":49,"704":45,"705":97,"706":57,"707":51,"708":53,"709":45,"710":52,"711":57,"712":56,"713":48,"714":97,"715":52,"716":54,"717":101,"718":48,"719":100,"720":55,"721":97,"722":15,"723":0,"724":13,"725":12,"726":0,"727":0,"728":0,"729":1,"730":11,"731":0,"732":1,"733":0,"734":0,"735":0,"736":36,"737":54,"738":57,"739":52,"740":54,"741":100,"742":52,"743":98,"744":99,"745":45,"746":52,"747":51,"748":53,"749":50,"750":45,"751":52,"752":48,"753":53,"754":48,"755":45,"756":98,"757":57,"758":56,"759":100,"760":45,"761":101,"762":102,"763":98,"764":54,"765":101,"766":48,"767":55,"768":51,"769":50,"770":55,"771":51,"772":100,"773":11,"774":0,"775":2,"776":0,"777":0,"778":0,"779":36,"780":57,"781":53,"782":49,"783":98,"784":54,"785":99,"786":54,"787":53,"788":45,"789":48,"790":55,"791":52,"792":51,"793":45,"794":52,"795":98,"796":53,"797":100,"798":45,"799":56,"800":98,"801":57,"802":48,"803":45,"804":56,"805":97,"806":53,"807":99,"808":49,"809":100,"810":99,"811":101,"812":102,"813":100,"814":98,"815":101,"816":12,"817":0,"818":3,"819":11,"820":0,"821":1,"822":0,"823":0,"824":0,"825":16,"826":38,"827":43,"828":200,"829":51,"830":164,"831":187,"832":236,"833":77,"834":166,"835":11,"836":210,"837":126,"838":128,"839":205,"840":77,"841":233,"842":8,"843":0,"844":2,"845":0,"846":2,"847":188,"848":119,"849":0,"850":11,"851":0,"852":4,"853":0,"854":0,"855":0,"856":10,"857":105,"858":109,"859":97,"860":103,"861":101,"862":47,"863":106,"864":112,"865":101,"866":103,"867":6,"868":0,"869":5,"870":2,"871":95,"872":6,"873":0,"874":6,"875":3,"876":32,"877":2,"878":0,"879":8,"880":1,"881":12,"882":0,"883":11,"884":11,"885":0,"886":10,"887":0,"888":0,"889":0,"890":28,"891":77,"892":101,"893":109,"894":101,"895":110,"896":116,"897":111,"898":45,"899":109,"900":111,"901":118,"902":105,"903":101,"904":95,"905":112,"906":111,"907":115,"908":116,"909":101,"910":114,"911":45,"912":48,"913":50,"914":46,"915":106,"916":112,"917":101,"918":103,"919":0,"920":8,"921":0,"922":12,"923":0,"924":0,"925":1,"926":165,"927":0,"928":12,"929":0,"930":14,"931":0,"932":0,"933":0,"byteLength":934},"length":16,"byteOffset":826,"byteLength":16},"size":179319,"_body":null},"mime":"image/jpeg","width":607,"height":800,"duration":null,"active":true,"recognition":null,"attributes":{"sourceURL":null,"timestamp":null,"latitude":null,"longitude":null,"altitude":null,"cameraMake":null,"cameraModel":null,"clientWillIndex":null,"recoType":null,"fileName":"Memento-movie_poster-02.jpeg","attachment":null,"applicationData":null},"updateSequenceNum":421,"alternateData":null}],"attributes":{"subjectDate":null,"latitude":null,"longitude":null,"altitude":null,"author":null,"source":null,"sourceURL":null,"sourceApplication":null,"shareDate":null,"reminderOrder":null,"reminderDoneTime":null,"reminderTime":null,"placeName":null,"contentClass":null,"applicationData":null,"lastEditedBy":null,"classifications":null,"creatorId":null,"lastEditorId":null},"tagNames":null}';
  // var note = JSON.parse(noteString);
  // console.log(note);
////"5f894c76-0060-42da-8cff-4e63be0300db"
  db.posts.findOne({evernoteGuid: '39e11189-429c-490d-a4ee-70412907d3be'}, function(error, post) {
    console.log(post);
    // BlogEngineLib.createPostWithNote(req.user, post.evernote.note, function(error, data) {
    //   console.log(data);
    // });

    BlogEngineLib.updatePostWithNote(req.user, post, post.evernote.note, function(error, data) {
      console.log(data);
    });


  });
});

app.get('/evernote/sync', function(req, res){
  console.log('/evernote/sync');

  if(!req.session.evernoteUserId) return res.send('Unauthenticate',401);
  if(!req.user.evernote) return res.send('Not connected with Evernote',401);

  var offset    = req.query.offset || 0;
  var count     = req.query.count || 50;
  var words     = req.query.words || '';
  var sortOrder = req.query.sortOrder || 'UPDATED';
  var ascending = req.query.ascending || false;

  var userId = req.session.evernoteUserId;

  var notebook = req.user.evernote.notebook;


  if (!notebook) {
    return res.send('No notebook', 500);
  } else if (!connectedBlogEngine(req.user)) {
      return res.send('Not connect blog', 500);
  }

  var notebookGuid = notebook.guid;
  
  console.log('notebookGuid ' + notebookGuid);
  
  EvernoteLib.findNotesMetadata(req.user.evernote.oauthAccessToken, {notebookGuid : notebookGuid}, function(error, noteList) {
    if (error) {
      console.log(error);
      res.send(error,500);
    } else {
      

      // filter based on notebook
      var allNotes = noteList.notes;

      console.log(" Got Notes List: " + allNotes.length);
      var filteredNotes = [];

      for (var i = allNotes.length - 1; i >= 0; i--) {
        var note = allNotes[i];
        if (note.notebookGuid == notebookGuid) {
          filteredNotes.push(note);
        } else {
          console.log("WARNING: Found note not belong to this notebook");
        };
      };

      noteList.notes = filteredNotes;

      syncNotesMetadata(req, res, noteList, function(err, data) {
        return res.send(noteList,200);
      });
    }
  });


  var syncNotesMetadata = function(req, res, notesMetadata, callback) {
    console.log('syncNotesMetadata');

    if(!req.session.evernoteUserId) return res.send('Unauthenticate',401);
    if(!req.user.evernote) return res.send('Not connected with Evernote',401);

    // Get old notesMetadata
    var userId = req.session.evernoteUserId;


    var newNotes = notesMetadata.notes;

    // test
    // console.log('test');

    // var BlogEngineLib = connectedBlogEngine(req.user);
    // var noteString = '{"guid":"951b6c65-0743-4b5d-8b90-8a5c1dcefdbe","title":"BlogWith is coming to Wordpress land","content":"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE en-note SYSTEM \"http://xml.evernote.com/pub/enml2.dtd\">\n<en-note><div>I love to be in Wordpress for so long.</div>\n<div>Today, finally I can post a text post to Wordpress.</div>\n<div>Yeah</div>\n<div><br clear=\"none\"/></div>\n<div>I need to work more, image is the next exciting part.</div>\n<div><br clear=\"none\"/></div>\n<div><br clear=\"none\"/></div><br/><en-media hash=\"262bc833a4bbec4da60bd27e80cd4de9\" type=\"image/jpeg\"/></en-note>","contentHash":{"0":159,"1":68,"2":61,"3":143,"4":30,"5":92,"6":185,"7":247,"8":15,"9":171,"10":77,"11":86,"12":158,"13":43,"14":91,"15":103,"BYTES_PER_ELEMENT":1,"buffer":{"0":128,"1":1,"2":0,"3":2,"4":0,"5":0,"6":0,"7":7,"8":103,"9":101,"10":116,"11":78,"12":111,"13":116,"14":101,"15":0,"16":0,"17":0,"18":0,"19":12,"20":0,"21":0,"22":11,"23":0,"24":1,"25":0,"26":0,"27":0,"28":36,"29":57,"30":53,"31":49,"32":98,"33":54,"34":99,"35":54,"36":53,"37":45,"38":48,"39":55,"40":52,"41":51,"42":45,"43":52,"44":98,"45":53,"46":100,"47":45,"48":56,"49":98,"50":57,"51":48,"52":45,"53":56,"54":97,"55":53,"56":99,"57":49,"58":100,"59":99,"60":101,"61":102,"62":100,"63":98,"64":101,"65":11,"66":0,"67":2,"68":0,"69":0,"70":0,"71":36,"72":66,"73":108,"74":111,"75":103,"76":87,"77":105,"78":116,"79":104,"80":32,"81":105,"82":115,"83":32,"84":99,"85":111,"86":109,"87":105,"88":110,"89":103,"90":32,"91":116,"92":111,"93":32,"94":87,"95":111,"96":114,"97":100,"98":112,"99":114,"100":101,"101":115,"102":115,"103":32,"104":108,"105":97,"106":110,"107":100,"108":11,"109":0,"110":3,"111":0,"112":0,"113":1,"114":245,"115":60,"116":63,"117":120,"118":109,"119":108,"120":32,"121":118,"122":101,"123":114,"124":115,"125":105,"126":111,"127":110,"128":61,"129":34,"130":49,"131":46,"132":48,"133":34,"134":32,"135":101,"136":110,"137":99,"138":111,"139":100,"140":105,"141":110,"142":103,"143":61,"144":34,"145":85,"146":84,"147":70,"148":45,"149":56,"150":34,"151":63,"152":62,"153":10,"154":60,"155":33,"156":68,"157":79,"158":67,"159":84,"160":89,"161":80,"162":69,"163":32,"164":101,"165":110,"166":45,"167":110,"168":111,"169":116,"170":101,"171":32,"172":83,"173":89,"174":83,"175":84,"176":69,"177":77,"178":32,"179":34,"180":104,"181":116,"182":116,"183":112,"184":58,"185":47,"186":47,"187":120,"188":109,"189":108,"190":46,"191":101,"192":118,"193":101,"194":114,"195":110,"196":111,"197":116,"198":101,"199":46,"200":99,"201":111,"202":109,"203":47,"204":112,"205":117,"206":98,"207":47,"208":101,"209":110,"210":109,"211":108,"212":50,"213":46,"214":100,"215":116,"216":100,"217":34,"218":62,"219":10,"220":60,"221":101,"222":110,"223":45,"224":110,"225":111,"226":116,"227":101,"228":62,"229":60,"230":100,"231":105,"232":118,"233":62,"234":73,"235":32,"236":108,"237":111,"238":118,"239":101,"240":32,"241":116,"242":111,"243":32,"244":98,"245":101,"246":32,"247":105,"248":110,"249":32,"250":87,"251":111,"252":114,"253":100,"254":112,"255":114,"256":101,"257":115,"258":115,"259":32,"260":102,"261":111,"262":114,"263":32,"264":115,"265":111,"266":32,"267":108,"268":111,"269":110,"270":103,"271":46,"272":60,"273":47,"274":100,"275":105,"276":118,"277":62,"278":10,"279":60,"280":100,"281":105,"282":118,"283":62,"284":84,"285":111,"286":100,"287":97,"288":121,"289":44,"290":32,"291":102,"292":105,"293":110,"294":97,"295":108,"296":108,"297":121,"298":32,"299":73,"300":32,"301":99,"302":97,"303":110,"304":32,"305":112,"306":111,"307":115,"308":116,"309":32,"310":97,"311":32,"312":116,"313":101,"314":120,"315":116,"316":32,"317":112,"318":111,"319":115,"320":116,"321":32,"322":116,"323":111,"324":32,"325":87,"326":111,"327":114,"328":100,"329":112,"330":114,"331":101,"332":115,"333":115,"334":46,"335":60,"336":47,"337":100,"338":105,"339":118,"340":62,"341":10,"342":60,"343":100,"344":105,"345":118,"346":62,"347":89,"348":101,"349":97,"350":104,"351":44,"352":32,"353":105,"354":116,"355":39,"356":115,"357":32,"358":97,"359":32,"360":103,"361":114,"362":101,"363":97,"364":116,"365":32,"366":110,"367":101,"368":119,"369":115,"370":46,"371":60,"372":47,"373":100,"374":105,"375":118,"376":62,"377":10,"378":60,"379":100,"380":105,"381":118,"382":62,"383":60,"384":98,"385":114,"386":32,"387":99,"388":108,"389":101,"390":97,"391":114,"392":61,"393":34,"394":110,"395":111,"396":110,"397":101,"398":34,"399":47,"400":62,"401":60,"402":47,"403":100,"404":105,"405":118,"406":62,"407":10,"408":60,"409":100,"410":105,"411":118,"412":62,"413":73,"414":32,"415":110,"416":101,"417":101,"418":100,"419":32,"420":116,"421":111,"422":32,"423":119,"424":111,"425":114,"426":107,"427":32,"428":109,"429":111,"430":114,"431":101,"432":44,"433":32,"434":105,"435":109,"436":97,"437":103,"438":101,"439":32,"440":105,"441":115,"442":32,"443":116,"444":104,"445":101,"446":32,"447":110,"448":101,"449":120,"450":116,"451":32,"452":101,"453":120,"454":99,"455":105,"456":116,"457":105,"458":110,"459":103,"460":32,"461":112,"462":97,"463":114,"464":116,"465":46,"466":60,"467":47,"468":100,"469":105,"470":118,"471":62,"472":10,"473":60,"474":100,"475":105,"476":118,"477":62,"478":60,"479":98,"480":114,"481":32,"482":99,"483":108,"484":101,"485":97,"486":114,"487":61,"488":34,"489":110,"490":111,"491":110,"492":101,"493":34,"494":47,"495":62,"496":60,"497":47,"498":100,"499":105,"500":118,"501":62,"502":10,"503":60,"504":100,"505":105,"506":118,"507":62,"508":60,"509":98,"510":114,"511":32,"512":99,"513":108,"514":101,"515":97,"516":114,"517":61,"518":34,"519":110,"520":111,"521":110,"522":101,"523":34,"524":47,"525":62,"526":60,"527":47,"528":100,"529":105,"530":118,"531":62,"532":60,"533":98,"534":114,"535":47,"536":62,"537":60,"538":101,"539":110,"540":45,"541":109,"542":101,"543":100,"544":105,"545":97,"546":32,"547":104,"548":97,"549":115,"550":104,"551":61,"552":34,"553":50,"554":54,"555":50,"556":98,"557":99,"558":56,"559":51,"560":51,"561":97,"562":52,"563":98,"564":98,"565":101,"566":99,"567":52,"568":100,"569":97,"570":54,"571":48,"572":98,"573":100,"574":50,"575":55,"576":101,"577":56,"578":48,"579":99,"580":100,"581":52,"582":100,"583":101,"584":57,"585":34,"586":32,"587":116,"588":121,"589":112,"590":101,"591":61,"592":34,"593":105,"594":109,"595":97,"596":103,"597":101,"598":47,"599":106,"600":112,"601":101,"602":103,"603":34,"604":47,"605":62,"606":60,"607":47,"608":101,"609":110,"610":45,"611":110,"612":111,"613":116,"614":101,"615":62,"616":11,"617":0,"618":4,"619":0,"620":0,"621":0,"622":16,"623":159,"624":68,"625":61,"626":143,"627":30,"628":92,"629":185,"630":247,"631":15,"632":171,"633":77,"634":86,"635":158,"636":43,"637":91,"638":103,"639":8,"640":0,"641":5,"642":0,"643":0,"644":1,"645":245,"646":10,"647":0,"648":6,"649":0,"650":0,"651":1,"652":64,"653":20,"654":10,"655":178,"656":32,"657":10,"658":0,"659":7,"660":0,"661":0,"662":1,"663":64,"664":33,"665":8,"666":120,"667":144,"668":2,"669":0,"670":9,"671":1,"672":8,"673":0,"674":10,"675":0,"676":0,"677":1,"678":164,"679":11,"680":0,"681":11,"682":0,"683":0,"684":0,"685":36,"686":50,"687":50,"688":49,"689":52,"690":51,"691":97,"692":48,"693":97,"694":45,"695":54,"696":53,"697":102,"698":53,"699":45,"700":52,"701":99,"702":98,"703":49,"704":45,"705":97,"706":57,"707":51,"708":53,"709":45,"710":52,"711":57,"712":56,"713":48,"714":97,"715":52,"716":54,"717":101,"718":48,"719":100,"720":55,"721":97,"722":15,"723":0,"724":13,"725":12,"726":0,"727":0,"728":0,"729":1,"730":11,"731":0,"732":1,"733":0,"734":0,"735":0,"736":36,"737":54,"738":57,"739":52,"740":54,"741":100,"742":52,"743":98,"744":99,"745":45,"746":52,"747":51,"748":53,"749":50,"750":45,"751":52,"752":48,"753":53,"754":48,"755":45,"756":98,"757":57,"758":56,"759":100,"760":45,"761":101,"762":102,"763":98,"764":54,"765":101,"766":48,"767":55,"768":51,"769":50,"770":55,"771":51,"772":100,"773":11,"774":0,"775":2,"776":0,"777":0,"778":0,"779":36,"780":57,"781":53,"782":49,"783":98,"784":54,"785":99,"786":54,"787":53,"788":45,"789":48,"790":55,"791":52,"792":51,"793":45,"794":52,"795":98,"796":53,"797":100,"798":45,"799":56,"800":98,"801":57,"802":48,"803":45,"804":56,"805":97,"806":53,"807":99,"808":49,"809":100,"810":99,"811":101,"812":102,"813":100,"814":98,"815":101,"816":12,"817":0,"818":3,"819":11,"820":0,"821":1,"822":0,"823":0,"824":0,"825":16,"826":38,"827":43,"828":200,"829":51,"830":164,"831":187,"832":236,"833":77,"834":166,"835":11,"836":210,"837":126,"838":128,"839":205,"840":77,"841":233,"842":8,"843":0,"844":2,"845":0,"846":2,"847":188,"848":119,"849":0,"850":11,"851":0,"852":4,"853":0,"854":0,"855":0,"856":10,"857":105,"858":109,"859":97,"860":103,"861":101,"862":47,"863":106,"864":112,"865":101,"866":103,"867":6,"868":0,"869":5,"870":2,"871":95,"872":6,"873":0,"874":6,"875":3,"876":32,"877":2,"878":0,"879":8,"880":1,"881":12,"882":0,"883":11,"884":11,"885":0,"886":10,"887":0,"888":0,"889":0,"890":28,"891":77,"892":101,"893":109,"894":101,"895":110,"896":116,"897":111,"898":45,"899":109,"900":111,"901":118,"902":105,"903":101,"904":95,"905":112,"906":111,"907":115,"908":116,"909":101,"910":114,"911":45,"912":48,"913":50,"914":46,"915":106,"916":112,"917":101,"918":103,"919":0,"920":8,"921":0,"922":12,"923":0,"924":0,"925":1,"926":165,"927":0,"928":12,"929":0,"930":14,"931":0,"932":0,"933":0,"byteLength":934},"length":16,"byteOffset":623,"byteLength":16},"contentLength":501,"created":1374725780000,"updated":1374943738000,"deleted":null,"active":true,"updateSequenceNum":420,"notebookGuid":"22143a0a-65f5-4cb1-a935-4980a46e0d7a","tagGuids":null,"resources":[{"guid":"6946d4bc-4352-4050-b98d-efb6e073273d","noteGuid":"951b6c65-0743-4b5d-8b90-8a5c1dcefdbe","data":{"bodyHash":{"0":38,"1":43,"2":200,"3":51,"4":164,"5":187,"6":236,"7":77,"8":166,"9":11,"10":210,"11":126,"12":128,"13":205,"14":77,"15":233,"BYTES_PER_ELEMENT":1,"buffer":{"0":128,"1":1,"2":0,"3":2,"4":0,"5":0,"6":0,"7":7,"8":103,"9":101,"10":116,"11":78,"12":111,"13":116,"14":101,"15":0,"16":0,"17":0,"18":0,"19":12,"20":0,"21":0,"22":11,"23":0,"24":1,"25":0,"26":0,"27":0,"28":36,"29":57,"30":53,"31":49,"32":98,"33":54,"34":99,"35":54,"36":53,"37":45,"38":48,"39":55,"40":52,"41":51,"42":45,"43":52,"44":98,"45":53,"46":100,"47":45,"48":56,"49":98,"50":57,"51":48,"52":45,"53":56,"54":97,"55":53,"56":99,"57":49,"58":100,"59":99,"60":101,"61":102,"62":100,"63":98,"64":101,"65":11,"66":0,"67":2,"68":0,"69":0,"70":0,"71":36,"72":66,"73":108,"74":111,"75":103,"76":87,"77":105,"78":116,"79":104,"80":32,"81":105,"82":115,"83":32,"84":99,"85":111,"86":109,"87":105,"88":110,"89":103,"90":32,"91":116,"92":111,"93":32,"94":87,"95":111,"96":114,"97":100,"98":112,"99":114,"100":101,"101":115,"102":115,"103":32,"104":108,"105":97,"106":110,"107":100,"108":11,"109":0,"110":3,"111":0,"112":0,"113":1,"114":245,"115":60,"116":63,"117":120,"118":109,"119":108,"120":32,"121":118,"122":101,"123":114,"124":115,"125":105,"126":111,"127":110,"128":61,"129":34,"130":49,"131":46,"132":48,"133":34,"134":32,"135":101,"136":110,"137":99,"138":111,"139":100,"140":105,"141":110,"142":103,"143":61,"144":34,"145":85,"146":84,"147":70,"148":45,"149":56,"150":34,"151":63,"152":62,"153":10,"154":60,"155":33,"156":68,"157":79,"158":67,"159":84,"160":89,"161":80,"162":69,"163":32,"164":101,"165":110,"166":45,"167":110,"168":111,"169":116,"170":101,"171":32,"172":83,"173":89,"174":83,"175":84,"176":69,"177":77,"178":32,"179":34,"180":104,"181":116,"182":116,"183":112,"184":58,"185":47,"186":47,"187":120,"188":109,"189":108,"190":46,"191":101,"192":118,"193":101,"194":114,"195":110,"196":111,"197":116,"198":101,"199":46,"200":99,"201":111,"202":109,"203":47,"204":112,"205":117,"206":98,"207":47,"208":101,"209":110,"210":109,"211":108,"212":50,"213":46,"214":100,"215":116,"216":100,"217":34,"218":62,"219":10,"220":60,"221":101,"222":110,"223":45,"224":110,"225":111,"226":116,"227":101,"228":62,"229":60,"230":100,"231":105,"232":118,"233":62,"234":73,"235":32,"236":108,"237":111,"238":118,"239":101,"240":32,"241":116,"242":111,"243":32,"244":98,"245":101,"246":32,"247":105,"248":110,"249":32,"250":87,"251":111,"252":114,"253":100,"254":112,"255":114,"256":101,"257":115,"258":115,"259":32,"260":102,"261":111,"262":114,"263":32,"264":115,"265":111,"266":32,"267":108,"268":111,"269":110,"270":103,"271":46,"272":60,"273":47,"274":100,"275":105,"276":118,"277":62,"278":10,"279":60,"280":100,"281":105,"282":118,"283":62,"284":84,"285":111,"286":100,"287":97,"288":121,"289":44,"290":32,"291":102,"292":105,"293":110,"294":97,"295":108,"296":108,"297":121,"298":32,"299":73,"300":32,"301":99,"302":97,"303":110,"304":32,"305":112,"306":111,"307":115,"308":116,"309":32,"310":97,"311":32,"312":116,"313":101,"314":120,"315":116,"316":32,"317":112,"318":111,"319":115,"320":116,"321":32,"322":116,"323":111,"324":32,"325":87,"326":111,"327":114,"328":100,"329":112,"330":114,"331":101,"332":115,"333":115,"334":46,"335":60,"336":47,"337":100,"338":105,"339":118,"340":62,"341":10,"342":60,"343":100,"344":105,"345":118,"346":62,"347":89,"348":101,"349":97,"350":104,"351":44,"352":32,"353":105,"354":116,"355":39,"356":115,"357":32,"358":97,"359":32,"360":103,"361":114,"362":101,"363":97,"364":116,"365":32,"366":110,"367":101,"368":119,"369":115,"370":46,"371":60,"372":47,"373":100,"374":105,"375":118,"376":62,"377":10,"378":60,"379":100,"380":105,"381":118,"382":62,"383":60,"384":98,"385":114,"386":32,"387":99,"388":108,"389":101,"390":97,"391":114,"392":61,"393":34,"394":110,"395":111,"396":110,"397":101,"398":34,"399":47,"400":62,"401":60,"402":47,"403":100,"404":105,"405":118,"406":62,"407":10,"408":60,"409":100,"410":105,"411":118,"412":62,"413":73,"414":32,"415":110,"416":101,"417":101,"418":100,"419":32,"420":116,"421":111,"422":32,"423":119,"424":111,"425":114,"426":107,"427":32,"428":109,"429":111,"430":114,"431":101,"432":44,"433":32,"434":105,"435":109,"436":97,"437":103,"438":101,"439":32,"440":105,"441":115,"442":32,"443":116,"444":104,"445":101,"446":32,"447":110,"448":101,"449":120,"450":116,"451":32,"452":101,"453":120,"454":99,"455":105,"456":116,"457":105,"458":110,"459":103,"460":32,"461":112,"462":97,"463":114,"464":116,"465":46,"466":60,"467":47,"468":100,"469":105,"470":118,"471":62,"472":10,"473":60,"474":100,"475":105,"476":118,"477":62,"478":60,"479":98,"480":114,"481":32,"482":99,"483":108,"484":101,"485":97,"486":114,"487":61,"488":34,"489":110,"490":111,"491":110,"492":101,"493":34,"494":47,"495":62,"496":60,"497":47,"498":100,"499":105,"500":118,"501":62,"502":10,"503":60,"504":100,"505":105,"506":118,"507":62,"508":60,"509":98,"510":114,"511":32,"512":99,"513":108,"514":101,"515":97,"516":114,"517":61,"518":34,"519":110,"520":111,"521":110,"522":101,"523":34,"524":47,"525":62,"526":60,"527":47,"528":100,"529":105,"530":118,"531":62,"532":60,"533":98,"534":114,"535":47,"536":62,"537":60,"538":101,"539":110,"540":45,"541":109,"542":101,"543":100,"544":105,"545":97,"546":32,"547":104,"548":97,"549":115,"550":104,"551":61,"552":34,"553":50,"554":54,"555":50,"556":98,"557":99,"558":56,"559":51,"560":51,"561":97,"562":52,"563":98,"564":98,"565":101,"566":99,"567":52,"568":100,"569":97,"570":54,"571":48,"572":98,"573":100,"574":50,"575":55,"576":101,"577":56,"578":48,"579":99,"580":100,"581":52,"582":100,"583":101,"584":57,"585":34,"586":32,"587":116,"588":121,"589":112,"590":101,"591":61,"592":34,"593":105,"594":109,"595":97,"596":103,"597":101,"598":47,"599":106,"600":112,"601":101,"602":103,"603":34,"604":47,"605":62,"606":60,"607":47,"608":101,"609":110,"610":45,"611":110,"612":111,"613":116,"614":101,"615":62,"616":11,"617":0,"618":4,"619":0,"620":0,"621":0,"622":16,"623":159,"624":68,"625":61,"626":143,"627":30,"628":92,"629":185,"630":247,"631":15,"632":171,"633":77,"634":86,"635":158,"636":43,"637":91,"638":103,"639":8,"640":0,"641":5,"642":0,"643":0,"644":1,"645":245,"646":10,"647":0,"648":6,"649":0,"650":0,"651":1,"652":64,"653":20,"654":10,"655":178,"656":32,"657":10,"658":0,"659":7,"660":0,"661":0,"662":1,"663":64,"664":33,"665":8,"666":120,"667":144,"668":2,"669":0,"670":9,"671":1,"672":8,"673":0,"674":10,"675":0,"676":0,"677":1,"678":164,"679":11,"680":0,"681":11,"682":0,"683":0,"684":0,"685":36,"686":50,"687":50,"688":49,"689":52,"690":51,"691":97,"692":48,"693":97,"694":45,"695":54,"696":53,"697":102,"698":53,"699":45,"700":52,"701":99,"702":98,"703":49,"704":45,"705":97,"706":57,"707":51,"708":53,"709":45,"710":52,"711":57,"712":56,"713":48,"714":97,"715":52,"716":54,"717":101,"718":48,"719":100,"720":55,"721":97,"722":15,"723":0,"724":13,"725":12,"726":0,"727":0,"728":0,"729":1,"730":11,"731":0,"732":1,"733":0,"734":0,"735":0,"736":36,"737":54,"738":57,"739":52,"740":54,"741":100,"742":52,"743":98,"744":99,"745":45,"746":52,"747":51,"748":53,"749":50,"750":45,"751":52,"752":48,"753":53,"754":48,"755":45,"756":98,"757":57,"758":56,"759":100,"760":45,"761":101,"762":102,"763":98,"764":54,"765":101,"766":48,"767":55,"768":51,"769":50,"770":55,"771":51,"772":100,"773":11,"774":0,"775":2,"776":0,"777":0,"778":0,"779":36,"780":57,"781":53,"782":49,"783":98,"784":54,"785":99,"786":54,"787":53,"788":45,"789":48,"790":55,"791":52,"792":51,"793":45,"794":52,"795":98,"796":53,"797":100,"798":45,"799":56,"800":98,"801":57,"802":48,"803":45,"804":56,"805":97,"806":53,"807":99,"808":49,"809":100,"810":99,"811":101,"812":102,"813":100,"814":98,"815":101,"816":12,"817":0,"818":3,"819":11,"820":0,"821":1,"822":0,"823":0,"824":0,"825":16,"826":38,"827":43,"828":200,"829":51,"830":164,"831":187,"832":236,"833":77,"834":166,"835":11,"836":210,"837":126,"838":128,"839":205,"840":77,"841":233,"842":8,"843":0,"844":2,"845":0,"846":2,"847":188,"848":119,"849":0,"850":11,"851":0,"852":4,"853":0,"854":0,"855":0,"856":10,"857":105,"858":109,"859":97,"860":103,"861":101,"862":47,"863":106,"864":112,"865":101,"866":103,"867":6,"868":0,"869":5,"870":2,"871":95,"872":6,"873":0,"874":6,"875":3,"876":32,"877":2,"878":0,"879":8,"880":1,"881":12,"882":0,"883":11,"884":11,"885":0,"886":10,"887":0,"888":0,"889":0,"890":28,"891":77,"892":101,"893":109,"894":101,"895":110,"896":116,"897":111,"898":45,"899":109,"900":111,"901":118,"902":105,"903":101,"904":95,"905":112,"906":111,"907":115,"908":116,"909":101,"910":114,"911":45,"912":48,"913":50,"914":46,"915":106,"916":112,"917":101,"918":103,"919":0,"920":8,"921":0,"922":12,"923":0,"924":0,"925":1,"926":165,"927":0,"928":12,"929":0,"930":14,"931":0,"932":0,"933":0,"byteLength":934},"length":16,"byteOffset":826,"byteLength":16},"size":179319,"_body":null},"mime":"image/jpeg","width":607,"height":800,"duration":null,"active":true,"recognition":null,"attributes":{"sourceURL":null,"timestamp":null,"latitude":null,"longitude":null,"altitude":null,"cameraMake":null,"cameraModel":null,"clientWillIndex":null,"recoType":null,"fileName":"Memento-movie_poster-02.jpeg","attachment":null,"applicationData":null},"updateSequenceNum":421,"alternateData":null}],"attributes":{"subjectDate":null,"latitude":null,"longitude":null,"altitude":null,"author":null,"source":null,"sourceURL":null,"sourceApplication":null,"shareDate":null,"reminderOrder":null,"reminderDoneTime":null,"reminderTime":null,"placeName":null,"contentClass":null,"applicationData":null,"lastEditedBy":null,"classifications":null,"creatorId":null,"lastEditorId":null},"tagNames":null}';
    // var note = JSON.parse(noteString);
    // console.log(note);

    // BlogEngineLib.createPostWithNote(user, note, function(error, data) {
    //   callback(error, data);
    // });
    // createPostWithMetadata(req.user, newNotes[0].guid, null, callback);
    // updatePostWithMetadata(req.user, newNotes[0].guid, null, callback);
    // checkUpdateForPost(req.user, newNotes[0], callback);

    // return;
    // end test


    flow.serialForEach(newNotes, function(note) {
      checkUpdateForPost(req.user, note, this);
    },function() {
      // callback for previous function

    },function() {
      // save note metadata here
      console.log("DONE: syncNotesMetadata");
      callback(null);
    });
  };


});



//////////////

var checkUpdateForPost = function(user, note, callback) {

  db.posts.findOne({evernoteGuid: note.guid}, function(error, post) {


    if (!post) {
      console.log('New post: ' + note.title);

      createPostWithMetadata(user, note.guid, null, callback);
    } else if (note.updated != post.evernoteUpdated) {
      // update note
      console.log('Get `updated` for note ' + note.title + ': ' + post.evernoteUpdated);
      updatePostWithMetadata(user, note.guid, null, callback);
    } else {
      console.log('Old post: ' + note.title);
      callback(null);
    };
  });
}


var connectedBlogEngine = function (user) {

  if (user.github && user.github.repository) {
    return GithubLib;

  } else if (user.tumblr && user.tumblr.blog) {
    return TumblrLib;

  } else if (user.wordpress && user.wordpress.blog){
    return WordpressLib;

  } else {
    return null;
  }
}

var createPostWithMetadata = function(user, noteGuid, validateWithNotebookGuid, callback) {
  var noteStore = EvernoteLib.Client(user.evernote.oauthAccessToken).getNoteStore();
  // console.log("createPostWithMetadata: " + noteGuid);
  //getNote = function(authenticationToken, guid, withContent, withResourcesData, withResourcesRecognition, withResourcesAlternateData, callback) {
  noteStore.getNote(user.evernote.oauthAccessToken, noteGuid, true, false, false, false, function(note) {
    // console.log('Get note for creating: - Note: ' + note.title);

    if (validateWithNotebookGuid && note.notebookGuid != validateWithNotebookGuid) {
      // console.log("Validate notebook failed! " + note.notebookGuid + " vs " + validateWithNotebookGuid);
      callback("Validate notebook failed!");
      return;
    };

    // note.timezoneOffset = user.timezoneOffset;
    // note.timezone = user.timezone;


    // Choose engine and create

    var BlogEngineLib = connectedBlogEngine(user);
    BlogEngineLib.createPostWithNote(user, note, function(error, data) {
      callback(error, data);
    });

  }, function onerror(error) {
    // console.log("createPostWithMetadata" + error);
    callback(error);
  });
}

var updatePostWithMetadata = function(user, noteGuid, validateWithNotebookGuid, callback) {
  console.log('updatePostWithMetadata ' + noteGuid);

  // console.log(user);

  var noteStore = EvernoteLib.Client(user.evernote.oauthAccessToken).getNoteStore();

  noteStore.getNote(user.evernote.oauthAccessToken, noteGuid, true, false, false, false, function(evernoteNote) {
    
    console.log('Get note for updating: Note: ' + evernoteNote.title);


    if (validateWithNotebookGuid && evernoteNote.notebookGuid != validateWithNotebookGuid) {
      // console.log("Validate notebook failed! " + evernoteNote.notebookGuid + " vs " + validateWithNotebookGuid);
      callback("Validate notebook failed!");
      return;
    };
    
    // redisClient.set('users:' + userId + ':posts:' + guid + ':githubData', JSON.stringify(data));
    var userId = user.id;

    db.posts.findOne({evernoteGuid: evernoteNote.guid}, function(error, post) {
      if(error) {
        return callback(error);
      }

      var BlogEngineLib = connectedBlogEngine(user);

      if (post) {
        // console.log(data);
        BlogEngineLib.updatePostWithNote(user, post, evernoteNote, function(error, data) {
          callback(error, data);
        });
         
      } else { // for call from webhook
        console.log('Can not find post. Create instead');
        // note.timezoneOffset = user.timezoneOffset;
        // note.timezone = user.timezone;

        BlogEngineLib.createPostWithNote(user, evernoteNote, function(error, data) {
          callback(error, data);
        });

      };

    });
  }, function onerror(error) {
    callback(error);
  });
}

var initBlogWithNotesMetadata = function(req, res, notesMetadata) {
  console.log('initBlogWithNotesMetadata');

  var userId = req.session.evernoteUserId;

  var newNotes = notesMetadata.notes;
  flow.serialForEach(newNotes, function(note) {
    checkUpdateForPost(req.user, note, this);
  },function() {
    // console.log("DONE: syncNotesMetadata");
  }, function() {
    console.log("DONE: initBlogWithNotesMetadata");
  });


}





/////////////////////////////////////////


app.get('/evernote/webhook', function(req, res){

  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;
  
  var evernoteUserId = parseInt(query.userId.trim());
  var noteGuid = query.guid;
  var reason = query.reason;

  db.users.findOne({'evernoteId': evernoteUserId}, function(error, user) {
    if (error || !user) {
      // console.log('Can not find user ' + userId);
      res.end('');
      return;
    }
    
    // console.log('Found userId: ' + user.evernoteId);

    if (!(user && user.evernote && user.evernote.notebook)) {
      // console.log('Can not find notebook');
      res.end('');      
      return;
    } else if (!connectedBlogEngine(user)) {
      // console.log('Can not find connected blog engine.');
      res.end('');
      return; 
    }

    var notebook = user.evernote.notebook;

    // check for notebook
    var noteStore = EvernoteLib.Client(user.evernote.oauthAccessToken).getNoteStore();

    noteStore.getNote(user.evernote.oauthAccessToken, noteGuid, false, false, false, false, function(evernoteNote) {

      if (evernoteNote.notebookGuid != notebook.guid) {
        // console.log("Validate notebook failed! " + evernoteNote.notebookGuid + " vs " + notebook.guid);
        res.end('', 200);
        return;
      };

      if (reason == 'create') {
        createPostWithMetadata(user, noteGuid, notebook.guid, function(error, data){
          if (error) {
            console.log(error);
          };
        });
      } else if (reason == 'update') {
        updatePostWithMetadata(user, noteGuid, notebook.guid, function(error, data){
          if (error) {
            console.log(error);
          };
        });
      } 

      res.end('', 200);     

    });    

 

  });
});


//test

app.get('/evernote/test/create', function(req, res){
  
  if(!req.session.user)
    return res.send('Please, provide valid authToken',401);

  db.users.findOne({evernoteId: req.session.evernoteUserId}, function(error, user) {
    if (error) {
      return res.send(error,500); 
    } else {
      return res.send(user,200);   
    }
  });

});


app.get('/me', function(req, res){
  
  if(!req.session.user)
    return res.send('Please, provide valid authToken',401);

  db.users.findOne({evernoteId: req.session.evernoteUserId}, function(error, user) {
    if (error) {
      return res.send(error,500); 
    } else {
      return res.send(user,200);   
    }
  });

});

server.listen(config.serverPort, function(){
  console.log("Express server listening on port " + config.serverPort)
})


// process.on('uncaughtException', function(err) {
//   console.error(err.stack);
// });