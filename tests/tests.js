var test = require("tape"),
    scanner = require("../scannerlib"),
    childscanner = require("../childscanner"),
    util = require("util"),
    EventEmitter = require('events').EventEmitter;

test("set number ports", function(t) {
    var portsobj = scanner.setNumPorts(1,1024);
    t.equals(portsobj.start, 1);
    t.equals(portsobj.end,1024);
    t.equals(portsobj.numports,1024);
    portsobj = scanner.setNumPorts(1024,1);
    t.ok(!isNaN(portsobj));
    portsobj = scanner.setNumPorts(65535,65536);
    t.ok(!isNaN(portsobj));
    portsobj = scanner.setNumPorts(-1,65533);
    t.ok(!isNaN(portsobj));
    t.end();
});


test("test worker control", function(t) {
    var guard = scanner.workersGate(3);
    t.ok(!isNaN(guard()), "1/3 tasks, is a number"); // 1
    t.ok(!isNaN(guard()), "2/3 tasks, is a number"); // 2
    t.ok(guard() === true, "3/3 tasks, is true"); // 3
    t.ok(guard() === false, "over tasks, is false"); // 4
    t.end();
});

test("test child worker initialization, no services DB", function(t) {
    var worker = scanner.initChild(new testChild()),
        numports = scanner.setNumPorts(22,24);
    t.plan(11);
    worker.emit("message", {state:"open",port:22});
    worker.emit("message", {state:"closed",port:23});
    worker.emit("message", {state:"filtered",port:24});
    console.log("** setting timeout to allow callbacks to fire **");
    setTimeout(function() {
        t.equals(scanner.results.open[0], "22: undefined");
        t.equals(worker.assigned[22], "scanned");
        t.ok(scanner.results.scanned[22]);
        t.equals(scanner.results.closed[0], 23);
        t.equals(worker.assigned[23], "scanned");
        t.ok(scanner.results.scanned[23]);
        t.equals(scanner.results.filtered[0], 24);
        t.equals(worker.assigned[24], "scanned");
        t.ok(scanner.results.scanned[24]);
        t.equals(scanner.countResults(), 3, "results are as expected");
        t.equals(scanner.countResults(), numports.numports, "NUMPORTS as expected");
    }, 500);
});

function testChild() {
    var connected = true;
}

testChild.prototype.disconnect = function disconnect() {
    this.connected = false;
};

util.inherits(testChild, EventEmitter);
