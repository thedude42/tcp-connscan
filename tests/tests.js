var test = require("tape"),
    scanner = require("../scannerlib"),
    childscanner = require("../childscanner"),
    util = require("util"),
    reload = require("require-reload"),
    EventEmitter = require('events').EventEmitter;

test("** TEST SET #1: setNumPorts(start, end)", function(t) {
    var portsobj = scanner.setNumPorts(1,1024);
    t.equals(portsobj.start, 1, "correct beginning port is set");
    t.equals(portsobj.end,1024, "correct ending port is set");
    t.equals(portsobj.numports,1024,"correct number of ports to scan is set");
    portsobj = scanner.setNumPorts(1024,1);
    t.ok(!isNaN(portsobj) && portsobj === 1024,"correct return value when setting invalid port range");
    portsobj = scanner.setNumPorts(65535,65536);
    t.ok(!isNaN(portsobj) && portsobj === 1024,"correct return value when setting ports beyond max value");
    portsobj = scanner.setNumPorts(-1,65533);
    t.ok(!isNaN(portsobj) && portsobj === 1024,"correct return value when setting ports beyond min value");
    t.end();
});


test("** TEST SET #2: workersGate(numtasks), testing worker control funtion", function(t) {
    var guard = scanner.workersGate(3);
    t.ok(!isNaN(guard()), "1/3 tasks, is a number"); // 1
    t.ok(!isNaN(guard()), "2/3 tasks, is a number"); // 2
    t.ok(guard() === true, "3/3 tasks, is true"); // 3
    t.ok(guard() === false, "over tasks, is false"); // 4
    t.end();
});

test("** TEST SET #3: initChild(childprocess) part 1, partial test child worker initialization, using mock-up event-emitter 'testChild'", function(t) {
    var worker = scanner.initChild(new testChild()),
        numports = scanner.setNumPorts(22,24);
    t.plan(12);
    worker.emit("message", {state:"open",port:22});
    worker.emit("message", {state:"closed",port:23});
    worker.emit("message", {state:"filtered",port:24});
    console.log("** setting timeout to allow callbacks to fire **");
    setImmediate(function() {
        t.equals(scanner.mod.results.open[0], "22: undefined", "received message port 22 is open");
        t.equals(worker.assigned[22], "scanned", "assigned port 22 shows scanned");
        t.ok(scanner.mod.results.scanned[22], "results shows port 22 scanned");
        t.equals(scanner.mod.results.closed[0], 23, "received message port 23 closed");
        t.equals(worker.assigned[23], "scanned", "assigned port 23 shows scanned");
        t.ok(scanner.mod.results.scanned[23], "results show port 23 scanned");
        t.equals(scanner.mod.results.filtered[0], 24, "received message port 24 filtered");
        t.equals(worker.assigned[24], "scanned", "assigned port 24 shows scanned");
        t.ok(scanner.mod.results.scanned[24], "results show port 24 scanned");
        t.equals(scanner.countResults(), 3, "results show 3 ports were scanned");
        t.equals(scanner.countResults(), numports.numports, "NUMPORTS agrees with scanned ports");
        t.equals(worker.lastworker, true, "reaping of children triggered");
        t.end();
    });
});

test("** TEST SET #4: initChild(childprocess) part 2, test full child worker initialization and exit behavior, using mock-up event-emitter 'testChild'", function(t) {
    var worker = new testChild(),
        NUM = 1;
    worker.num = NUM;
    scanner = reload("../scannerlib");
    scanner.forkChildProcess = mockForkChild;
    scanner.mod.WORKERS = 4; // set explicitly
    scanner.setNumPorts(1,scanner.mod.WORKERS*3);  // we get ports 2,6,10
    scanner.initChild(worker);
    t.plan(14);
    t.equals(worker.assigned[2], "waiting", "port 2 work assigned");
    t.equals(worker.assigned[6], "waiting", "port 6 work assigned");
    t.equals(worker.assigned[10], "waiting", "port 10 work assigned");
    t.equals(worker.portMessageQueue.length, 3, "Expected # of port messages received");
    Object.keys(worker.assigned).forEach(function(portnum) {
        t.equals(worker.assigned[portnum], "waiting", "Child's assigned port "+portnum+" set to 'waiting'");
    });
    t.equals(scanner.mod.children.length, 0, "Precondition valid for next test: scanner.mod.children not initialized");
    worker.emit("exit"); //trigger 'exit' event handler
    setImmediate(function() {
        var new_worker = scanner.mod.children[NUM];
        t.ok(new_worker.mock, "Ensure this is our mock object");
        t.ok(typeof new_worker === 'object', "Child number "+NUM+" re-created after 'exit' event received");
        Object.keys(new_worker.assigned).forEach(function(portnum) {
            t.equals(new_worker.assigned[portnum], "waiting", "Re-spawned child's assigned port "+new_worker.assigned[portnum]+" set to 'waiting'");
        });
        t.equals(new_worker.portMessageQueue.length, 3, "Expected # of port messages received");
        t.end();
    });
});

