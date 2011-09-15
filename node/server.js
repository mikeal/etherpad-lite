/**
 * This module is started with bin/run.sh. It sets up a Express HTTP and a Socket.IO Server.
 * Static file Requests are answered directly from this module, Socket.IO messages are passed
 * to MessageHandler and minfied requests are passed to minified.
 */

/*
 * 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var nopt = require('nopt');
var log4js = require('log4js');
var os = require("os");
var events = require("events");
var socketio = require('socket.io');
var fs = require('fs');
var util = require('util');
var crypto = require('crypto');
var settings = require('./utils/Settings');
var db = require('./db/DB');
var mimetypes = require('./mimetypes');
var rfc822 = require('./rfc822');
var async = require('async');
var express = require('express');
var path = require('path');
var minify = require('./utils/Minify');
var formidable = require('formidable');
var apiHandler;
var exportHandler;
var importHandler;
var exporthtml;
var readOnlyManager;
var padManager;
var securityManager;
var socketIORouter;
var filemap = {};

var argv = nopt({
    'port':Number
    , 'environment':['staging', 'production']
  }
  , {
    'p': ['--port']
    , 'e': ['--environment']
}, process.argv);

// clone function
function clone (self) {
  var newObj = (self instanceof Array) ? [] : {};
  for (i in self) {
    if (i == 'clone') continue;
    if (self[i] && typeof self[i] == "object") {
      newObj[i] = self[i].clone();
    } else newObj[i] = self[i]
  } return newObj;
};

// Buffer response
function HTTPBuffer (buffer, headers) {
  var self = this
  if (!Buffer.isBuffer(buffer)) buffer = new Buffer(buffer)
  self.writable = true
  self.readable = true
  self.buffer = buffer

  self.md5 = crypto.createHash('md5').update(self.buffer).digest("hex");

  self.created = new Date()
  self.headers = headers
  self.headers['content-length'] = buffer.length
  self.headers['last-modified'] = rfc822.getRFC822Date(self.created)
  self.headers['etag'] = self.md5
  self.on('request', function (req, resp) {
    if (req.method === 'PUT' || req.method === 'POST') {
      resp.writeHead(405)
      resp.end()
      return
    }
    var headers = clone(self.headers)
    // It's safer to just do direct timestamp matching because javascript comparison and Date objects
    // are all kinds of screwed up.
    if (req.headers['if-modified-since'] && req.headers['if-modified-since'] === self.headers['last-modified']) {
      headers['content-length'] = 0
      resp.writeHead(304, headers)
      resp.end()
      return
    }

    if (req.headers['if-none-match'] && req.headers['if-none-match'] === self.headers['etag']) {
      headers['content-length'] = 0
      resp.writeHead(304, headers)
      resp.end()
      return
    }

    resp.writeHead(200, headers);
    if (!req.method !== 'HEAD') {
      resp.write(self.buffer)
    }
    resp.end()
  })
}
util.inherits(HTTPBuffer, events.EventEmitter)

//try to get the git version
var version = "";
try
{
  var ref = fs.readFileSync(path.join(__dirname, "../.git/HEAD"), "utf-8");
  var refPath = path.join(__dirname, "../.git/") + ref.substring(5, ref.indexOf("\n"));
  version = fs.readFileSync(refPath, "utf-8");
  version = version.substring(0, 7);
  console.log("Your Etherpad Lite git version is " + version);
}
catch(e)
{
  console.warn("Can't get git version for server header\n" + e.message)
}

console.log("Report bugs at https://github.com/Pita/etherpad-lite/issues")

var serverName = "Etherpad-Lite " + version + " (http://j.mp/ep-lite)";

//cache 6 hours
exports.maxAge = 1000*60*60*6;

//set loglevel
log4js.setGlobalLogLevel(settings.loglevel);

async.waterfall([
  //initalize the database
  function (callback)
  {
    db.init(function () {
      if (db.db.db.wrappedDB.emit) {
        var metrics = require('./metrics')
          , initTimer = metrics.timer('db.init')
          , getTimer = metrics.timer('db.get')
          , setTimer = metrics.timer('db.set')
          , removeTimer = metrics.timer('db.remove')
          , bulkTimer = metrics.timer('db.bulk')
          , initHist = metrics.histogram('db.ops.init')
          , getHist = metrics.histogram('db.ops.get')
          , setHist = metrics.histogram('db.ops.set')
          , removeHist = metrics.histogram('db.ops.remove')
          , bulkHist = metrics.histogram('db.ops.bulk')
          , bulkCountHist = metrics.histogram('db.ops.bulk.count')
          ;
        db.db.db.wrappedDB.on('metric.init', function (duration) {
          initTimer.update(duration)
          initHist.update(1, (new Date()).getTime())
        })
        db.db.db.wrappedDB.on('metric.get', function (duration) {
          getTimer.update(duration)
          getHist.update(1, (new Date()).getTime())
        })
        db.db.db.wrappedDB.on('metric.set', function (duration) {
          setTimer.update(duration)
          setHist.update(1, (new Date()).getTime())
        })
        db.db.db.wrappedDB.on('metric.remove', function (duration) {
          removeTimer.update(duration)
          removeHist.update(1, (new Date()).getTime())
        })
        db.db.db.wrappedDB.on('metric.bulk', function (duration) {
          bulkTimer.update(duration)
          bulkHist.update(1, (new Date()).getTime())
        })
        db.db.db.wrappedDB.on('metric.bulk.count', function (num) {
          bulkCountHist.update(num, (new Date()).getTime())
        })
      }
      callback.apply(this, arguments)
    });
  },
  //initalize the http server
  function (callback)
  {
    //create server
    var app = express.createServer();

    //load modules that needs a initalized db
    readOnlyManager = require("./db/ReadOnlyManager");
    exporthtml = require("./utils/ExportHtml");
    exportHandler = require('./handler/ExportHandler');
    importHandler = require('./handler/ImportHandler');
    apiHandler = require('./handler/APIHandler');
    padManager = require('./db/PadManager');
    securityManager = require('./db/SecurityManager');
    socketIORouter = require("./handler/SocketIORouter");

    //install logging
    var httpLogger = log4js.getLogger("http");
    app.configure(function()
    {
      app.use(log4js.connectLogger(httpLogger, { level: log4js.levels.INFO, format: ':status, :method :url'}));
      app.use(express.cookieParser());
    });

    //serve static files
    app.get('/static/*', function(req, res)
    {
      res.header("Server", serverName);
      console.error(req.url)
      if (!filemap[req.url]) {
        res.setHeader('content-type', 'text/plain')
        res.statusCode = 404
        res.end('Not found')
      } else {
        filemap[req.url].emit('request', req, res)
      }
    });

    //serve minified files
    app.get('/minified/:id', function(req, res, next)
    {
      res.header("Server", serverName);

      var id = req.params.id;

      if(id == "pad.js" || id == "timeslider.js")
      {
        minify.minifyJS(req,res,id);
      }
      else
      {
        next();
      }
    });

    //checks for padAccess
    function hasPadAccess(req, res, callback)
    {
      securityManager.checkAccess(req.params.pad, req.cookies.sessionid, req.cookies.token, req.cookies.password, function(err, accessObj)
      {
        if(err) throw err;

        //there is access, continue
        if(accessObj.accessStatus == "grant")
        {
          callback();
        }
        //no access
        else
        {
          res.send("403 - Can't touch this", 403);
        }
      });
    }

    //serve read only pad
    app.get('/ro/:id', function(req, res)
    {
      res.header("Server", serverName);

      var html;
      var padId;
      var pad;

      async.series([
        //translate the read only pad to a padId
        function(callback)
        {
          readOnlyManager.getPadId(req.params.id, function(err, _padId)
          {
            padId = _padId;

            //we need that to tell hasPadAcess about the pad
            req.params.pad = padId;

            callback(err);
          });
        },
        //render the html document
        function(callback)
        {
          //return if the there is no padId
          if(padId == null)
          {
            callback("notfound");
            return;
          }

          hasPadAccess(req, res, function()
          {
            //render the html document
            exporthtml.getPadHTMLDocument(padId, null, false, function(err, _html)
            {
              html = _html;
              callback(err);
            });
          });
        }
      ], function(err)
      {
        //throw any unexpected error
        if(err && err != "notfound")
          throw err;

        if(err == "notfound")
          res.send('404 - Not Found', 404);
        else
          res.send(html);
      });
    });

    //serve pad.html under /p
    app.get('/p/:pad', function(req, res, next)
    {
      //ensure the padname is valid and the url doesn't end with a /
      if(!padManager.isValidPadId(req.params.pad) || /\/$/.test(req.url))
      {
        res.send('Such a padname is forbidden', 404);
        return;
      }

      res.header("Server", serverName);
      var filePath = path.normalize(__dirname + "/../static/pad.html");
      res.sendfile(filePath, { maxAge: exports.maxAge });
    });

    //serve timeslider.html under /p/$padname/timeslider
    app.get('/p/:pad/timeslider', function(req, res, next)
    {
      //ensure the padname is valid and the url doesn't end with a /
      if(!padManager.isValidPadId(req.params.pad) || /\/$/.test(req.url))
      {
        res.send('Such a padname is forbidden', 404);
        return;
      }

      res.header("Server", serverName);
      var filePath = path.normalize(__dirname + "/../static/timeslider.html");
      res.sendfile(filePath, { maxAge: exports.maxAge });
    });

    //serve timeslider.html under /p/$padname/timeslider
    app.get('/p/:pad/export/:type', function(req, res, next)
    {
      //ensure the padname is valid and the url doesn't end with a /
      if(!padManager.isValidPadId(req.params.pad) || /\/$/.test(req.url))
      {
        res.send('Such a padname is forbidden', 404);
        return;
      }

      var types = ["pdf", "doc", "txt", "html", "odt"];
      //send a 404 if we don't support this filetype
      if(types.indexOf(req.params.type) == -1)
      {
        next();
        return;
      }

      //if abiword is disabled, and this is a format we only support with abiword, output a message
      if(settings.abiword == null && req.params.type != "html" && req.params.type != "txt" )
      {
        res.send("Abiword is not enabled at this Etherpad Lite instance. Set the path to Abiword in settings.json to enable this feature");
        return;
      }

      res.header("Access-Control-Allow-Origin", "*");
      res.header("Server", serverName);

      hasPadAccess(req, res, function()
      {
        exportHandler.doExport(req, res, req.params.pad, req.params.type);
      });
    });

    //handle import requests
    app.post('/p/:pad/import', function(req, res, next)
    {
      //ensure the padname is valid and the url doesn't end with a /
      if(!padManager.isValidPadId(req.params.pad) || /\/$/.test(req.url))
      {
        res.send('Such a padname is forbidden', 404);
        return;
      }

      //if abiword is disabled, skip handling this request
      if(settings.abiword == null)
      {
        next();
        return;
      }

      res.header("Server", serverName);

      hasPadAccess(req, res, function()
      {
        importHandler.doImport(req, res, req.params.pad);
      });
    });

    var apiLogger = log4js.getLogger("API");

    //This is a api call, collect all post informations and pass it to the apiHandler
    app.get('/api/1/:func', function(req, res)
    {
      res.header("Server", serverName);
      res.header("Content-Type", "application/json; charset=utf-8");

      apiLogger.info("REQUEST, " + req.params.func + ", " + JSON.stringify(req.query));

      //wrap the send function so we can log the response
      res._send = res.send;
      res.send = function(response)
      {
        response = JSON.stringify(response);
        apiLogger.info("RESPONSE, " + req.params.func + ", " + response);

        //is this a jsonp call, if yes, add the function call
        if(req.query.jsonp)
          response = req.query.jsonp + "(" + response + ")";

        res._send(response);
      }

      //call the api handler
      apiHandler.handle(req.params.func, req.query, req, res);
    });

    //The Etherpad client side sends information about how a disconnect happen
    app.post('/ep/pad/connection-diagnostic-info', function(req, res)
    {
      new formidable.IncomingForm().parse(req, function(err, fields, files)
      {
        console.log("DIAGNOSTIC-INFO: " + fields.diagnosticInfo);
        res.end("OK");
      });
    });

    //The Etherpad client side sends information about client side javscript errors
    app.post('/jserror', function(req, res)
    {
      new formidable.IncomingForm().parse(req, function(err, fields, files)
      {
        console.error("CLIENT SIDE JAVASCRIPT ERROR: " + fields.errorInfo);
        res.end("OK");
      });
    });

    //serve index.html under /
    app.get('/', function(req, res)
    {
      res.header("Server", serverName);
      var filePath = path.normalize(__dirname + "/../static/index.html");
      res.sendfile(filePath, { maxAge: exports.maxAge });
    });

    //serve robots.txt
    app.get('/robots.txt', function(req, res)
    {
      res.header("Server", serverName);
      var filePath = path.normalize(__dirname + "/../static/robots.txt");
      res.sendfile(filePath, { maxAge: exports.maxAge });
    });

    //serve favicon.ico
    app.get('/favicon.ico', function(req, res)
    {
      res.header("Server", serverName);
      var filePath = path.normalize(__dirname + "/../static/custom/favicon.ico");
      res.sendfile(filePath, { maxAge: exports.maxAge }, function(err)
      {
        //there is no custom favicon, send the default favicon
        if(err)
        {
          filePath = path.normalize(__dirname + "/../static/favicon.ico");
          res.sendfile(filePath, { maxAge: exports.maxAge });
        }
      });
    });

    //load all files in to memory
    var walkDir = function (dir, p, cb) {
      var count = 0
      fs.readdir(dir, function (e, files) {
        if (e) throw e
        files.forEach(function (f) {
          count += 1
          var full = path.join(dir, f)
          fs.stat(full, function (e, stat) {
            if (e) throw e
            if (stat.isDirectory()) {
              walkDir(full, p + '/' + f, function () {
                count--
                if (count === 0) cb()
              })
            } else {
              fs.readFile(full, function (e, data) {
                filemap[p + '/' + f] =
                  new HTTPBuffer(data, {'content-type':mimetypes.lookup(f.slice(f.lastIndexOf('.')+1))})
                count--
                if (count === 0) cb()
              })
            }
          })
          if (count === 0) cb()
        })
      })
    }
    walkDir(path.join(__dirname, '..', 'static'), '/static', function () {
      //let the server listen
      var port = argv.port || settings.port;
      app.listen(port, settings.ip);
      console.log("Server is listening at " + settings.ip + ":" + port);
    })




    var onShutdown = false;
    var shutdownCalled = false;
    var gracefulShutdown = function(err)
    {
      // stop accepting connections NOW!
      app.pause()

      if(err && err.stack)
      {
        console.error(err.stack);
      }
      else if(err)
      {
        console.error(err);
      }

      // If we already tried to run shutdown and get another signal hard kill our pid
      if (shutdownCalled) {
        console.error('hard kill')
        return process.kill(process.pid, 'SIGKILL')
      }
      shutdownCalled = true;

      //ensure there is only one graceful shutdown running
      if(onShutdown) return;
      onShutdown = true;

      console.log("graceful shutdown...");

      //stop the http server
      app.close();

      //do the db shutdown
      if (db && db.db && db.db.doShutdown) {
        db.db.doShutdown(function()
        {
          console.log("db sucessfully closed.");
          process.exit();
        });
      } else {
        console.log('no db shutdown.')
        process.exit();
      }

      setTimeout(function(){
        console.error('shutdown timeout')
        process.exit(1);
      }, 3000);
    }

    //connect graceful shutdown with sigint and uncaughtexception
    if(os.type().indexOf("Windows") == -1)
    {
      //sigint is so far not working on windows
      //https://github.com/joyent/node/issues/1553
      process.on('SIGINT', gracefulShutdown);
    }


    process.on('SIGHUP', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    process.on('uncaughtException', gracefulShutdown)

    //init socket.io and redirect all requests to the MessageHandler
    var io = socketio.listen(app);

    //this is only a workaround to ensure it works with all browers behind a proxy
    //we should remove this when the new socket.io version is more stable
    io.set('transports', ['xhr-polling']);

    var socketIOLogger = log4js.getLogger("socket.io");
    io.set('logger', {
      debug: function (str)
      {
        socketIOLogger.debug(str);
      },
      info: function (str)
      {
        socketIOLogger.info(str);
      },
      warn: function (str)
      {
        socketIOLogger.warn(str);
      },
      error: function (str)
      {
        socketIOLogger.error(str);
      },
    });


    //minify socket.io javascript
    if(settings.minify)
      io.enable('browser client minification');

    var padMessageHandler = require("./handler/PadMessageHandler");
    var timesliderMessageHandler = require("./handler/TimesliderMessageHandler");

    //Initalize the Socket.IO Router
    socketIORouter.setSocketIO(io);
    socketIORouter.addComponent("pad", padMessageHandler);
    socketIORouter.addComponent("timeslider", timesliderMessageHandler);

    callback(null);
  }
]);
