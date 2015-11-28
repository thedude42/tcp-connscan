"use strict";

var net = require("net"),
    msgqueue = [],
    running = 0,
    CONCURRENT_CONNECTS = 100,
    CONNECT_TIMEOUT = 5000,
    sendParent = defaultSendParent;

module.exports._msgqueue = msgqueue;
module.exports._running = running;

/* setProcessHandlers(eventemitter)
 * @eventemitter optional EventEmitter object
 *
 * Used for testing to mock out the "process" global module
 * by abstracting the setting of the IPC message handlers
 * for communications by the parent process.
 */
function setProcessHandlers(procobj) {
    if (arguments.length === 0) {
        process.on("message", childMsgHandler);
        process.on("disconnect", function childOnParentDiconnect() {
            process.exit(0);
        });
    }
    else {
        procobj.on("message", childMsgHandler);
        procobj.on("disconnect", function childOnParentDiconnect() {
            procobj.exit(0);
        });
        sendParent = procobj.send;
    }
}
module.exports.setProcessHandlers = setProcessHandlers;
// set the default regardless... presumably the test runner isn't going to
// send itself the "disconnect" message without doing setProcessHandlers(obj)
setProcessHandlers();

function defaultSendParent(obj) {
    process.send(obj);
}

module.exports.mockNet = function mockNet(newnet) {
    net = newnet;
};

module.exports.setConnectTimeout = function setConnectTimeout(timeout) {
    if (!isNaN(timeout)) {
        CONNECT_TIMEOUT = timeout;
    }
    return CONNECT_TIMEOUT;
};

module.exports.setConncurrent = function setConcurrent(concurrent) {
    if (!isNaN(concurrent)) {
        CONCURRENT_CONNECTS = concurrent;
    }
    return CONCURRENT_CONNECTS;
};


/* childMsgHandler()
 * Work message handler. Adds work to array object "msgqueue", pulls up to 
 * CONCURRENT_CONNECTS off msgqueue, then sets itself on a timeout callback
 * for 2 seconds if there is still work to be done.
 */
function childMsgHandler(msg) {
    //console.log("got message:\n",JSON.stringify(msg,null,2));
    if (msg !== undefined) {
        msgqueue.push(msg);
    }
    while (running < CONCURRENT_CONNECTS && msgqueue.length > 0) {
        checkPort(msgqueue.shift());
    }
    if (msgqueue.length > 0) {
        setTimeout(exports.childMsgHandler, 2000);
    }
}
module.exports.childMsgHandler = childMsgHandler; 


/**
 * checkPort( {host:"host to connect to",port:"dst port for connection"} ) 
 * Each call attempts to open a connection to obj.host on port obj.port,
 * and sets up callbacks for socket events and sets a timeout timer.
 *
 * Too agressive concurrent connecting to a single host will produce false
 * "filtered" results, as will loss on the network path.
 */
function checkPort(obj) {
    console.log("scanning port", obj.port);
    var conn = net.connect({host:obj.addr,port:obj.port});
    ++running;
    setTimeout(function filteredSockTimeout() {
        process.nextTick(function filteredSocketTimeoutNextTick() {
            if (! obj.determined) {
                console.log("destroying undetermined connection on port",obj.port);
                conn.destroy();
            }
        });
    }, CONNECT_TIMEOUT);
    conn.on("error", function childConnErr(e) {
        if (e.code === "ECONNREFUSED") {
            console.log("PORT",obj.port,":CLOSED");
            obj.determined = true;
            sendParent({port:obj.port,state:"closed"});
        }
        else if (e.code === "ETIMEDOUT") {
            sendParent({port:obj.port,state:"filtered"});
            console.log("PORT",obj.port,":FILTERED");
            obj.determined = true;
        }
        obj.determined = true;
        conn.destroy();
        running--;
    });
    conn.on("connect", function childGoodConn() {
        console.log("PORT",obj.port,":OPEN");
        sendParent({port:obj.port,state:"open"});
        obj.determined = true;
        conn.destroy();
        running--;
    });
    conn.on("close", function onClose() {
        if (!obj.determined) {
            sendParent({port:obj.port,state:"filtered"});
            console.log("PORT",obj.port,":PROBABLY FILTERED");
            //conn.destroy();
            obj.determined = true;
            running--;
        }
    });
}
