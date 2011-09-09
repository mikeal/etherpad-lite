var metrics = require('metrics')
  ; 

var server = new metrics.Server()

exports.timer = function (ns) {
  var x = new metrics.Timer()
  server.addMetric(ns, x)
  return x
}

exports.histogram = function (ns) {
  var x = metrics.Histogram.createExponentialDecayHistogram(5000)
  server.addMetric(ns, x)
  return x
}

exports.listen = function () {
  server.listen.apply(server, arguments)
}

var port = 9091

if (process.argv.indexOf('metrics') !== -1) {
  if (parseInt(process.argv[process.argv.indexOf('metrics') + 1])) {
    port = parseInt(process.argv[process.argv.indexOf('metrics') + 1])
  }
  exports.listen(port)
}