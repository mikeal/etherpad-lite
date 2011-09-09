var io = require('socket.io-client')
  , events = require('events')
  ;

function createClient () {
  var c = io.connect("http://localhost:9001", {'force new connection':true})
  c.token = Math.floor(Math.random()*111111111211111).toString()
  c.on('error', function (e) {console.error(e)})
  c.collabroom = new events.EventEmitter()
  c.padid = Math.floor(Math.random()*111111111111111).toString()
  c.users = {}
  return c
}

function createPad (c) {
  return c
}

function joinPad (c, cb) {
  c.json.send(
    { "component": "pad"
    , "type": "CLIENT_READY"
    , "padId": c.padid
    , "token": c.token
    , "sessionID": null
    , "password": null
    , "protocolVersion":2
    }
  )
  c.rev = 0 // edge case where we might receive a new_change before we get the pad info message
  c.on('message', function (obj) {
    if (!obj.type) {
      if (obj.collab_client_vars) {
        c.padinfo = obj
        c.rev = obj.collab_client_vars.rev
        if (cb) cb(c)
        cb = null
      } else {
        console.error(obj)
      }
    } else {
      if (obj.type === 'COLLABROOM') {
        c.collabroom.emit(obj.data.type, obj.data)
      }
    }
  })
  c.collabroom.on('USER_NEWINFO', function (obj) {
    c.users[obj.userInfo.userId] = obj.userInfo
  })
  c.collabroom.on('USER_LEAVE', function (obj) {
    delete c.users[obj.userInfo.userId]
  })
  c.collabroom.on('NEW_CHANGES', function (obj) {
    if (obj.newRev > c.rev) c.rev = obj.newRev
  })
  
  c.applyChange = function (changeset, apool, cb) {
    c.json.send(
      { type:'COLLABROOM'
      , component: "pad"
      , data:   
        { type: "USER_CHANGES"
        , baseRev: c.rev
        , changeset: changeset
        , apool: apool
        , author: c.token
        , nextNum: 1
        }
      }
    )
    c.collabroom.once('ACCEPT_COMMIT', function (obj) {
      c.rev = obj.newRev
      cb()
    })
  }
  
  c.applyChanges = function (changes, cb) {
    var applychange = function (change) {
      console.log('apply change')
      c.applyChange(change[0], change[1], function () {
        console.log('applied changed. '+changes.length+' left.')
        if (changes.length === 0) cb()
        else applychange(changes.shift())
      })
    }
    applychange(changes.shift())
  }
}

function megajoin (limit) {
  var i = 0
  var clients = []
  while (i < limit) {
    clients.push(createClient())
    i++
  }
  var counter = 0
  clients.forEach(function (client) {
    client.padid = clients[0].padid
    counter++
    joinPad(client, function () {
      console.error(counter)
      counter--
      if (counter === 0) {
        clients.forEach(function (c) {
          c.disconnect()
        })
      }
    })
  })
  console.log(clients.map(function (c) {return c.token}))
}

function testpads (padlimit, clientsPerPad, cb) {
  var i = 0
    , pads = []
    , clients = []
    ;
  while (i !== padlimit) {
    clients.push(createClient())
    var x = 0
    while (x < (clientsPerPad - 1)) {
      clients.push(createClient())
      clients[clients.length - 1].padid = clients[clients.length - 2].padid
      x++
    }
    i++
  }
  var counts = clients.length
  clients.forEach(function (c) {
    joinPad(c, function () {
      console.error('joined '+c.padid+' '+(counts - 1)+' remaining')
      counts--
      if (counts === 0) {
        console.error('finished.')
        cb()
      }
    })
  })
  return clients;
}

function testwrites (pads, clients) {
  var clients = testpads(pads, clients, function () {
    console.log('all joined')
    var padmap = {}
    clients.forEach(function (c) {
      if (!padmap[c.padid]) padmap[c.padid] = []
      padmap[c.padid].push(c) 
    })
    for (i in padmap) {
      (function (i) {
        console.error('applying changes')
        padmap[i][0].applyChanges(sample.map(function (s) { return [s.data.changeset, s.data.apool] }), function () {
          console.log('finished writing to '+padmap[i][0].padid)
        }) 
      })(i)
    }
  })
}

// testpads(10, 10)

testwrites(1, 10)

// megajoin(1000)

// joinPad(createPad(createClient()), function (c) {
//   var changes = sample.map(function (obj) {
//     return [obj.data.changeset, obj.data.apool]
//   })
//   
//   c.applyChanges(changes, function () {
//     console.log('done '+c.padid)
//     c.disconnect()
//   })
// })


var sample = [
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":0,"changeset":"Z:6c>4*0+4$asdf","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":1,"changeset":"Z:6g>5=4*0+5$asdf ","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":2,"changeset":"Z:6l>1|4=5b=18*0|1+1$\n","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":3,"changeset":"Z:6m>8|5=6k*0|1+8$asdfasd\n","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":4,"changeset":"Z:6u>6|6=6s*0|2+3*0+3$f\n\nasd","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
 {"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":5,"changeset":"Z:70>b|8=6v=3*0|2+7*0+4$f\nasdf\nasdf","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":6,"changeset":"Z:7b>b|a=75=4*0|1+1*0+a$\nasdfl kasj","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":7,"changeset":"Z:7m>a|b=7a=a*0+a$dufasjfiua","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":8,"changeset":"Z:7w>9|4=5b=18*0+5|7=r=k*0+4$a suddfsu","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":9,"changeset":"Z:85>i|4=5b=1d*0+i$iasufisuadifaksldj","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":10,"changeset":"Z:8n>c|4=5b=1v*0+c$fajdfkjahk j","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":11,"changeset":"Z:8z>f|4=5b=1s*0+f$dhkjh askjdfkas","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":12,"changeset":"Z:9e>g|4=5b=27*0+g$kfjaskjdf kj ads","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":13,"changeset":"Z:9u>c|4=5b=2n*0+c$jfsakdfhk as","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":14,"changeset":"Z:a6>c|4=5b=2z*0+c$djf kajsdfka","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":15,"changeset":"Z:ai>6|4=5b=3b*0+6$dh aks","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":16,"changeset":"Z:ao>1|c=an*0|1+1$\n","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":17,"changeset":"Z:ap>2|d=ao*0|2+2$\n\n","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}},
{"type":"COLLABROOM","component":"pad","data":{"type":"USER_CHANGES","baseRev":18,"changeset":"Z:ar>8|f=aq*0+8$asdfasdf","apool":{"numToAttrib":{"0":["author","g.0ffrw0lhimc03tsx"]},"nextNum":1}}} 
 ]