test("** TEST SET #5: Verify beginScan(addr) chain, including initServicesObject and scanInit()", function(t) {
    console.log("** Expecting normal program logging, scanning ports 1-5 at localhost addr **");
    var TESTADDR = "127.0.0.1";
    scanner = reload("../scannerlib");
    scanner.mod.WORKERS = 1;
    scanner.forkChildProcess = mockForkChild;
    scanner.setNumPorts(20,24);
    scanner.beginScan(TESTADDR);
    t.plan(20);
    setTimeout(function() { // a bit hackey, but 500 ms should be plenty of time on an idle system
        var worker = scanner.mod.children[0];
        t.equals(worker.portMessageQueue.length, 5, "Expected # of port messages received");
        worker.emit("message", {port:23,state:"closed"});
        worker.emit("message", {port:21,state:"filtered"});
        worker.emit("message", {port:22,state:"open"});
        t.ok(worker.mock, "Ensure this is our mock object");
        t.equals(scanner.mod.children.length, 1, "Setting WORKERS set proper # of children[]");
        t.ok(typeof worker === 'object', "Worker initialized");
        t.equals(scanner.mod.ServicesDBTcp[22], "ssh", "Services map created");
        setImmediate(function() {
            t.equals(worker.assigned[21], "scanned", "Port 21 shows as scanned"); 
            t.equals(worker.assigned[22], "scanned", "Port 22 shows as scanned");
            t.equals(worker.assigned[23], "scanned", "Port 23 shows as scanned");
            t.equals(worker.assigned[20], "waiting", "Port 20 shows as waiting");
            t.equals(worker.assigned[24], "waiting", "Port 24 shows as waiting");
            worker.emit("exit");
            // if we are in callback hell, what level is this?
            setImmediate(function() {
                var new_worker = scanner.mod.children[0];
                t.equals(scanner.mod.children.length, 1, "Setting WORKERS set proper # of children[]");
                t.ok(new_worker.mock, "Ensure this is our mock object");
                t.ok(typeof new_worker === 'object', "Child number "+new_worker.num+" re-created after 'exit' event received");
                t.ok(typeof new_worker.assigned == 'object', "re-spawned worker initialized with work");
                t.equals(Object.keys(new_worker.assigned).length, 2, "Correct amount of work assigned");
                t.equals(new_worker.assigned[20], "waiting", "Re-spawned child's 20 set to 'waiting'");
                t.equals(new_worker.assigned[24], "waiting", "Re-spawned child's 24 set to 'waiting'");
                t.equals(new_worker.portMessageQueue.length, 2, "Expected # of port messages received");
                t.equals(scanner.countResults(), 3, "Results count correct for 3 ports scanned");
                t.equals(scanner.mod.ADDR, TESTADDR, "Scan address unchanged");

                t.end();
            });
        });
    }, 500);
});

test("TEST SET #6: childscanner basic message processing", function(t) {
    var mockproc,
        mocknet,
        testhost = "127.0.0.1";
    childscanner = reload("../childscanner");
    mockproc = getMockProc(childscanner);
    mocknet = getMockNet(childscanner);
    t.plan(17);
    t.equals(childscanner._msgqueue.length, 0, "Expected starting state msgqueue");
    t.equals(childscanner._running, 0, "Expected starting state running");
    mockproc.emit("disconnect");
    setImmediate(function() {
        t.ok(mockproc.EXITED, "disconnect message passedi to child");
        mockproc.emit("message", {addr:testhost,port:20});
        mockproc.emit("message", {addr:testhost,port:21});
        mockproc.emit("message", {addr:testhost,port:22});
        mockproc.emit("message", {addr:testhost,port:23});
        setImmediate(function() {
            t.equals(childscanner._msgqueue.length, 0, "All messages pulled");
            t.equals(Object.keys(mocknet.connections).length, 4, "All connections created");
            mocknet.connections["127.0.0.1:20"].emit("close");
            mocknet.connections["127.0.0.1:21"].emit("error", {code:"ECONNREFUSED"});
            mocknet.connections["127.0.0.1:22"].emit("connect");
            mocknet.connections["127.0.0.1:23"].emit("error", {code:"ETIMEDOUT"});
            setImmediate(function() {
                t.ok(!mocknet.connections["127.0.0.1:20"].DESTROYED, "conn on port 20 NOT cleaned up");
                t.ok(mocknet.connections["127.0.0.1:21"].DESTROYED, "conn on port 21 cleaned up");
                t.ok(mocknet.connections["127.0.0.1:22"].DESTROYED, "conn on port 22 cleaned up");
                t.ok(mocknet.connections["127.0.0.1:23"].DESTROYED, "conn on port 23 cleaned up");
                t.equals(mockproc.childmsgs[0].port, 20, "port 20 message seen");
                t.equals(mockproc.childmsgs[0].state, "filtered", "port 20 state correct");
                t.equals(mockproc.childmsgs[1].port, 21, "port 21 message seen");
                t.equals(mockproc.childmsgs[1].state, "closed", "port 21 state correct");
                t.equals(mockproc.childmsgs[2].port, 22, "port 22 message seen");
                t.equals(mockproc.childmsgs[2].state, "open", "port 22 state correct");
                t.equals(mockproc.childmsgs[3].port, 23, "port 23 message seen");
                t.equals(mockproc.childmsgs[3].state, "filtered", "port 23 state correct");
                t.end();
            });
        });
    });
});

