"use strict";

/*
 * portscanner.js
 * Performs "connect scan" against all 2^16-1 TCP ports using concurrent
 * worker processes, the number of which equals the number of processes
 * reported by the system.
 *
 * Upon completion the open ports are listed with their resolved service
 * names, and the number of closed (received a TCP RST packet) and filtered
 * (connection timed out) ports are reported in no detial.
 *
 * Usage:
 *
 * portscanner.js <address>
 *
 * address can be ipv4, ipv6 or name which local resolver can handle
 */

var child_process = require("child_process"),
    fs = require("fs"),
    readline = require("readline"),
    path = require("path");


// Constants
//var SCANNER_MODULE = "childscanner.js",
var SCANNER_MODULE = path.join(path.dirname(fs.realpathSync(__filename)), './childscanner.js'),
    CORES = require("os").cpus().length,
    WORKERS = CORES;

// Module vars
var children = [],
    results = {
        open:[],
        closed:[],
        filtered:[],
        scanned:[]
    },
    FISHY_ADDRESS = false,
    ServicesDBTcp = {},
    START_PORT = 1,
    END_PORT = 65535,
    NUM_PORTS = END_PORT - START_PORT + 1,
    ADDR = false,
    guard = workersGate(WORKERS);

module.exports.results = results;

function setNumPorts(start, end) {
    if (isNaN(start) || isNaN(end) || start <= 0 || end > 65535) {
        return NUM_PORTS;
    }
    else if ((end - start) < 0) {
        return NUM_PORTS;
    }
    else {
        START_PORT = start;
        END_PORT = end;
        NUM_PORTS = END_PORT - START_PORT + 1;
        return {start:START_PORT,end:END_PORT,numports:NUM_PORTS};
    }
}
module.exports.setNumPorts = setNumPorts;

function countResults() {
    return results.open.length+
           results.closed.length+
           results.filtered.length;
}
module.exports.countResults = countResults;

// initializes one child per WORKERS
module.exports.beginScan = function beginScan(addr) {
    ADDR = addr;
    exports.initServicesObject(ServicesDBTcp, scanInit);
    console.log("Starting",WORKERS,"child processes for scanning address",ADDR,"for ports",START_PORT,"thru",END_PORT,":",NUM_PORTS,"ports");
};

// simple creation of an object to map ports to service names
// and call callback function cb when complete
module.exports.initServicesObject = function initServicesObject(obj, cb) {
    var record_regex = /(\S+)\s+(\d+)\/tcp.+/,
        filestream = fs.createReadStream("/etc/services"),
        rl = readline.createInterface({input:filestream});
    rl.on("line", function(line) {
        var m = record_regex.exec(line);
        if (m) {
            obj[m[2]] = m[1];
        }
    });
    filestream.on("close", cb);
    filestream.on("error", function(e) {
        console.log("could not open /etc/services : ",e);
    });
};

// private function to launch worker processes
function scanInit() {
    if (!ADDR) {
        console.log("Address is not set");
        return undefined;
    }
    for (var i = 0; i < WORKERS; ++i) {
        var child = forkChildProcess(SCANNER_MODULE);
        child.num = i;
        children[i] = exports.initChild(child);
    }
    return children;
}

function forkChildProcess(modulename) {
    return child_process.fork(path.resolve(modulename));
}

function initChild(child) {
    child.assigned = {};
    child.on("error", function parentErrorHandler(e) {
        console.log("Child", child.num, "errored:", e);
    });
    child.on("exit", function parentExitHandler(e) {
        console.log("Child", child.num, "exited:", e);
        var waiting = [];
        for (var i = 0; i < child.assigned.length; ++i) {
            if (Object.keys(child.assigned)[i] === "waiting") {
                waiting.push(i);
            }
        }
        if (waiting.length > 0) {
            console.log("restarting child",child.num);
            var new_child = forkChildProcess(SCANNER_MODULE);
            new_child.num = child.num;
            children[new_child.num] = new_child;
            initChild(new_child, waiting);
        }
        else {
            guard();
        }
    });
    child.on("message", function parentMsgHandler(msg) {
        if (msg.state === "open") {
            results.open.push(msg.port+": "+ServicesDBTcp[msg.port]);
        }
        else if (msg.state === "closed") {
            results.closed.push(msg.port);
        }
        else if (msg.state === "filtered") {
            results.filtered.push(msg.port);
        }
        results.scanned[msg.port] = true;
        child.assigned[msg.port] = "scanned";
        // All work complete case
        if (countResults() === NUM_PORTS) {
            console.log("DISCONNECTING",children.length,"CHILDREN");
            children.forEach(function(c) {
                c.disconnect();
            });
        }
    });
    // default case
    if (arguments.length < 2) {
        console.log("Sending port messages to child",child.num);
        for (var port = START_PORT+child.num; port <= END_PORT; port += WORKERS) {
            child.send({port:port,addr:ADDR});
            child.assigned[port] = "waiting";
        }
    } // restarting failed child case with "waiting" ports array argument
    else {
        console.log("re-initializing child",child.num); 
        arguments[1].forEach(function(port) {
            child.send({port:port,addr:ADDR});
            child.assigned[port] = "waiting";
        });
    }
    return child;
}
module.exports.initChild = initChild;

/*
 * function maker, returns a counter function meant to be called upon each
 * child worker process port connect attempt, initialized with the number of 
 * expected tasks to complete.  Prints the results report when counter
 * matches numtasks.
 */

function workersGate(numtasks) {
    var count = 0;
    return function() {
        count++;
        if (count == numtasks) {
            console.log("\n-=- results -=-\n");
            if (FISHY_ADDRESS) {
                console.log("** WARNING: Unreliable scan, fishy address:",ADDR,"**\n");
            }
            if (results.open.length) {
                console.log("open TCP ports:\n",JSON.stringify(results.open,null,2));
            }
            else  {
                console.log("No open ports");
            }
            console.log(results.filtered.length, "ports timed out (filtered|closed|lost)");
            console.log(results.closed.length, "ports are closed");
            return true;
        }
        else if (count < numtasks) {
            return count;
        }
        else {
            return false;
        }
    };
}
module.exports.workersGate = workersGate;