test("TEST SET #7: childscanner throttling", function(t) {
    var mockproc,
        mocknet,
        testhost = "127.0.0.1";
    childscanner = reload("../childscanner");
    mockproc = getMockProc(childscanner);
    mocknet = getMockNet(childscanner);
    t.plan(7);
    t.equals(childscanner._msgqueue.length, 0, "Expected starting state msgqueue");
    t.equals(childscanner._running, 0, "Expected starting state running");
    for (var i = 1; i <= 102; ++i) {
        mockproc.emit("message", {addr:testhost,port:i});
    }
    setImmediate(function() {
        t.equals(childscanner._msgqueue.length, 2, "Two messages left on queue");
        t.equals(Object.keys(mocknet.connections).length, 100, "All connections created");
        Object.keys(mocknet.connections).forEach(function foreachMockConns(mockconn) {
            mocknet.connections[mockconn].emit("connect");
        });
        setImmediate(function() {
            countconnect = 0;
            for (var i = 0; i < 100; ++i) {
                if (mockproc.childmsgs[i].state === "open") {
                    ++countconnect;
                }
            }
            t.equals(countconnect, 100, "First 100 work messages received");
            setTimeout(function waitingForTwoSecondChildQueuePoll() {
                mocknet.connections["127.0.0.1:101"].emit("close");
                setImmediate(function lastWorkItemCheck() {
                    t.equals(mockproc.childmsgs[100].state, "filtered", "Last work piece done");
                    setTimeout(function longWaitTestingTimeout() {
                        t.equals(mockproc.childmsgs[101].state, "filtered", "Last work piece done");
                        t.end();
                    }, 5500);
                });
            }, 2500);
        });
    });
});

test("TEST SET #8: integration", function(t) {

    t.end(); 
});

function mockForkChild(modulename) {
    var mockchild = new testChild();
    mockchild.modulename = modulename;
    return mockchild;
}

function getMockProc(childmodule) {
    var procobj = new testChild();
    procobj.childmsgs = [];
    procobj.exit = function mockProcExit(val) {
        procobj.EXITED = true;
    };
    procobj.send = function mockProcSend(obj) {
        procobj.childmsgs.push(obj);
    };
    childmodule.setProcessHandlers(procobj);
    return procobj;
}

function getMockNet(childmodule) {
    var newnet = new testChild();
    newnet.connections = {};
    childmodule.mockNet(newnet);
    newnet.connect = function mockNetConnect(hostportobj) {
        var connkey = hostportobj.host+":"+hostportobj.port;
        this.connections[connkey] = new testChild();
        this.connections[connkey].destroy = function mockNetConnDestroy() {
            this.DESTROYED = true;
            this.emit("close");
        };

        return this.connections[connkey];
    };
    return newnet;
}

/* testChild()
 * Overused mock object. Primarily designed for use with scannerlib.js testing,
 * it is also an EventEmitter so we can use it to mock the process and net objects
 * for testing childscanner.js
 */
function testChild() {
    this.connected = true;
    this.portMessageQueue = [];
    this.mock = true;
    EventEmitter.call(this);
}
util.inherits(testChild, EventEmitter);

testChild.prototype.disconnect = function childMockDisconnect() {
    this.connected = false;
};

testChild.prototype.send = function childMockSend(portobj) {
    this.portMessageQueue.push(portobj);
};


